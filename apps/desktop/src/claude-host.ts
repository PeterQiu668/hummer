import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import {
  claudeEngineDisclosure,
  redactClaudeSecrets,
  validateClaudeInvocation,
  type ClaudeEngineDisclosure,
  type ClaudeHostInvocation,
} from './claude-host-contract.js';
import { JsonLineDecoder } from './jsonl.js';
import { TextLineDecoder, WireLog } from './wire-log.js';

const START = 'hummer:claude:start';
const REPLAY = 'hummer:claude:replay';
const STOP = 'hummer:claude:stop';
const RESPOND_APPROVAL = 'hummer:claude:respond-approval';
const STEER = 'hummer:claude:steer';
const EVENT = 'hummer:claude:event';

interface EventEnvelope {
  processId: string;
  index: number;
  message: unknown;
}

interface RunState {
  processId: string;
  tenantId: string;
  authToken: string;
  child: ChildProcessWithoutNullStreams;
  owner: WebContents;
  decoder: JsonLineDecoder;
  stderrDecoder: TextLineDecoder;
  wireLog: WireLog;
  events: EventEnvelope[];
}

const runs = new Map<string, RunState>();
let registered = false;
let hostOptions: ClaudeHostOptions = {};

export interface ClaudeHostOptions {
  resolveTenantId?: (token: string) => string;
}

export function registerClaudeHost(options: ClaudeHostOptions = {}): void {
  if (registered) return;
  registered = true;
  hostOptions = options;
  ipcMain.handle(START, (event, token: string, request: ClaudeHostInvocation) => startClaude(event, token, request));
  ipcMain.handle(REPLAY, (_event, token: string, processId: string) => [...requireRun(processId, token).events]);
  ipcMain.handle(STOP, async (_event, token: string, processId: string) => stopRun(requireRun(processId, token)));
  ipcMain.handle(RESPOND_APPROVAL, async (_event, token: string, processId: string) => {
    requireRun(processId, token);
    throw new Error('Claude Code approval E2E is not connected: the installed CLI requires an external permission-prompt MCP tool. No approval was sent.');
  });
  ipcMain.handle(STEER, async (_event, token: string, processId: string, text: string) => steerRun(requireRun(processId, token), text));
}

async function startClaude(event: IpcMainInvokeEvent, token: string, request: ClaudeHostInvocation): Promise<{
  processId: string;
  engine: ClaudeEngineDisclosure;
}> {
  const tenantId = resolveTenantId(token);
  validateClaudeInvocation(request);
  const processId = randomUUID();
  const executable = resolveClaudeExecutable();
  const child = spawn(executable, request.args, {
    cwd: request.cwd,
    env: process.env,
    windowsHide: true,
    shell: process.platform === 'win32' && executable.endsWith('.cmd'),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const state: RunState = {
    processId,
    tenantId,
    authToken: token,
    child,
    owner: event.sender,
    decoder: new JsonLineDecoder(),
    stderrDecoder: new TextLineDecoder(),
    wireLog: new WireLog(
      process.env.HUMMER_CLAUDE_WIRE_LOG_PATH,
      (raw) => redactClaudeSecrets(raw, process.env),
    ),
    events: [],
  };
  runs.set(processId, state);
  attachProcess(state);
  const raw = request.stdin.endsWith('\n') ? request.stdin : `${request.stdin}\n`;
  state.wireLog.append('outbound', raw.trimEnd());
  child.stdin.write(raw);
  return {
    processId,
    engine: claudeEngineDisclosure(process.env.HUMMER_CLAUDE_MODEL),
  };
}

function attachProcess(state: RunState): void {
  state.child.stdout.on('data', (chunk: Buffer) => {
    if (!isCurrentTenant(state)) {
      stopUnauthorizedRun(state);
      return;
    }
    try {
      state.decoder.push(chunk).forEach((message) => {
        state.wireLog.append('inbound', JSON.stringify(message));
        publish(state, message);
      });
    } catch (error) {
      publish(state, hostError(error));
    }
  });
  state.child.stderr.on('data', (chunk: Buffer) => {
    state.stderrDecoder.push(chunk).forEach((line) => publishStderr(state, line));
  });
  state.child.on('error', (error) => publish(state, hostError(error)));
  state.child.on('close', (code) => {
    try {
      state.decoder.finish().forEach((message) => {
        state.wireLog.append('inbound', JSON.stringify(message));
        publish(state, message);
      });
      state.stderrDecoder.finish().forEach((line) => publishStderr(state, line));
    } catch (error) {
      publish(state, hostError(error));
    }
    if (code && code !== 0) publish(state, hostError(`Claude Code exited with code ${code}`));
  });
}

function steerRun(state: RunState, text: string): void {
  if (!text.trim()) throw new Error('Claude Code steer message cannot be empty');
  if (state.child.killed || !state.child.stdin.writable) throw new Error('Claude Code process is not accepting input');
  const raw = JSON.stringify({
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text }] },
  });
  state.wireLog.append('outbound', raw);
  state.child.stdin.write(`${raw}\n`);
}

function stopRun(state: RunState): void {
  if (!state.child.killed) state.child.kill();
}

export function stopAllClaudeRuns(tenantId: string): number {
  const active = [...runs.values()].filter((state) => state.tenantId === tenantId && !state.child.killed);
  active.forEach(stopRun);
  return active.length;
}

function publish(state: RunState, message: unknown): void {
  if (!isCurrentTenant(state)) {
    stopUnauthorizedRun(state);
    return;
  }
  const envelope: EventEnvelope = { processId: state.processId, index: state.events.length + 1, message };
  state.events.push(envelope);
  if (!state.owner.isDestroyed()) state.owner.send(EVENT, envelope);
}

function publishStderr(state: RunState, line: string): void {
  state.wireLog.append('stderr', line);
  publish(state, { type: 'host.stderr', line });
}

function requireRun(processId: string, token: string): RunState {
  const state = runs.get(processId);
  if (!state) throw new Error(`Unknown Claude Code process ${processId}`);
  const tenantId = resolveTenantId(token);
  if (state.tenantId !== tenantId) throw new Error('Claude Code process is unavailable in the current tenant');
  return state;
}

function resolveTenantId(token: string): string {
  if (typeof token !== 'string' || !token) throw new Error('Claude Code runtime requires an authenticated session token');
  if (!hostOptions.resolveTenantId) throw new Error('Claude Code runtime tenant resolver is not configured');
  return hostOptions.resolveTenantId(token);
}

function isCurrentTenant(state: RunState): boolean {
  try { return resolveTenantId(state.authToken) === state.tenantId; } catch { return false; }
}

function stopUnauthorizedRun(state: RunState): void {
  if (!state.child.killed) state.child.kill();
}

function resolveClaudeExecutable(): string {
  if (process.env.HUMMER_CLAUDE_PATH) {
    if (!existsSync(process.env.HUMMER_CLAUDE_PATH)) throw new Error(`Configured Claude Code executable does not exist: ${process.env.HUMMER_CLAUDE_PATH}`);
    return process.env.HUMMER_CLAUDE_PATH;
  }
  if (process.platform !== 'win32') return 'claude';
  const candidates = (process.env.PATH ?? '').split(delimiter).flatMap((entry) => [join(entry, 'claude.exe'), join(entry, 'claude.cmd')]);
  const executable = candidates.find(existsSync);
  if (!executable) throw new Error('Claude Code CLI is unavailable. Install @anthropic-ai/claude-code or set HUMMER_CLAUDE_PATH.');
  return executable;
}

function hostError(error: unknown): { type: 'error'; error: { message: string } } {
  return { type: 'error', error: { message: error instanceof Error ? error.message : String(error) } };
}
