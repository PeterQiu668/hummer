import type { SessionPlan } from '../model/session';
import type { RuntimeAdapter, RuntimeEngineDisclosure, RuntimeEvent, RuntimeHandle, RuntimeTokenUsage, Unsubscribe } from './adapter';
import { calculateRuntimeCostCny, type RuntimePricing } from './pricing';

export interface CodexCliInvocation {
  command: 'codex';
  args: string[];
  cwd?: string;
  stdin: string;
  initialPrompt: string;
  engineProfileId: string;
  protocol: 'exec-jsonl' | 'app-server-jsonrpc';
  sandbox: 'read-only' | 'workspace-write';
  outputSchema?: Record<string, unknown>;
  authToken?: string;
}

export interface CodexCliRun {
  processId: string;
  nativeSessionId?: string;
  engine?: RuntimeEngineDisclosure;
}

export interface CodexCliCheckpoint {
  sequence: number;
  nativeTurnId: string;
}

export interface CodexCliHost {
  start(request: CodexCliInvocation): Promise<CodexCliRun>;
  subscribe(run: CodexCliRun, callback: (message: unknown) => void): Unsubscribe;
  respondToApproval?(run: CodexCliRun, id: string, approved: boolean): Promise<void>;
  sendHumanMessage?(run: CodexCliRun, text: string): Promise<void>;
  pause?(run: CodexCliRun): Promise<void>;
  resume?(run: CodexCliRun): Promise<void>;
  stop(run: CodexCliRun): Promise<void>;
  fork?(run: CodexCliRun, checkpoint: CodexCliCheckpoint, sop?: string): Promise<CodexCliRun>;
}

type RuntimeEventDraft = RuntimeEvent extends infer Event
  ? Event extends RuntimeEvent
    ? Omit<Event, 'sessionId' | 'sequence' | 'occurredAt'>
    : never
  : never;

interface CodexRuntimeState {
  handle: RuntimeHandle;
  run: CodexCliRun;
  log: RuntimeEvent[];
  subscribers: Set<(event: RuntimeEvent) => void>;
  unsubscribeHost: Unsubscribe;
  lastAgentMessage?: string;
  startedAtMs?: number;
  usage?: RuntimeTokenUsage;
  modelProfile: string;
  completedTurnIds: Map<number, string>;
}

export class CodexRuntimeAdapter implements RuntimeAdapter {
  readonly id = 'codex-cli';
  private readonly states = new Map<string, CodexRuntimeState>();
  private sessionCounter = 0;

  constructor(private readonly options: {
    enabled: boolean;
    host?: CodexCliHost;
    cwd?: string;
    protocol?: 'exec-jsonl' | 'app-server-jsonrpc';
    pricing?: RuntimePricing;
    getAuthToken?: () => string | null;
  }) {}

  async startSession(plan: SessionPlan): Promise<RuntimeHandle> {
    this.assertAvailable();
    const invocation = buildCodexInvocation(plan, {
      cwd: this.options.cwd,
      protocol: this.options.protocol ?? 'exec-jsonl',
      authToken: this.options.getAuthToken?.() ?? undefined,
    });
    const run = await this.options.host!.start(invocation);
    const handle: RuntimeHandle = {
      runtimeId: this.id,
      sessionId: `codex_${plan.id}_${++this.sessionCounter}`,
      engine: run.engine,
      nativeSessionId: run.nativeSessionId,
    };
    const state: CodexRuntimeState = {
      handle,
      run,
      log: [],
      subscribers: new Set(),
      unsubscribeHost: () => undefined,
      modelProfile: plan.modelProfile,
      completedTurnIds: new Map(),
    };
    state.unsubscribeHost = this.options.host!.subscribe(run, (message) => {
      const nativeSessionId = extractCodexThreadId(message);
      if (nativeSessionId) state.handle.nativeSessionId = nativeSessionId;
      if (isCodexMessageType(message, 'turn.started')) state.startedAtMs = Date.now();
      state.usage = extractCodexUsage(message) ?? state.usage;
      const durationMs = isCodexMessageType(message, 'turn.completed') && state.startedAtMs ? Date.now() - state.startedAtMs : null;
      const costCny = state.usage && this.options.pricing
        ? calculateRuntimeCostCny(state.modelProfile, state.usage, this.options.pricing)
        : null;
      const completedTurnId = isCodexMessageType(message, 'turn.completed') ? extractCodexTurnId(message) : undefined;
      for (const draft of mapCodexMessage(message, state.lastAgentMessage, { usage: state.usage, durationMs, costCny })) {
        if (draft.type === 'step' && draft.actorRef === 'employee:codex' && draft.category === 'message') {
          state.lastAgentMessage = draft.result;
        }
        this.emit(state, draft);
      }
      if (completedTurnId) state.completedTurnIds.set(state.log.length, completedTurnId);
    });
    this.states.set(handle.sessionId, state);
    return handle;
  }

  subscribe(handle: RuntimeHandle, callback: (event: RuntimeEvent) => void): Unsubscribe {
    const state = this.requireState(handle);
    state.log.forEach(callback);
    state.subscribers.add(callback);
    return () => state.subscribers.delete(callback);
  }

  async respondToApproval(handle: RuntimeHandle, id: string, approved: boolean): Promise<void> {
    const state = this.requireState(handle);
    if (!this.options.host?.respondToApproval) {
      throw new Error('codex exec --json cannot answer an in-flight approval; use an app-server JSON-RPC host bridge');
    }
    await this.options.host.respondToApproval(state.run, id, approved);
    this.emit(state, {
      type: 'approval_resolved',
      actorRef: 'human:operator',
      approvalId: id,
      approved,
      result: approved ? '真人已批准，runtime 可以继续受保护动作。' : '真人已拒绝，runtime 不得执行受保护动作。',
      evidenceRefs: [`codex://approvals/${id}/decision`],
    });
  }

  async sendHumanMessage(handle: RuntimeHandle, text: string): Promise<void> {
    const state = this.requireState(handle);
    if (!this.options.host?.sendHumanMessage) throw new Error('The configured Codex host cannot steer an active turn');
    await this.options.host.sendHumanMessage(state.run, text);
    this.emit(state, {
      type: 'step',
      category: 'message',
      status: 'completed',
      actorRef: 'human:operator',
      title: '你补充了要求',
      result: text,
      evidenceRefs: ['codex://turn/steer'],
    });
  }

  async pause(handle: RuntimeHandle): Promise<void> {
    const state = this.requireState(handle);
    if (!this.options.host?.pause) throw new Error('Pause is not exposed by the configured Codex host');
    await this.options.host.pause(state.run);
  }

  async resume(handle: RuntimeHandle): Promise<void> {
    const state = this.requireState(handle);
    if (!this.options.host?.resume) throw new Error('Resume is not exposed by the configured Codex host');
    await this.options.host.resume(state.run);
  }

  async stop(handle: RuntimeHandle): Promise<void> {
    const state = this.requireState(handle);
    await this.options.host!.stop(state.run);
  }

  async forkFromCheckpoint(handle: RuntimeHandle, sequence: number, sop?: string): Promise<RuntimeHandle> {
    const source = this.requireState(handle);
    if (!this.options.host?.fork) throw new Error('Fork requires an app-server host that can map a HUMMER checkpoint to a Codex thread fork');
    const nativeTurnId = source.completedTurnIds.get(sequence);
    if (!nativeTurnId) throw new Error('Codex can only fork a HUMMER checkpoint mapped to a completed native turn; sequence ' + sequence + ' is not forkable');
    const run = await this.options.host.fork(source.run, { sequence, nativeTurnId }, sop);
    const forkHandle: RuntimeHandle = {
      runtimeId: this.id,
      sessionId: `${handle.sessionId}_fork_${sequence}`,
      nativeSessionId: run.nativeSessionId,
      engine: source.handle.engine,
    };
    const state: CodexRuntimeState = {
      handle: forkHandle,
      run,
      log: source.log.filter((event) => event.sequence <= sequence).map((event) => ({ ...event, sessionId: forkHandle.sessionId })),
      subscribers: new Set(),
      unsubscribeHost: () => undefined,
      completedTurnIds: new Map([...source.completedTurnIds].filter(([checkpointSequence]) => checkpointSequence <= sequence)),
      modelProfile: source.modelProfile,
    };
    state.unsubscribeHost = this.options.host.subscribe(run, (message) => {
      const nativeSessionId = extractCodexThreadId(message);
      if (nativeSessionId) state.handle.nativeSessionId = nativeSessionId;
      if (isCodexMessageType(message, 'turn.started')) state.startedAtMs = Date.now();
      state.usage = extractCodexUsage(message) ?? state.usage;
      const durationMs = isCodexMessageType(message, 'turn.completed') && state.startedAtMs ? Date.now() - state.startedAtMs : null;
      const costCny = state.usage && this.options.pricing
        ? calculateRuntimeCostCny(state.modelProfile, state.usage, this.options.pricing)
        : null;
      const completedTurnId = isCodexMessageType(message, 'turn.completed') ? extractCodexTurnId(message) : undefined;
      mapCodexMessage(message, state.lastAgentMessage, { usage: state.usage, durationMs, costCny }).forEach((draft) => this.emit(state, draft));
      if (completedTurnId) state.completedTurnIds.set(state.log.length, completedTurnId);
    });
    this.states.set(forkHandle.sessionId, state);
    return forkHandle;
  }

  private emit(state: CodexRuntimeState, draft: RuntimeEventDraft): void {
    const event = {
      ...draft,
      sessionId: state.handle.sessionId,
      sequence: state.log.length + 1,
      occurredAt: new Date().toISOString(),
    } as RuntimeEvent;
    state.log.push(event);
    state.subscribers.forEach((subscriber) => subscriber(event));
  }

  private assertAvailable(): void {
    if (!this.options.enabled) throw new Error('CodexRuntimeAdapter is disabled');
    if (!this.options.host) throw new Error('No desktop CodexCliHost bridge is installed; browser JavaScript cannot spawn codex.exe directly');
  }

  private requireState(handle: RuntimeHandle): CodexRuntimeState {
    const state = this.states.get(handle.sessionId);
    if (!state || handle.runtimeId !== this.id) throw new Error(`Unknown Codex runtime handle ${handle.sessionId}`);
    return state;
  }
}

export function buildCodexInvocation(plan: SessionPlan, options: {
  cwd?: string;
  protocol?: 'exec-jsonl' | 'app-server-jsonrpc';
  authToken?: string;
} = {}): CodexCliInvocation {
  const protocol = options.protocol ?? 'exec-jsonl';
  if (protocol === 'app-server-jsonrpc') {
    return {
      engineProfileId: engineProfileIdForModelPolicy(plan.modelProfile),
      command: 'codex',
      args: ['app-server', '--listen', 'stdio://'],
      cwd: options.cwd,
      stdin: '',
      initialPrompt: buildCodexPrompt(plan),
      protocol,
      sandbox: sandboxForPlan(plan),
      outputSchema: plan.responseSchema,
      authToken: options.authToken,
    };
  }
  return {
    command: 'codex',
    args: ['exec', '--json', '--sandbox', sandboxForPlan(plan), '-'],
    engineProfileId: engineProfileIdForModelPolicy(plan.modelProfile),
    cwd: options.cwd,
    stdin: buildCodexPrompt(plan),
    initialPrompt: buildCodexPrompt(plan),
    protocol,
    sandbox: sandboxForPlan(plan),
    outputSchema: plan.responseSchema,
    authToken: options.authToken,
  };
}

export function engineProfileIdForModelPolicy(policy: string): string {
  if (policy === '\u65d7\u8230' || policy === '\u9ad8\u8d28\u91cf\u6a21\u578b') return 'openai-flagship';
  if (policy === '\u589e\u5f3a' || policy === '\u516c\u53f8\u79c1\u6709\u6a21\u578b') return 'zhipu-enhanced';
  return 'deepseek-standard';
}

export function mapCodexMessage(message: unknown, lastAgentMessage?: string, metrics: {
  usage?: RuntimeTokenUsage;
  durationMs?: number | null;
  costCny?: number | null;
} = {}): RuntimeEventDraft[] {
  const raw = parseMessage(message);
  if (!raw) return [];
  const type = stringValue(raw.type);

  if (type === 'host.stderr') {
    const line = stringValue(raw.line);
    return line ? [{
      type: 'step',
      category: 'system',
      status: 'completed',
      actorRef: 'system:desktop-host',
      title: 'Runtime 诊断',
      result: line,
      evidenceRefs: ['codex://host/stderr'],
    }] : [];
  }

  if (type === 'turn.started') {
    return [{
      type: 'step',
      category: 'system',
      status: 'running',
      actorRef: 'employee:codex',
      title: '执行内核开始运行',
      result: '已建立非交互运行，等待结构化事件。',
      evidenceRefs: ['codex://turn/started'],
    }];
  }

  if (type === 'item.completed' && isRecord(raw.item)) {
    const item = raw.item;
    const itemType = stringValue(item.type);
    const itemId = stringValue(item.id) || 'unknown';
    if (itemType === 'agent_message') {
      const text = stringValue(item.text);
      return text ? [{
        type: 'step',
        category: 'message',
        status: 'completed',
        actorRef: 'employee:codex',
        title: '执行进展',
        result: text,
        evidenceRefs: [`codex://items/${itemId}`],
      }] : [];
    }
    if (itemType === 'command_execution') {
      return [{
        type: 'tool',
        status: stringValue(item.status) === 'failed' ? 'blocked' : 'completed',
        actorRef: 'employee:codex',
        title: '执行本地命令',
        tool: 'shell.command',
        args: { command: item.command ?? null, cwd: item.cwd ?? null },
        result: stringValue(item.aggregated_output) || stringValue(item.output) || stringValue(item.status) || '命令已结束，未返回文本输出。',
        durationMs: numberOrNull(item.duration_ms),
        costCny: null,
        evidenceRefs: [`codex://items/${itemId}`],
      }];
    }
    if (itemType === 'mcp_tool_call') {
      const server = stringValue(item.server) || 'unknown';
      const tool = stringValue(item.tool) || 'unknown';
      return [{
        type: 'tool',
        status: stringValue(item.status) === 'failed' ? 'blocked' : 'completed',
        actorRef: 'employee:codex',
        title: `调用 MCP 工具 ${tool}`,
        tool: server === 'hummer_local' && tool === 'fs_read' ? 'fs.read' : `mcp.${server}.${tool}`,
        args: isRecord(item.arguments) ? item.arguments : {},
        result: stringifyResult(item.result ?? item.error ?? item.status),
        durationMs: numberOrNull(item.duration_ms),
        costCny: null,
        evidenceRefs: [`codex://items/${itemId}`],
      }];
    }
    if (itemType === 'file_change') {
      return [{
        type: 'tool',
        status: stringValue(item.status) === 'failed' ? 'blocked' : 'completed',
        actorRef: 'employee:codex',
        title: '应用工作区文件变更',
        tool: 'workspace.patch',
        args: { changes: item.changes ?? null },
        result: stringValue(item.status) || '文件变更已应用。',
        durationMs: numberOrNull(item.duration_ms),
        costCny: null,
        evidenceRefs: [`codex://items/${itemId}`],
      }];
    }
  }

  if (type === 'turn.completed') {
    return [{
      type: 'result',
      actorRef: 'employee:codex',
      title: '任务运行完成',
      summary: lastAgentMessage || '执行内核已完成运行；最终消息未出现在当前映射窗口。',
      deliverables: [{ name: '最终回复', kind: 'report' }],
      evidenceRefs: ['codex://turn/completed'],
      durationMs: metrics.durationMs ?? null,
      costCny: metrics.costCny ?? null,
      usage: metrics.usage,
      rollback: { supported: false },
    }];
  }

  if (type === 'turn.failed' || type === 'error') {
    const error = isRecord(raw.error) ? raw.error : raw;
    return [{
      type: 'status',
      status: 'blocked',
      actorRef: 'employee:codex',
      reason: stringValue(error.message) || '执行内核运行失败。',
      evidenceRefs: ['codex://turn/failed'],
    }];
  }

  if (stringValue(raw.method) === 'item/commandExecution/requestApproval' && isRecord(raw.params)) {
    const params = raw.params;
    const approvalId = stringValue(params.approvalId) || String(raw.id ?? 'unknown');
    const isFileChange = stringValue(params.kind) === 'fileChange';
    return [{
      type: 'approval_required',
      actorRef: 'employee:codex',
      approvalId,
      title: isFileChange ? '请求修改工作区文件' : '请求执行命令',
      message: stringValue(params.reason) || (isFileChange ? '文件变更需要真人批准后才能继续。' : '命令需要真人批准后才能继续。'),
      tool: isFileChange ? 'file.write.patch' : 'shell.command',
      args: { itemId: params.itemId ?? null, kind: params.kind ?? null },
      result: '等待 HUMMER 责任人决定。',
      durationMs: null,
      costCny: null,
      evidenceRefs: [`codex://approvals/${approvalId}`],
    }];
  }

  return [];
}

export function extractCodexTurnId(message: unknown): string | undefined {
  const raw = parseMessage(message);
  if (!raw || !/^turn\.(started|completed|failed)$/.test(stringValue(raw.type))) return undefined;
  return stringValue(raw.turn_id) || stringValue(raw.turnId) || undefined;
}


export function extractCodexThreadId(message: unknown): string | undefined {
  const raw = parseMessage(message);
  if (!raw || stringValue(raw.type) !== 'thread.started') return undefined;
  return stringValue(raw.thread_id) || stringValue(raw.threadId) || undefined;
}

export function extractCodexUsage(message: unknown): RuntimeTokenUsage | undefined {
  const raw = parseMessage(message);
  if (!raw) return undefined;
  const usage = isRecord(raw.usage) ? raw.usage : undefined;
  if (!usage) return undefined;
  const inputTokens = tokenNumber(usage.inputTokens ?? usage.input_tokens);
  const outputTokens = tokenNumber(usage.outputTokens ?? usage.output_tokens);
  const totalTokens = tokenNumber(usage.totalTokens ?? usage.total_tokens) || inputTokens + outputTokens;
  if (!totalTokens && !inputTokens && !outputTokens) return undefined;
  return {
    totalTokens,
    inputTokens,
    cachedInputTokens: tokenNumber(usage.cachedInputTokens ?? usage.cached_input_tokens),
    cacheWriteInputTokens: tokenNumber(usage.cacheWriteInputTokens ?? usage.cache_write_input_tokens),
    outputTokens,
    reasoningOutputTokens: tokenNumber(usage.reasoningOutputTokens ?? usage.reasoning_output_tokens),
  };
}

function sandboxForPlan(_plan: SessionPlan): 'read-only' {
  // Human gates in the prompt are informational. File writes are enforced by the
  // read-only sandbox/app-server approval protocol; other protected actions use
  // HUMMER's main-process controlled action channels.
  return 'read-only';
}

function buildCodexPrompt(plan: SessionPlan): string {
  return [
    plan.prompt,
    '',
    'Confirmed plan:',
    ...plan.understanding.map((item, index) => `${index + 1}. ${item}`),
    '',
    `Workspace scope: ${plan.workspaceScope}`,
    `Human gates are informational only: ${plan.humanGates.join('; ')}`,
    'For a requested file change, invoke the file-change tool normally. The read-only sandbox and app-server approval protocol will stop it before mutation and wait for a HUMMER decision; never bypass or emulate that gate.',
    'For any protected action that has no protocol-enforced gate, return a proposal for the HUMMER controlled action channel instead of performing it.',
    'Return a concise evidence-backed result. Do not access anything outside the stated scope.',
  ].join('\n');
}

function parseMessage(message: unknown): Record<string, unknown> | undefined {
  if (isRecord(message)) return message;
  if (typeof message !== 'string') return undefined;
  try {
    const parsed = JSON.parse(message);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function tokenNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function isCodexMessageType(message: unknown, type: string): boolean {
  return stringValue(parseMessage(message)?.type) === type;
}

function stringifyResult(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return '工具调用已结束，runtime 未提供结果文本。';
  try { return JSON.stringify(value); } catch { return String(value); }
}
