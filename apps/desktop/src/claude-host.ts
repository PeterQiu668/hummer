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
  child: ChildProcessWithoutNullStreams;
  owner: WebContents;
  decoder: JsonLineDecoder;
  stderrDecoder: TextLineDecoder;
  wireLog: WireLog;
  events: EventEnvelope[];
}

const runs = new Map<string, RunState>();
let registered = false;

export function registerClaudeHost(): void {
  if (registered) return;
  registered = true;
  ipcMain.handle(START, startClaude);
  ipcMain.handle(REPLAY, (_event, processId: string) => [...requireRun(processId).events]);
  ipcMain.handle(STOP, async (_event, processId: string) => stopRun(requireRun(processId)));
  ipcMain.handle(RESPOND_APPROVAL, async () => {
    throw new Error('Claude Code approval E2E is not connected: the installed CLI requires an external permission-prompt MCP tool. No approval was sent.');
  });
  ipcMain.handle(STEER, async (_event, processId: string, text: string) => steerRun(requireRun(processId), text));
}

async function startClaude(event: IpcMainInvokeEvent, request: ClaudeHostInvocation): Promise<{
  processId: string;
  engine: ClaudeEngineDisclosure;
}> {
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

export function stopAllClaudeRuns(): number {
  const active = [...runs.values()].filter((state) => !state.child.killed);
  active.forEach(stopRun);
  return active.length;
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
  if (!state) throw new Error(`Unknown Claude Code process ${processId}`);
  return state;
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
