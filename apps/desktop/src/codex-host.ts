import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { approvalResult, textInput, translateAppServerMessage } from './app-server-protocol.js';
import { ApprovalContinuationWatchdog } from './approval-watchdog.js';
import { buildCodexProviderArgs, engineProfileById, redactRuntimeSecrets } from './engine-profiles.js';
import { JsonLineDecoder } from './jsonl.js';
import { TextLineDecoder, WireLog } from './wire-log.js';
import { listRuntimeConnectors, recordMcpStartupStatus } from './mcp-connector-registry.js';

const START = 'hummer:codex:start';
const REPLAY = 'hummer:codex:replay';
const STOP = 'hummer:codex:stop';
const RESPOND_APPROVAL = 'hummer:codex:respond-approval';
const STEER = 'hummer:codex:steer';
const EVENT = 'hummer:codex:event';
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
  approvalWatchdog: ApprovalContinuationWatchdog;
  threadId?: string;
  turnId?: string;
}

const runs = new Map<string, RunState>();
let registered = false;

export function registerCodexHost(): void {
  if (registered) return;
  registered = true;
  ipcMain.handle(START, startCodex);
  ipcMain.handle(REPLAY, (_event, processId: string) => [...requireRun(processId).events]);
  ipcMain.handle(STOP, async (_event, processId: string) => stopRun(requireRun(processId)));
  ipcMain.handle(RESPOND_APPROVAL, async (_event, processId: string, approvalId: string, approved: boolean) => {
    respondToApproval(requireRun(processId), approvalId, approved);
  });
  ipcMain.handle(STEER, async (_event, processId: string, text: string) => steerRun(requireRun(processId), text));
  ipcMain.handle(CONNECTORS_LIST, () => listRuntimeConnectors());
}

async function startCodex(event: IpcMainInvokeEvent, request: Invocation): Promise<{ processId: string; nativeSessionId?: string; engine: EngineDisclosure }> {
  validateInvocation(request);
  const processId = randomUUID();
  const profile = engineProfileById(process.env.HUMMER_ENGINE_PROFILE || request.engineProfileId);
  const providerArgs = buildCodexProviderArgs(profile, process.env);
  const executable = resolveCodexExecutable();
  const child = spawn(executable, [...providerArgs, ...request.args], {
    cwd: request.cwd,
    env: process.env,
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
    protocol: request.protocol,
    child,
    owner: event.sender,
    decoder: new JsonLineDecoder(),
    stderrDecoder: new TextLineDecoder(),
    wireLog: new WireLog(process.env.HUMMER_CODEX_WIRE_LOG_PATH, (raw) => redactRuntimeSecrets(raw, process.env)),
    events: [],
    stderr: '',
    requestSequence: 0,
    pending: new Map(),
    approvalRequests: new Map(),
    approvalWatchdog,
  };
  runs.set(processId, state);
  attachProcess(state);

  if (request.protocol === 'exec-jsonl') {
    child.stdin.end(request.stdin);
    return { processId, engine: disclosure(profile, request) };
  }

  try {
    await requestRpc(state, 'initialize', {
      clientInfo: { name: 'hummer-desktop', title: 'HUMMER Desktop', version: '0.0.0' },
      capabilities: null,
    });
    notify(state, 'initialized');
    const threadResult = await requestRpc(state, 'thread/start', {
      cwd: request.cwd ?? null,
      approvalPolicy: 'on-request',
      sandbox: process.env.HUMMER_CODEX_SANDBOX ?? 'workspace-write',
      ephemeral: true,
    });
    state.threadId = nestedString(threadResult, 'thread', 'id');
    if (!state.threadId) throw new Error('Codex app-server thread/start did not return thread.id');
    publish(state, { type: 'thread.started', thread_id: state.threadId });

    const turnResult = await requestRpc(state, 'turn/start', {
      threadId: state.threadId,
      input: textInput(request.initialPrompt),
      cwd: request.cwd ?? null,
    });
    state.turnId = nestedString(turnResult, 'turn', 'id');
    if (!state.turnId) throw new Error('Codex app-server turn/start did not return turn.id');
    return { processId, nativeSessionId: state.threadId, engine: disclosure(profile, request) };
  } catch (error) {
    if (!child.killed) child.kill();
    runs.delete(processId);
    throw error;
  }
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
  if ((method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') && message.id !== undefined) {
    const params = isRecord(message.params) ? message.params : {};
    const approvalId = typeof params.approvalId === 'string' && params.approvalId ? params.approvalId : String(message.id);
    state.approvalRequests.set(approvalId, message.id as string | number);
  }
  if (method === 'turn/started') state.turnId = nestedString(message, 'params', 'turn', 'id') ?? state.turnId;
  translateAppServerMessage(message).forEach((translated) => publish(state, translated));
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
  if (state.protocol !== 'app-server-jsonrpc' || !state.threadId || !state.turnId) {
    throw new Error('Steer requires an active app-server turn');
  }
  await requestRpc(state, 'turn/steer', {
    threadId: state.threadId,
    expectedTurnId: state.turnId,
    input: textInput(text),
  });
}

async function stopRun(state: RunState): Promise<void> {
  if (state.protocol === 'app-server-jsonrpc' && state.threadId && state.turnId && !state.child.killed) {
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
  const sandbox = sandboxIndex >= 0 ? request.args[sandboxIndex + 1] ?? 'workspace-write' : process.env.HUMMER_CODEX_SANDBOX ?? 'workspace-write';
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
  if (process.env.HUMMER_CODEX_PATH) {
    if (!existsSync(process.env.HUMMER_CODEX_PATH)) throw new Error(`Configured Codex executable does not exist: ${process.env.HUMMER_CODEX_PATH}`);
    return process.env.HUMMER_CODEX_PATH;
  }
  if (process.platform !== 'win32') return 'codex';
  const candidates = (process.env.PATH ?? '').split(delimiter).map((entry) => join(entry, 'codex.cmd'));
  const executable = candidates.find(existsSync);
  if (!executable) throw new Error('Codex CLI is unavailable. Install @openai/codex with npm or set HUMMER_CODEX_PATH.');
  return executable;
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
