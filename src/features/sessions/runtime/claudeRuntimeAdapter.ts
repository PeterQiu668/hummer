import type { SessionPlan } from '../model/session';
import type { RuntimeAdapter, RuntimeEngineDisclosure, RuntimeEvent, RuntimeHandle, RuntimeTokenUsage, Unsubscribe } from './adapter';

export interface ClaudeCliInvocation {
  command: 'claude';
  args: string[];
  cwd?: string;
  stdin: string;
  initialPrompt: string;
  protocol: 'stream-json';
}

export interface ClaudeCliRun { processId: string; nativeSessionId?: string; engine?: RuntimeEngineDisclosure; }

export interface ClaudeCliHost {
  start(request: ClaudeCliInvocation): Promise<ClaudeCliRun>;
  subscribe(run: ClaudeCliRun, callback: (message: unknown) => void): Unsubscribe;
  respondToApproval(run: ClaudeCliRun, id: string, approved: boolean): Promise<void>;
  sendHumanMessage(run: ClaudeCliRun, text: string): Promise<void>;
  stop(run: ClaudeCliRun): Promise<void>;
}

type RuntimeEventDraft = RuntimeEvent extends infer Event
  ? Event extends RuntimeEvent ? Omit<Event, 'sessionId' | 'sequence' | 'occurredAt'> : never
  : never;

interface ClaudeState {
  handle: RuntimeHandle;
  run: ClaudeCliRun;
  events: RuntimeEvent[];
  subscribers: Set<(event: RuntimeEvent) => void>;
  unsubscribe: Unsubscribe;
}

export class ClaudeRuntimeAdapter implements RuntimeAdapter {
  readonly id = 'claude-code';
  private readonly states = new Map<string, ClaudeState>();

  constructor(private readonly options: { enabled: boolean; host?: ClaudeCliHost; cwd?: string }) {}

  async startSession(plan: SessionPlan): Promise<RuntimeHandle> {
    if (!this.options.enabled) throw new Error('ClaudeRuntimeAdapter is disabled');
    if (!this.options.host) throw new Error('No desktop ClaudeCliHost bridge is installed');
    const run = await this.options.host.start(buildClaudeInvocation(plan, { cwd: this.options.cwd }));
    const handle: RuntimeHandle = { runtimeId: this.id, sessionId: `claude_${plan.id}_${Date.now()}`, nativeSessionId: run.nativeSessionId, engine: run.engine };
    const state: ClaudeState = { handle, run, events: [], subscribers: new Set(), unsubscribe: () => undefined };
    state.unsubscribe = this.options.host.subscribe(run, (message) => {
      const nativeSessionId = extractClaudeSessionId(message);
      if (nativeSessionId) state.handle.nativeSessionId = nativeSessionId;
      mapClaudeMessage(message).forEach((event) => this.emit(state, event));
    });
    this.states.set(handle.sessionId, state);
    return handle;
  }

  subscribe(handle: RuntimeHandle, callback: (event: RuntimeEvent) => void): Unsubscribe {
    const state = this.requireState(handle);
    state.events.forEach(callback);
    state.subscribers.add(callback);
    return () => state.subscribers.delete(callback);
  }

  async respondToApproval(handle: RuntimeHandle, id: string, approved: boolean): Promise<void> {
    const state = this.requireState(handle);
    await this.options.host!.respondToApproval(state.run, id, approved);
    this.emit(state, {
      type: 'approval_resolved', actorRef: 'human:operator', approvalId: id, approved,
      result: approved ? '真人已批准，执行内核可以继续。' : '真人已拒绝，本次受保护动作不会执行。',
      evidenceRefs: [`claude://approvals/${id}/decision`],
    });
  }

  async sendHumanMessage(handle: RuntimeHandle, text: string): Promise<void> {
    const state = this.requireState(handle);
    await this.options.host!.sendHumanMessage(state.run, text);
    this.emit(state, {
      type: 'step', category: 'message', status: 'completed', actorRef: 'human:operator',
      title: '你补充了要求', result: text, evidenceRefs: ['claude://session/human-message'],
    });
  }

  async pause(_handle: RuntimeHandle): Promise<void> { throw new Error('Claude Code stream JSON does not expose a pause primitive'); }
  async resume(_handle: RuntimeHandle): Promise<void> { throw new Error('Claude Code stream JSON does not expose a resume primitive'); }

  async stop(handle: RuntimeHandle): Promise<void> {
    const state = this.requireState(handle);
    await this.options.host!.stop(state.run);
  }

  async forkFromCheckpoint(_handle: RuntimeHandle, _sequence: number, _sop?: string): Promise<RuntimeHandle> {
    throw new Error('Claude Code checkpoint fork is not implemented by the desktop host');
  }

  private emit(state: ClaudeState, draft: RuntimeEventDraft): void {
    const event = { ...draft, sessionId: state.handle.sessionId, sequence: state.events.length + 1, occurredAt: new Date().toISOString() } as RuntimeEvent;
    state.events.push(event);
    state.subscribers.forEach((subscriber) => subscriber(event));
  }

  private requireState(handle: RuntimeHandle): ClaudeState {
    const state = this.states.get(handle.sessionId);
    if (!state || handle.runtimeId !== this.id) throw new Error(`Unknown Claude runtime handle ${handle.sessionId}`);
    return state;
  }
}

export function buildClaudeInvocation(plan: SessionPlan, options: { cwd?: string } = {}): ClaudeCliInvocation {
  const prompt = buildPrompt(plan);
  return {
    command: 'claude',
    args: ['--print', '--input-format', 'stream-json', '--output-format', 'stream-json', '--permission-mode', 'manual', '--verbose'],
    cwd: options.cwd,
    stdin: JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: prompt }] } }),
    initialPrompt: prompt,
    protocol: 'stream-json',
  };
}

export function mapClaudeMessage(message: unknown): RuntimeEventDraft[] {
  const raw = parseMessage(message);
  if (!raw) return [];
  if (raw.type === 'host.approval_required') {
    const approvalId = stringValue(raw.approvalId) || 'unknown';
    return [{
      type: 'approval_required', actorRef: 'employee:claude', approvalId,
      title: '受保护动作等待确认', message: stringValue(raw.reason) || '该动作需要真人批准。',
      tool: stringValue(raw.tool) || 'claude.unknown', args: isRecord(raw.args) ? raw.args : {},
      result: '等待 HUMMER 责任人决定。', durationMs: null, costCny: null,
      evidenceRefs: [`claude://approvals/${approvalId}`],
    }];
  }
  if (raw.type === 'assistant' && isRecord(raw.message) && Array.isArray(raw.message.content)) {
    return raw.message.content.flatMap((block): RuntimeEventDraft[] => {
      if (!isRecord(block)) return [];
      if (block.type === 'text' && stringValue(block.text)) return [{
        type: 'step', category: 'message', status: 'completed', actorRef: 'employee:claude',
        title: '执行进展', result: stringValue(block.text), evidenceRefs: ['claude://messages/assistant'],
      }];
      if (block.type === 'tool_use') return [{
        type: 'tool', status: 'running', actorRef: 'employee:claude', title: `调用 ${stringValue(block.name) || '工具'}`,
        tool: `claude.${stringValue(block.name) || 'unknown'}`, args: isRecord(block.input) ? block.input : {},
        result: '工具调用已开始。', durationMs: null, costCny: null,
        evidenceRefs: [`claude://tools/${stringValue(block.id) || 'unknown'}`],
      }];
      return [];
    });
  }
  if (raw.type === 'result') {
    const usage = extractUsage(raw.usage);
    if (raw.subtype !== 'success' || raw.is_error === true || raw.terminal_reason === 'api_error') return [{
      type: 'status', status: 'blocked', actorRef: 'employee:claude',
      reason: stringValue(raw.result) || stringValue(raw.error) || 'Claude Code 运行失败。', evidenceRefs: ['claude://session/failed'],
    }];
    return [{
      type: 'result', actorRef: 'employee:claude', title: '任务运行完成',
      summary: stringValue(raw.result) || '任务已完成。', deliverables: [{ name: '最终回复', kind: 'report' }],
      evidenceRefs: ['claude://session/completed'], durationMs: numberOrNull(raw.duration_ms), costCny: null,
      usage, rollback: { supported: false },
    }];
  }
  if (raw.type === 'host.stderr') return [{
    type: 'step', category: 'system', status: 'completed', actorRef: 'system:desktop-host',
    title: '执行内核诊断', result: stringValue(raw.line), evidenceRefs: ['claude://host/stderr'],
  }];
  return [];
}

function buildPrompt(plan: SessionPlan): string {
  return [plan.prompt, '', ...plan.understanding.map((item, index) => `${index + 1}. ${item}`), '', `Workspace scope: ${plan.workspaceScope}`, `Human gates: ${plan.humanGates.join('; ')}`].join('\n');
}

function extractClaudeSessionId(message: unknown): string | undefined {
  const raw = parseMessage(message);
  return raw ? stringValue(raw.session_id) || undefined : undefined;
}

function extractUsage(value: unknown): RuntimeTokenUsage | undefined {
  if (!isRecord(value)) return undefined;
  const inputTokens = numberValue(value.input_tokens);
  const outputTokens = numberValue(value.output_tokens);
  if (!inputTokens && !outputTokens) return undefined;
  return { totalTokens: inputTokens + outputTokens, inputTokens, cachedInputTokens: numberValue(value.cache_read_input_tokens), outputTokens };
}

function parseMessage(value: unknown): Record<string, unknown> | undefined {
  if (isRecord(value)) return value;
  if (typeof value !== 'string') return undefined;
  try { const parsed = JSON.parse(value); return isRecord(parsed) ? parsed : undefined; } catch { return undefined; }
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function stringValue(value: unknown): string { return typeof value === 'string' ? value : ''; }
function numberValue(value: unknown): number { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0; }
function numberOrNull(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
