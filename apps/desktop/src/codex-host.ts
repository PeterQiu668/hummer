import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { approvalResult, mcpElicitationResult, scopeAppServerApproval, textInput, translateAppServerMessage } from './app-server-protocol.js';
import { ApprovalContinuationWatchdog } from './approval-watchdog.js';
import { buildCodexProviderArgs, engineProfileById, redactRuntimeSecrets, requiredCodexCliVersion } from './engine-profiles.js';
import { JsonLineDecoder } from './jsonl.js';
import { TextLineDecoder, WireLog } from './wire-log.js';
import { listRuntimeConnectors, recordMcpStartupStatus, type RuntimeConnectorRecord } from './mcp-connector-registry.js';
import { buildRuntimeEnvironment } from './runtime-credential-environment.js';
import { replaceSandboxArgument, resolveCodexSandbox } from './codex-sandbox.js';
import { buildHummerMcpProviderArgs } from './hummer-mcp-config.js';

const START = 'hummer:codex:start';
const REPLAY = 'hummer:codex:replay';
const STOP = 'hummer:codex:stop';
const RESPOND_APPROVAL = 'hummer:codex:respond-approval';
const STEER = 'hummer:codex:steer';
const EVENT = 'hummer:codex:event';
const FORK = 'hummer:codex:fork';
const CONNECTORS_LIST = 'hummer:runtime-connectors:list';
const CONNECTORS_CHANGED = 'hummer:runtime-connectors:changed';

interface Invocation {
  command: 'codex';
  args: string[];
  cwd?: string;
  stdin: string;
  initialPrompt: string;
  protocol: 'exec-jsonl' | 'app-server-jsonrpc';
  engineProfileId: string;
  sandbox: 'read-only' | 'workspace-write';
  outputSchema?: Record<string, unknown>;
  authToken?: string;
}

interface EventEnvelope {
  processId: string;
  index: number;
  message: unknown;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface RunState {
  processId: string;
  protocol: Invocation['protocol'];
  child: ChildProcessWithoutNullStreams;
  owner: WebContents;
  decoder: JsonLineDecoder;
  stderrDecoder: TextLineDecoder;
  wireLog: WireLog;
  events: EventEnvelope[];
  stderr: string;
  requestSequence: number;
  pending: Map<string, PendingRequest>;
  approvalRequests: Map<string, string | number>;
  activeMcpTools: Map<string, { serverName: string; toolName: string }>;
  approvalWatchdog: ApprovalContinuationWatchdog;
  threadId?: string;
  invocation: Invocation;
  turnId?: string;
  turnActive: boolean;
}

const runs = new Map<string, RunState>();
let registered = false;
let verifiedCodexExecutable: string | undefined;

export interface CodexHostOptions {
  resolveCredential?: (token: string, engineProfileId: string, envKey: string) => string | undefined;
  recordMcpConnectorStatus?: (token: string, record: RuntimeConnectorRecord) => void;
  authorizeMcpTool?: (token: string, request: { serverName: string; toolName: string }) => boolean;
}

let hostOptions: CodexHostOptions = {};

export function registerCodexHost(options: CodexHostOptions = {}): void {
  if (registered) return;
  registered = true;
  hostOptions = options;
  ipcMain.handle(START, startCodex);
  ipcMain.handle(REPLAY, (_event, processId: string) => [...requireRun(processId).events]);
  ipcMain.handle(STOP, async (_event, processId: string) => stopRun(requireRun(processId)));
  ipcMain.handle(RESPOND_APPROVAL, async (_event, processId: string, approvalId: string, approved: boolean) => {
    respondToApproval(requireRun(processId), approvalId, approved);
  });
  ipcMain.handle(STEER, async (_event, processId: string, text: string) => steerRun(requireRun(processId), text));
  ipcMain.handle(FORK, (event, processId: string, checkpoint: { sequence: number; nativeTurnId: string }, sop?: string) => forkCodex(event, requireRun(processId), checkpoint, sop));
  ipcMain.handle(CONNECTORS_LIST, () => listRuntimeConnectors());
}

async function startCodex(event: IpcMainInvokeEvent, request: Invocation): Promise<{ processId: string; nativeSessionId?: string; engine: EngineDisclosure }> {
  validateInvocation(request);
  const sandbox = resolveCodexSandbox(request.sandbox, process.env.HUMMER_CODEX_SANDBOX);
  const effectiveRequest = {
    ...request,
    sandbox,
    args: request.protocol === 'exec-jsonl' ? replaceSandboxArgument(request.args, sandbox) : request.args,
  };
  const processId = randomUUID();
  const profile = engineProfileById(process.env.HUMMER_ENGINE_PROFILE || effectiveRequest.engineProfileId);
  const runtimeEnvironment = buildRuntimeEnvironment(process.env, {
    authToken: effectiveRequest.authToken,
    engineProfileId: profile.id,
    envKey: profile.envKey,
    resolveCredential: hostOptions.resolveCredential ?? (() => undefined),
  });
  const providerArgs = buildCodexProviderArgs(profile, runtimeEnvironment);
  const mcpArgs = buildHummerMcpProviderArgs({
    executable: process.execPath,
    serverScript: fileURLToPath(new URL('./hummer-mcp-server.js', import.meta.url)),
    workspace: effectiveRequest.cwd ?? process.cwd(),
  });
  const executable = resolveCodexExecutable();
  const child = spawn(executable, [...providerArgs, ...mcpArgs, ...effectiveRequest.args], {
    cwd: effectiveRequest.cwd,
    env: runtimeEnvironment,
    windowsHide: true,
    shell: process.platform === 'win32' && executable.endsWith('.cmd'),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let state!: RunState;
  const approvalWatchdog = new ApprovalContinuationWatchdog(approvalTimeoutMs(), (approvalId) => {
    const message = `审批回传未被 runtime 接受：${approvalTimeoutMs() / 1000} 秒内没有后续事件（${approvalId}）。`;
    publishStderr(state, message);
    publish(state, hostError(message));
  });
  state = {
    processId,
    protocol: effectiveRequest.protocol,
    child,
    owner: event.sender,
    decoder: new JsonLineDecoder(),
    stderrDecoder: new TextLineDecoder(),
    wireLog: new WireLog(process.env.HUMMER_CODEX_WIRE_LOG_PATH, (raw) => redactRuntimeSecrets(raw, runtimeEnvironment)),
    events: [],
    stderr: '',
    requestSequence: 0,
    pending: new Map(),
    approvalRequests: new Map(),
    activeMcpTools: new Map(),
    approvalWatchdog,
    invocation: effectiveRequest,
    turnActive: false,
  };
  runs.set(processId, state);
  attachProcess(state);

  if (effectiveRequest.protocol === 'exec-jsonl') {
    child.stdin.end(effectiveRequest.stdin);
    return { processId, engine: disclosure(profile, effectiveRequest) };
  }

  try {
    await requestRpc(state, 'initialize', {
      clientInfo: { name: 'hummer-desktop', title: 'HUMMER Desktop', version: app.getVersion() },
      capabilities: null,
    });
    notify(state, 'initialized');
    const threadResult = await requestRpc(state, 'thread/start', {
      cwd: effectiveRequest.cwd ?? null,
      approvalPolicy: 'on-request',
      sandbox: effectiveRequest.sandbox,
      ephemeral: false,
    });
    state.threadId = nestedString(threadResult, 'thread', 'id');
    if (!state.threadId) throw new Error('Codex app-server thread/start did not return thread.id');
    publish(state, { type: 'thread.started', thread_id: state.threadId });

    const turnResult = await requestRpc(state, 'turn/start', {
      threadId: state.threadId,
      input: textInput(effectiveRequest.initialPrompt),
      cwd: effectiveRequest.cwd ?? null,
      ...(effectiveRequest.outputSchema ? { outputSchema: effectiveRequest.outputSchema } : {}),
    });
    state.turnId = nestedString(turnResult, 'turn', 'id');
    if (!state.turnId) throw new Error('Codex app-server turn/start did not return turn.id');
    state.turnActive = true;
    return { processId, nativeSessionId: state.threadId, engine: disclosure(profile, effectiveRequest) };
  } catch (error) {
    if (!child.killed) child.kill();
    runs.delete(processId);
    throw error;
  }
}

async function forkCodex(
  event: IpcMainInvokeEvent,
  source: RunState,
  checkpoint: { sequence: number; nativeTurnId: string },
  sop?: string,
): Promise<{ processId: string; nativeSessionId?: string; engine: EngineDisclosure }> {
  if (source.protocol !== 'app-server-jsonrpc' || !source.threadId) {
    throw new Error('Codex thread/fork requires a persistent app-server source thread');
  }
  if (!Number.isInteger(checkpoint.sequence) || checkpoint.sequence < 1 || !checkpoint.nativeTurnId) {
    throw new Error('Codex thread/fork requires a valid HUMMER sequence and native turn id');
  }

  const request = source.invocation;
  validateInvocation(request);
  const processId = randomUUID();
  const profile = engineProfileById(process.env.HUMMER_ENGINE_PROFILE || request.engineProfileId);
  const runtimeEnvironment = buildRuntimeEnvironment(process.env, {
    authToken: request.authToken,
    engineProfileId: profile.id,
    envKey: profile.envKey,
    resolveCredential: hostOptions.resolveCredential ?? (() => undefined),
  });
  const providerArgs = buildCodexProviderArgs(profile, runtimeEnvironment);
  const mcpArgs = buildHummerMcpProviderArgs({
    executable: process.execPath,
    serverScript: fileURLToPath(new URL('./hummer-mcp-server.js', import.meta.url)),
    workspace: request.cwd ?? process.cwd(),
  });
  const executable = resolveCodexExecutable();
  const child = spawn(executable, [...providerArgs, ...mcpArgs, ...request.args], {
    cwd: request.cwd,
    env: runtimeEnvironment,
    windowsHide: true,
    shell: process.platform === 'win32' && executable.endsWith('.cmd'),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let state!: RunState;
  const approvalWatchdog = new ApprovalContinuationWatchdog(approvalTimeoutMs(), (approvalId) => {
    const message = 'Approval continuation timed out for forked runtime request ' + approvalId;
    publishStderr(state, message);
    publish(state, hostError(message));
  });
  state = {
    processId,
    protocol: request.protocol,
    child,
    owner: event.sender,
    decoder: new JsonLineDecoder(),
    stderrDecoder: new TextLineDecoder(),
    wireLog: new WireLog(process.env.HUMMER_CODEX_WIRE_LOG_PATH, (raw) => redactRuntimeSecrets(raw, runtimeEnvironment)),
    events: [],
    stderr: '',
    requestSequence: 0,
    pending: new Map(),
    approvalRequests: new Map(),
    activeMcpTools: new Map(),
    approvalWatchdog,
    invocation: request,
    turnActive: false,
  };
  runs.set(processId, state);
  attachProcess(state);

  try {
    await requestRpc(state, 'initialize', {
      clientInfo: { name: 'hummer-desktop', title: 'HUMMER Desktop', version: app.getVersion() },
      capabilities: null,
    });
    notify(state, 'initialized');
    const forkResult = await requestRpc(state, 'thread/fork', {
      threadId: source.threadId,
      lastTurnId: checkpoint.nativeTurnId,
      cwd: request.cwd ?? null,
      approvalPolicy: 'on-request',
      sandbox: resolveCodexSandbox(request.sandbox, process.env.HUMMER_CODEX_SANDBOX),
      ephemeral: false,
    });
    state.threadId = nestedString(forkResult, 'thread', 'id');
    if (!state.threadId) throw new Error('Codex app-server thread/fork did not return thread.id');
    publish(state, { type: 'thread.started', thread_id: state.threadId });

    const turnResult = await requestRpc(state, 'turn/start', {
      threadId: state.threadId,
      input: textInput(forkPrompt(checkpoint.sequence, sop)),
      cwd: request.cwd ?? null,
      ...(request.outputSchema ? { outputSchema: request.outputSchema } : {}),
    });
    state.turnId = nestedString(turnResult, 'turn', 'id');
    if (!state.turnId) throw new Error('Codex app-server branch turn/start did not return turn.id');
    state.turnActive = true;
    return { processId, nativeSessionId: state.threadId, engine: disclosure(profile, request) };
  } catch (error) {
    if (!child.killed) child.kill();
    runs.delete(processId);
    throw error;
  }
}

function forkPrompt(sequence: number, sop?: string): string {
  const instruction = sop?.trim()
    ? 'Apply this revised SOP to the forked conversation:\n' + sop.trim()
    : 'Produce an alternative result that can be compared with the source conversation.';
  return 'Continue from HUMMER checkpoint sequence ' + sequence + ' in a forked conversation. '
    + 'This is a runtime session fork, not a Git branch: do not create, switch, or modify any Git branch.\n'
    + instruction;
}
function attachProcess(state: RunState): void {
  state.child.stdout.on('data', (chunk: Buffer) => {
    try {
      state.decoder.push(chunk).forEach((message) => handleNativeMessage(state, message));
    } catch (error) {
      publish(state, hostError(error));
    }
  });
  state.child.stderr.on('data', (chunk: Buffer) => {
    state.stderr = `${state.stderr}${chunk.toString('utf8')}`.slice(-12_000);
    state.stderrDecoder.push(chunk).forEach((line) => publishStderr(state, line));
  });
  state.child.on('error', (error) => publish(state, hostError(error)));
  state.child.on('close', (code) => {
    try {
      state.decoder.finish().forEach((message) => handleNativeMessage(state, message));
      state.stderrDecoder.finish().forEach((line) => publishStderr(state, line));
    } catch (error) {
      publish(state, hostError(error));
    }
    const closeError = new Error(state.stderr.trim() || `Codex exited with code ${code ?? 'unknown'}`);
    state.pending.forEach((pending) => {
      clearTimeout(pending.timeout);
      pending.reject(closeError);
    });
    state.pending.clear();
    state.approvalWatchdog.clearAll();
    if (code && code !== 0) publish(state, hostError(closeError));
  });
}

function handleNativeMessage(state: RunState, message: unknown): void {
  state.wireLog.append('inbound', JSON.stringify(message));
  const connector = recordMcpStartupStatus(message);
  if (connector && !state.owner.isDestroyed()) {
    state.owner.send(CONNECTORS_CHANGED, listRuntimeConnectors());
  }
  if (connector && state.invocation.authToken) {
    hostOptions.recordMcpConnectorStatus?.(state.invocation.authToken, connector);
  }
  if (state.protocol === 'exec-jsonl') {
    publish(state, message);
    return;
  }
  if (!isRecord(message)) return;
  state.approvalWatchdog.acknowledgeAll();

  if (message.id !== undefined && ('result' in message || 'error' in message) && !message.method) {
    const pending = state.pending.get(String(message.id));
    if (!pending) return;
    clearTimeout(pending.timeout);
    state.pending.delete(String(message.id));
    if (message.error) pending.reject(new Error(errorText(message.error)));
    else pending.resolve(message.result);
    return;
  }

  const method = typeof message.method === 'string' ? message.method : '';
  rememberMcpToolCall(state, message);
  if (method === 'mcpServer/elicitation/request') {
    respondToMcpElicitation(state, message);
    return;
  }
  const approval = scopeAppServerApproval(message, state.threadId ?? state.processId);
  if (approval) {
    state.approvalRequests.set(approval.approvalId, approval.requestId);
    message = approval.message;
  }
  if (method === 'turn/started') {
    state.turnId = nestedString(message, 'params', 'turn', 'id') ?? state.turnId;
    state.turnActive = true;
  }
  if (method === 'turn/completed') state.turnActive = false;
  translateAppServerMessage(message).forEach((translated) => publish(state, translated));
}

function rememberMcpToolCall(state: RunState, message: Record<string, unknown>): void {
  if (message.method !== 'item/started') return;
  const params = isRecord(message.params) ? message.params : {};
  const item = isRecord(params.item) ? params.item : {};
  if (item.type !== 'mcpToolCall') return;
  const turnId = typeof params.turnId === 'string' ? params.turnId : state.turnId;
  if (!turnId || typeof item.server !== 'string' || typeof item.tool !== 'string') return;
  state.activeMcpTools.set(turnId, { serverName: item.server, toolName: item.tool });
}

function respondToMcpElicitation(state: RunState, message: Record<string, unknown>): void {
  if (message.id === undefined || (typeof message.id !== 'string' && typeof message.id !== 'number')) return;
  const params = isRecord(message.params) ? message.params : {};
  const meta = isRecord(params._meta) ? params._meta : {};
  const turnId = typeof params.turnId === 'string' ? params.turnId : state.turnId;
  const activeTool = turnId ? state.activeMcpTools.get(turnId) : undefined;
  const isToolApproval = meta.codex_approval_kind === 'mcp_tool_call';
  const token = state.invocation.authToken;
  const approved = Boolean(
    isToolApproval
    && token
    && activeTool
    && activeTool.serverName === params.serverName
    && hostOptions.authorizeMcpTool?.(token, activeTool),
  );
  writeJson(state, { id: message.id, result: mcpElicitationResult(approved) });
  if (!approved) {
    publishStderr(state, `MCP tool request declined by HUMMER policy: ${activeTool?.serverName ?? 'unknown'}/${activeTool?.toolName ?? 'unknown'}`);
  }
}

function requestRpc(state: RunState, method: string, params: Record<string, unknown>): Promise<unknown> {
  const id = `hummer-${++state.requestSequence}`;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      state.pending.delete(id);
      reject(new Error(`Codex app-server request timed out: ${method}`));
    }, 30_000);
    state.pending.set(id, { resolve, reject, timeout });
    writeJson(state, { id, method, params });
  });
}

function notify(state: RunState, method: string): void {
  writeJson(state, { method });
}

function writeJson(state: RunState, message: unknown): void {
  const raw = JSON.stringify(message);
  state.wireLog.append('outbound', raw);
  state.child.stdin.write(`${raw}\n`);
}

function respondToApproval(state: RunState, approvalId: string, approved: boolean): void {
  const requestId = state.approvalRequests.get(approvalId);
  if (requestId === undefined) throw new Error(`Unknown Codex approval ${approvalId}`);
  state.approvalRequests.delete(approvalId);
  state.approvalWatchdog.arm(approvalId);
  writeJson(state, { id: requestId, result: approvalResult(approved) });
}

async function steerRun(state: RunState, text: string): Promise<void> {
  if (state.protocol !== 'app-server-jsonrpc' || !state.threadId || !state.turnId || !state.turnActive) {
    throw new Error('Steer requires an active app-server turn');
  }
  await requestRpc(state, 'turn/steer', {
    threadId: state.threadId,
    expectedTurnId: state.turnId,
    input: textInput(text),
  });
}

async function stopRun(state: RunState): Promise<void> {
  if (state.protocol === 'app-server-jsonrpc' && state.threadId && state.turnId && state.turnActive && !state.child.killed) {
    try {
      await requestRpc(state, 'turn/interrupt', { threadId: state.threadId, turnId: state.turnId });
    } finally {
      setTimeout(() => { if (!state.child.killed) state.child.kill(); }, 750);
    }
    return;
  }
  if (!state.child.killed) state.child.kill();
}

export async function stopAllCodexRuns(): Promise<number> {
  const active = [...runs.values()].filter((state) => !state.child.killed);
  await Promise.allSettled(active.map((state) => stopRun(state)));
  return active.length;
}

interface EngineDisclosure {
  providerName: string;
  modelName: string;
  dataDomain: string;
  sandbox: string;
  tier: 'standard' | 'enhanced' | 'flagship';
}

function disclosure(profile: ReturnType<typeof engineProfileById>, request: Invocation): EngineDisclosure {
  const sandboxIndex = request.args.indexOf('--sandbox');
  const sandbox = sandboxIndex >= 0 ? request.args[sandboxIndex + 1] ?? request.sandbox : request.sandbox;
  return { providerName: profile.providerName, modelName: profile.model, dataDomain: profile.dataDomain, sandbox, tier: profile.tier };
}

function publish(state: RunState, message: unknown): void {
  const envelope: EventEnvelope = { processId: state.processId, index: state.events.length + 1, message };
  state.events.push(envelope);
  if (!state.owner.isDestroyed()) state.owner.send(EVENT, envelope);
}

function publishStderr(state: RunState, line: string): void {
  state.wireLog.append('stderr', line);
  publish(state, { type: 'host.stderr', line });
}

function requireRun(processId: string): RunState {
  const state = runs.get(processId);
  if (!state) throw new Error(`Unknown Codex process ${processId}`);
  return state;
}

function validateInvocation(request: Invocation): void {
  if (request.command !== 'codex') throw new Error('Only the Codex executable is allowed');
  if (!Array.isArray(request.args) || request.args.some((arg) => typeof arg !== 'string' || /[&|<>^]/.test(arg))) {
    throw new Error('Codex arguments contain unsupported shell metacharacters');
  }
  if (request.protocol !== 'exec-jsonl' && request.protocol !== 'app-server-jsonrpc') throw new Error('Unsupported Codex protocol');
}

function resolveCodexExecutable(): string {
  let executable: string;
  if (process.env.HUMMER_CODEX_PATH) {
    if (!existsSync(process.env.HUMMER_CODEX_PATH)) throw new Error(`Configured Codex executable does not exist: ${process.env.HUMMER_CODEX_PATH}`);
    executable = process.env.HUMMER_CODEX_PATH;
  } else if (process.platform !== 'win32') {
    executable = 'codex';
  } else {
    const candidates = (process.env.PATH ?? '').split(delimiter).map((entry) => join(entry, 'codex.cmd'));
    const candidate = candidates.find(existsSync);
    if (!candidate) throw new Error('Codex CLI is unavailable. Install @openai/codex with npm or set HUMMER_CODEX_PATH.');
    executable = candidate;
  }
  verifyCodexCliVersion(executable);
  return executable;
}

function verifyCodexCliVersion(executable: string): void {
  if (verifiedCodexExecutable === executable) return;
  const result = spawnSync(executable, ['--version'], {
    encoding: 'utf8',
    windowsHide: true,
    shell: process.platform === 'win32' && executable.endsWith('.cmd'),
    timeout: 30_000,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Unable to verify Codex CLI version: ${result.error?.message ?? result.stderr.trim()}`);
  }
  const actual = /codex-cli\s+(\S+)/.exec(result.stdout)?.[1];
  const expected = requiredCodexCliVersion();
  if (actual !== expected) throw new Error(`HUMMER requires Codex CLI ${expected}; found ${actual ?? 'an unknown version'}.`);
  verifiedCodexExecutable = executable;
}

function nestedString(value: unknown, ...path: string[]): string | undefined {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return typeof current === 'string' ? current : undefined;
}

function errorText(value: unknown): string {
  if (isRecord(value) && typeof value.message === 'string') return value.message;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hostError(error: unknown): { type: 'error'; error: { message: string } } {
  return { type: 'error', error: { message: error instanceof Error ? error.message : String(error) } };
}

function approvalTimeoutMs(): number {
  const configured = Number(process.env.HUMMER_CODEX_APPROVAL_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : 30_000;
}
