import type { SessionPlan } from '../model/session';
import type {
  RuntimeAdapter,
  RuntimeEvent,
  RuntimeHandle,
  RuntimeSessionStatus,
  Unsubscribe,
} from './adapter';

type RuntimeEventDraft = RuntimeEvent extends infer Event
  ? Event extends RuntimeEvent
    ? Omit<Event, 'sessionId' | 'sequence' | 'occurredAt'>
    : never
  : never;

interface MockRuntimeState {
  handle: RuntimeHandle;
  plan: SessionPlan;
  log: RuntimeEvent[];
  subscribers: Set<(event: RuntimeEvent) => void>;
  queue: RuntimeEventDraft[];
  timer?: ReturnType<typeof setTimeout>;
  status: RuntimeSessionStatus;
  pendingApprovalId?: string;
}

export class MockRuntimeAdapter implements RuntimeAdapter {
  readonly id = 'mock-runtime-v4';
  private readonly states = new Map<string, MockRuntimeState>();
  private readonly stepDelayMs: number;
  private sessionCounter = 0;

  constructor(options: { stepDelayMs?: number } = {}) {
    this.stepDelayMs = options.stepDelayMs ?? 260;
  }

  async startSession(plan: SessionPlan): Promise<RuntimeHandle> {
    const suffix = ++this.sessionCounter;
    const handle: RuntimeHandle = {
      runtimeId: this.id,
      sessionId: `mock_${plan.id}_${suffix}`,
      nativeSessionId: `mock-native-${suffix}`,
    };
    const state: MockRuntimeState = {
      handle,
      plan,
      log: [],
      subscribers: new Set(),
      queue: buildInitialScript(plan),
      status: 'running',
    };
    this.states.set(handle.sessionId, state);
    this.schedule(state);
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
    if (state.pendingApprovalId !== id) throw new Error(`Approval ${id} is not pending`);
    state.pendingApprovalId = undefined;
    this.emit(state, {
      type: 'approval_resolved',
      actorRef: 'human:operator',
      approvalId: id,
      approved,
      result: approved ? '批准本次合成 CRM 写回。' : '拒绝本次写回，保留差异草稿。',
      evidenceRefs: [`evt://approvals/${id}`],
    });

    if (!approved) {
      state.status = 'blocked';
      this.emitStatus(state, 'blocked', '真人拒绝了受保护写入。');
      return;
    }

    state.status = 'running';
    state.queue.push(...buildApprovedScript(state.plan));
    this.schedule(state);
  }

  async sendHumanMessage(handle: RuntimeHandle, text: string): Promise<void> {
    const state = this.requireState(handle);
    const message = text.trim();
    if (!message) return;
    this.emit(state, {
      type: 'step',
      category: 'message',
      status: 'completed',
      actorRef: 'human:operator',
      title: message,
      result: message,
      evidenceRefs: [`evt://sessions/${handle.sessionId}/human-message`],
    });
  }

  async pause(handle: RuntimeHandle): Promise<void> {
    const state = this.requireState(handle);
    if (state.status !== 'running') return;
    this.clearTimer(state);
    state.status = 'paused';
    this.emitStatus(state, 'paused', '会话冻结在当前检查点。');
  }

  async resume(handle: RuntimeHandle): Promise<void> {
    const state = this.requireState(handle);
    if (state.status !== 'paused') return;
    state.status = 'running';
    this.emitStatus(state, 'running', '从当前检查点继续。');
    this.schedule(state);
  }

  async stop(handle: RuntimeHandle): Promise<void> {
    const state = this.requireState(handle);
    if (state.status === 'cancelled' || state.status === 'delivered') return;
    this.clearTimer(state);
    state.queue = [];
    state.status = 'cancelled';
    this.emitStatus(state, 'cancelled', '工具令牌已撤回，合成工作区保留至当前检查点。');
  }

  async forkFromCheckpoint(handle: RuntimeHandle, sequence: number, sop?: string): Promise<RuntimeHandle> {
    const source = this.requireState(handle);
    const forkHandle: RuntimeHandle = {
      runtimeId: this.id,
      sessionId: `${handle.sessionId}_fork_${sequence}`,
      nativeSessionId: `${source.handle.nativeSessionId ?? handle.sessionId}:fork:${sequence}`,
    };
    const inherited = source.log
      .filter((event) => event.sequence <= sequence)
      .map((event) => ({ ...event, sessionId: forkHandle.sessionId }));
    const fork: MockRuntimeState = {
      handle: forkHandle,
      plan: source.plan,
      log: inherited,
      subscribers: new Set(),
      queue: [{
        type: 'step',
        category: 'system',
        status: 'completed',
        actorRef: 'human:operator',
        title: `从第 ${sequence} 个事件创建复跑分支`,
        result: sop ? '保留此前证据，后续执行使用修订 SOP。' : '保留此前证据并从检查点继续。',
        evidenceRefs: [`evt://sessions/${forkHandle.sessionId}/forked`],
      }, ...buildApprovedScript(source.plan, true)],
      status: 'running',
    };
    this.states.set(forkHandle.sessionId, fork);
    this.schedule(fork);
    return forkHandle;
  }

  private schedule(state: MockRuntimeState): void {
    if (state.timer || state.status !== 'running' || state.queue.length === 0) return;
    state.timer = setTimeout(() => {
      state.timer = undefined;
      const next = state.queue.shift();
      if (!next || state.status !== 'running') return;
      const event = this.emit(state, next);
      if (event.type === 'approval_required') {
        state.status = 'awaiting_approval';
        state.pendingApprovalId = event.approvalId;
        return;
      }
      if (event.type === 'status') state.status = event.status;
      if (event.type === 'result') state.status = 'delivered';
      this.schedule(state);
    }, this.stepDelayMs);
  }

  private emit(state: MockRuntimeState, draft: RuntimeEventDraft): RuntimeEvent {
    const event = {
      ...draft,
      sessionId: state.handle.sessionId,
      sequence: state.log.length + 1,
      occurredAt: new Date().toISOString(),
    } as RuntimeEvent;
    state.log.push(event);
    state.subscribers.forEach((subscriber) => subscriber(event));
    return event;
  }

  private emitStatus(state: MockRuntimeState, status: RuntimeSessionStatus, reason: string): void {
    this.emit(state, {
      type: 'status',
      status,
      actorRef: 'human:operator',
      reason,
      evidenceRefs: [`evt://sessions/${state.handle.sessionId}/status/${status}`],
    });
  }

  private clearTimer(state: MockRuntimeState): void {
    if (state.timer) clearTimeout(state.timer);
    state.timer = undefined;
  }

  private requireState(handle: RuntimeHandle): MockRuntimeState {
    const state = this.states.get(handle.sessionId);
    if (!state || handle.runtimeId !== this.id) throw new Error(`Unknown runtime handle ${handle.sessionId}`);
    return state;
  }
}

function buildInitialScript(plan: SessionPlan): RuntimeEventDraft[] {
  const actorRef = employeeActor(plan.assignees[0]);
  const preparation: RuntimeEventDraft[] = [
    {
      type: 'step',
      category: 'delegation',
      status: 'completed',
      actorRef: 'human:boss',
      title: `目标下达：${plan.prompt}`,
      result: `已派给 ${plan.assignees.join(' + ')}，按确认计划开始执行。`,
      evidenceRefs: [`evt://plans/${plan.id}/confirmed`],
    },
    {
      type: 'tool',
      status: 'completed',
      actorRef,
      title: '读取本次授权的工作资料',
      tool: 'workspace.read',
      args: { scope: plan.workspaceScope, attachments: plan.attachmentNames, mode: 'read_only' },
      result: '已读取 16 份演示资料，并建立任务输入索引。',
      output: 'fixture://workspace/input-index.json',
      durationMs: 1_280,
      costCny: null,
      evidenceRefs: ['evi://workspace/input-index'],
    },
    {
      type: 'tool',
      status: 'completed',
      actorRef,
      title: plan.understanding[1] ?? '按计划处理合成资料',
      tool: plan.tools.some((tool) => tool.includes('浏览器')) ? 'browser.research' : 'document.analyze',
      args: { synthetic: true, scope: plan.workspaceScope },
      result: '完成第一轮处理，已形成可复核的中间结果。',
      output: 'fixture://workspace/working-draft.md',
      durationMs: 4_620,
      costCny: null,
      evidenceRefs: ['evi://runtime/working-draft'],
    },
    {
      type: 'step',
      category: 'handoff',
      status: 'completed',
      actorRef,
      title: 'AI 转交：确认受保护动作范围',
      result: `已完成草稿；将在${plan.humanGates[0] ?? '外部写入前'}停下来问你。`,
      evidenceRefs: ['evi://runtime/preflight'],
    },
  ];

  if (plan.approvalMode === 'L1') {
    return [...preparation, {
      type: 'status',
      status: 'blocked',
      actorRef,
      reason: 'L1 只读模式不执行外部系统写入；差异草稿已保留，未创建审批请求。',
      evidenceRefs: ['policy://approval-mode/l1-read-only'],
    }];
  }

  return [...preparation,
    {
      type: 'approval_required',
      actorRef,
      approvalId: `approval_${plan.id}`,
      title: '客户管理系统更新等待确认',
      message: '确认后只会更新演示数据，并生成可撤回的交付记录。',
      tool: 'crm.write',
      args: { records: 12, mode: 'synthetic_external_write', idempotencyKey: `crm-${plan.id}` },
      result: '策略命中：外部系统写入需要真人批准。',
      diffRef: 'fixture://diffs/crm-writeback-v4.json',
      durationMs: 420,
      costCny: null,
      evidenceRefs: ['evi://diffs/crm-writeback-v4', 'policy://crm/external-write'],
    },
  ];
}

function buildApprovedScript(plan: SessionPlan, replay = false): RuntimeEventDraft[] {
  const actorRef = employeeActor(plan.assignees[0]);
  return [
    {
      type: 'tool',
      status: 'completed',
      actorRef,
      title: replay ? '按修订后的工作方法重新执行' : '提交已确认的客户管理系统更新',
      tool: replay ? 'agent.replay' : 'crm.write',
      args: replay ? { checkpoint: true, sopRevision: true } : { records: 12, mode: 'synthetic_external_write' },
      result: replay ? '重新执行完成，结果与原结果相互独立。' : '12 条演示记录更新成功，已生成撤回凭证。',
      output: replay ? 'fixture://results/replay-report.md' : 'fixture://crm/receipt-v4.json',
      durationMs: replay ? 1_740 : 920,
      costCny: null,
      evidenceRefs: replay ? ['evi://replay/result-diff'] : ['evi://crm/receipt-v4'],
    },
    {
      type: 'result',
      actorRef,
      title: '生成交付包',
      summary: replay ? '复跑完成：已生成与主分支隔离的结果，可比较后沉淀 SOP。' : '已交付：任务结果、证据与可回滚凭证均已打包。',
      deliverables: [{ name: replay ? '复跑差异报告' : '任务交付报告', kind: 'report', uri: replay ? 'fixture://results/replay-report.md' : 'fixture://results/task-report.md' }],
      evidenceRefs: replay ? ['evi://replay/result-diff'] : ['evi://workspace/input-index', 'evi://crm/receipt-v4'],
      durationMs: 360,
      costCny: null,
      rollback: { supported: true, instructions: '使用合成连接器回滚凭证恢复到执行前版本。' },
    },
  ];
}

function employeeActor(assignee = '自动推荐数字员工'): string {
  return `employee:${assignee.replace(/[·\s（）()]/g, '-').replace(/-+/g, '-').toLowerCase()}`;
}
