import {
  createDemoResultPackage,
  type ResultPackage,
} from '../../work-orders/model/resultPackage';
import {
  createDemoWorkOrder,
  transitionWorkOrder,
  type WorkOrder,
  type WorkOrderCommandType,
} from '../../work-orders/model/workOrder';

export type ApprovalMode = 'L1' | 'L2' | 'L3';
export type SessionStatus = 'running' | 'awaiting_approval' | 'paused' | 'blocked' | 'delivered' | 'cancelled' | 'interrupted';
export type TrajectoryStepKind = 'delegation' | 'tool' | 'ai_to_human' | 'human_to_ai' | 'approval' | 'result' | 'system';
export type TrajectoryStepStatus = 'completed' | 'running' | 'awaiting_human' | 'blocked' | 'cancelled';

export interface PlanGeneration {
  source: 'runtime' | 'template';
  label: '模型生成计划' | '演示计划 · 未经模型生成';
  runtimeId?: string;
  planningSessionId?: string;
  receiptOutcomeEventId?: string;
  costCny?: number;
  fallbackReason?: string;
  costUnavailableReason?: string;
}

export interface SessionPlan {
  id: string;
  prompt: string;
  understanding: string[];
  assignees: string[];
  tools: string[];
  workspaceScope: string;
  humanGates: string[];
  estimate: string;
  approvalMode: ApprovalMode;
  attachmentNames: string[];
  modelProfile: string;
  workContext: string;
  responseSchema?: Record<string, unknown>;
  planning?: PlanGeneration;
}

export interface SandboxScope {
  workspacePath: string;
  networkAllowlist: string[];
  desktopAccess: 'read_only' | 'disabled';
  budgetCny: number;
  synthetic: true;
}

export interface TrajectoryStep {
  id: string;
  sequence: number;
  kind: TrajectoryStepKind;
  status: TrajectoryStepStatus;
  actorRef: string;
  title: string;
  tool?: string;
  args?: Record<string, unknown>;
  result?: string;
  output?: string;
  evidenceRefs: string[];
  durationMs?: number;
  costCny?: number;
  usage?: import('../runtime/adapter').RuntimeTokenUsage;
  occurredAt: string;
}

export interface ExecutionSession {
  id: string;
  tenantId: string;
  branchId: string;
  parentSessionId?: string;
  status: SessionStatus;
  approvalMode: ApprovalMode;
  workOrder: WorkOrder;
  sandbox: SandboxScope;
  activeApp: string;
  checkpointSequence: number;
  sopMarkdown: string;
  badCase?: string;
  steps: TrajectoryStep[];
  resultPackage?: ResultPackage;
}

const ACTOR = 'employee:gtm-researcher';
const NOW = '2026-08-25T06:30:00Z';

type PlanTemplate = Omit<SessionPlan, 'id' | 'prompt' | 'approvalMode' | 'attachmentNames' | 'modelProfile' | 'workContext'>;

const PLAN_TEMPLATES: Array<{ match: RegExp; plan: PlanTemplate }> = [
  {
    match: /线索|客户|CRM/i,
    plan: {
      understanding: ['读取并整理本周线索', '核验客户信息与关键联系人', '按客户分层规则排优先级', '生成 CRM 写回差异，提交前请你确认'],
      assignees: ['雪·销售官', '璇·数据官'],
      tools: ['fs.read', 'external.send.draft'],
      workspaceScope: '合成工作区 / GTM-2026Q3（可读写）',
      humanGates: ['写回 CRM 之前'],
      estimate: '约 8 分钟 · ¥3 以内',
    },
  },
  {
    match: /竞对|竞争|对比/i,
    plan: {
      understanding: ['明确竞对与比较维度', '读取合成资料并核验公开信息', '形成逐项对比与差异判断', '交付带证据的对比报告'],
      assignees: ['岚·分析官'],
      tools: ['fs.read'],
      workspaceScope: '合成工作区 / Market-Research（只读）',
      humanGates: ['采用外部结论之前'],
      estimate: '约 12 分钟 · ¥4 以内',
    },
  },
  {
    match: /合同|条款|法务/i,
    plan: {
      understanding: ['读取待审合同副本', '提取付款、交付与责任条款', '标记偏离标准模板的风险', '交付关键条款清单与复核建议'],
      assignees: ['苓·法务官'],
      tools: ['fs.read'],
      workspaceScope: '合成工作区 / Contracts（只读）',
      humanGates: ['形成对外法律意见之前'],
      estimate: '约 10 分钟 · ¥3 以内',
    },
  },
  {
    match: /复盘|总结|周报/i,
    plan: {
      understanding: ['汇总上周经营与任务数据', '定位目标与结果偏差', '提炼有效动作和坏例', '交付一页复盘与下周建议'],
      assignees: ['璇·数据官'],
      tools: ['fs.read'],
      workspaceScope: '合成工作区 / Weekly-Review（只读）',
      humanGates: ['发布复盘结论之前'],
      estimate: '约 7 分钟 · ¥2 以内',
    },
  },
  {
    match: /招聘|候选人|简历/i,
    plan: {
      understanding: ['读取岗位要求与候选资料', '按统一标准提取能力证据', '形成候选人比较清单', '交付面试建议但不代替真人决定'],
      assignees: ['澄·招聘官'],
      tools: ['fs.read'],
      workspaceScope: '合成工作区 / Hiring（只读）',
      humanGates: ['联系候选人或改变状态之前'],
      estimate: '约 9 分钟 · ¥3 以内',
    },
  },
];

const FALLBACK_PLAN: PlanTemplate = {
  understanding: ['确认目标与可验收结果', '读取本次授权范围内的合成资料', '执行任务并记录完整证据', '交付结果，涉及外部变化时先请你确认'],
  assignees: ['自动推荐数字员工'],
  tools: ['fs.read'],
  workspaceScope: '本次会话合成工作区（可读写）',
  humanGates: ['任何外部写入之前'],
  estimate: '约 10 分钟 · ¥3 以内',
};

export function draftPlanFromPrompt(prompt: string, opts: {
  assignee?: string;
  approvalMode?: ApprovalMode;
  attachmentNames?: string[];
  modelProfile?: string;
  workContext?: string;
} = {}): SessionPlan {
  const normalizedPrompt = prompt.trim();
  const template = PLAN_TEMPLATES.find(({ match }) => match.test(normalizedPrompt))?.plan ?? FALLBACK_PLAN;
  const echoedPrompt = normalizedPrompt.length > 52 ? `${normalizedPrompt.slice(0, 52)}…` : normalizedPrompt;
  return {
    ...template,
    id: stablePlanId(normalizedPrompt),
    prompt: normalizedPrompt,
    understanding: [`围绕「${echoedPrompt || '本次任务'}」确认交付目标`, ...template.understanding.slice(1)],
    assignees: opts.assignee && opts.assignee !== '自动推荐' ? [opts.assignee] : [...template.assignees],
    tools: [...template.tools],
    humanGates: [...template.humanGates],
    workspaceScope: opts.workContext ? `${opts.workContext}（仅限本次任务）` : template.workspaceScope,
    approvalMode: opts.approvalMode ?? 'L2',
    attachmentNames: [...(opts.attachmentNames ?? [])],
    modelProfile: opts.modelProfile ?? '标准',
    workContext: opts.workContext ?? '我的工作空间',
  };
}

export function createSessionFromPlan(plan: SessionPlan): ExecutionSession {
  const workOrder = startWorkOrder(
    `wo_${plan.id}`,
    plan.prompt,
    `完成「${plan.prompt}」，形成可验收且带证据的交付。`,
    employeeRef(plan.assignees[0]),
  );
  return {
    id: `ses_${plan.id}`,
    tenantId: 'tenant_fixture',
    branchId: 'main',
    status: 'running',
    approvalMode: plan.approvalMode,
    workOrder,
    sandbox: {
      workspacePath: plan.workspaceScope,
      networkAllowlist: ['docs.example.test', 'crm.example.test'],
      desktopAccess: 'read_only',
      budgetCny: estimateBudget(plan.estimate),
      synthetic: true,
    },
    activeApp: 'Synthetic Windows Desktop',
    checkpointSequence: 0,
    sopMarkdown: ['# 本次任务 SOP', '', `- 目标：${plan.prompt}`, '- 只使用合成资源；外部写入前必须遵守计划中的真人关口。'].join('\n'),
    steps: [],
  };
}

export function injectHumanMessage(session: ExecutionSession, text: string): ExecutionSession {
  const message = text.trim();
  if (!message) return session;
  return appendStep(session, 'human_to_ai', 'completed', 'human:operator', '真人补充要求', {
    result: message,
    evidenceRefs: [`evt://sessions/${session.id}/human-message`],
  });
}

export function createDemoSession(): ExecutionSession {
  const workOrder = startDemoWorkOrder('wo_gtm_q3_001');

  return {
    id: 'ses_gtm_q3_001',
    tenantId: 'tenant_fixture',
    branchId: 'main',
    status: 'running',
    approvalMode: 'L2',
    workOrder,
    sandbox: {
      workspacePath: '~/GTM-2026Q3',
      networkAllowlist: ['crm.example.test', 'docs.example.test'],
      desktopAccess: 'read_only',
      budgetCny: 80,
      synthetic: true,
    },
    activeApp: 'Synthetic Windows Desktop',
    checkpointSequence: 3,
    sopMarkdown: [
      '# Account qualification',
      '',
      '- Prioritize accounts with a named decision maker and a verifiable business trigger.',
      '- Draft CRM changes first. Never submit an external write without an approval step.',
      '- Attach evidence links and explain every exclusion.',
    ].join('\n'),
    steps: [
      step(1, 'delegation', 'completed', 'human:boss', '目标下达：筛选华东目标账户', {
        result: '委派给销售负责人分身，并拆为研究、核验、CRM 草稿三个子任务。',
        evidenceRefs: ['evt://work-orders/wo_gtm_q3_001/1'],
      }),
      step(2, 'tool', 'completed', ACTOR, '读取受控工作区与客户分层规则', {
        tool: 'workspace.read',
        args: { path: '~/GTM-2026Q3/customer-segmentation.md', mode: 'read_only' },
        result: '已读取 16 份合成资料，提取 20 个候选账户。',
        output: 'fixture://workspace/customer-candidates.csv',
        evidenceRefs: ['evi://workspace/customer-segmentation/v2.3'],
        durationMs: 1_280,
        costCny: 0.03,
      }),
      step(3, 'tool', 'completed', ACTOR, '在受控浏览器核验公开业务触发信号', {
        tool: 'browser.research',
        args: { allowlist: ['docs.example.test'], queries: 20 },
        result: '12 个账户具备可复核触发信号；8 个因证据不足被排除。',
        output: 'fixture://workspace/account-evidence.md',
        evidenceRefs: ['evi://browser/account-trigger-batch-01'],
        durationMs: 6_240,
        costCny: 0.11,
      }),
      step(4, 'ai_to_human', 'completed', ACTOR, 'AI 转交：确认 CRM 写回范围', {
        result: '生成了 12 条字段差异草稿；外部写回由策略拦截，等待业务负责人决定。',
        evidenceRefs: ['evi://diffs/crm-writeback-001'],
      }),
    ],
  };
}

export function setApprovalMode(session: ExecutionSession, approvalMode: ApprovalMode): ExecutionSession {
  return { ...session, approvalMode };
}

export function requestProtectedWrite(session: ExecutionSession): ExecutionSession {
  if (session.status !== 'running') return session;

  if (session.approvalMode === 'L1') {
    return appendStep({
      ...session,
      status: 'blocked',
      badCase: 'L1 仅建议模式不允许执行 CRM 写回。请提高自治等级或由真人接管。',
    }, 'tool', 'blocked', ACTOR, 'CRM 写回被策略阻断', {
      tool: 'crm.write',
      args: { records: 12, mode: 'external_write' },
      result: 'L1 仅建议：未生成写入请求。',
      evidenceRefs: ['policy://approval-mode/L1'],
    });
  }

  const requested = applyCommand(session.workOrder, 'request_approval');
  return appendStep({ ...session, workOrder: requested, status: 'awaiting_approval' }, 'tool', 'awaiting_human', ACTOR, 'CRM 写回差异等待批准', {
    tool: 'crm.write',
    args: { records: 12, mode: 'external_write', idempotencyKey: 'crm-writeback-001' },
    result: '策略命中：外部系统写入需要真人批准。',
    output: 'fixture://diffs/crm-writeback-001.json',
    evidenceRefs: ['evi://diffs/crm-writeback-001', 'policy://crm/external-write'],
    durationMs: 420,
    costCny: 0.01,
  });
}

export function decideProtectedWrite(session: ExecutionSession, approved: boolean): ExecutionSession {
  if (session.status !== 'awaiting_approval') return session;

  const workOrder = applyCommand(session.workOrder, approved ? 'approve_approval' : 'reject_approval');
  if (!approved) {
    return appendStep({ ...session, workOrder, status: 'blocked', badCase: '业务负责人拒绝 CRM 写回，保留差异草稿供修改后重跑。' }, 'approval', 'blocked', 'human:manager', '拒绝 CRM 写回', {
      result: '未向外部 CRM 发起请求。',
      evidenceRefs: ['evt://approval/crm-writeback-001'],
    });
  }

  const approvedOrder = applyCommand(workOrder, 'deliver');
  const resultPackage = makeResultPackage(approvedOrder, session.sopMarkdown, false);
  const withDecision = appendStep({ ...session, workOrder: approvedOrder, status: 'delivered', resultPackage }, 'human_to_ai', 'completed', 'human:manager', '真人批准，交还 AI 执行', {
    result: '批准的 12 条 CRM 变更已在合成连接器中提交，并生成可回滚凭证。',
    evidenceRefs: ['evt://approval/crm-writeback-001', 'evi://crm/receipt-001'],
  });

  return appendStep(withDecision, 'result', 'completed', ACTOR, '生成 ResultPackage', {
    result: resultPackage.summary,
    output: resultPackage.deliverables[0]?.uri,
    evidenceRefs: resultPackage.evidenceRefs,
    durationMs: 920,
    costCny: resultPackage.cost.totalCostCny,
  });
}

export function stopSession(session: ExecutionSession): ExecutionSession {
  if (session.status === 'cancelled' || session.status === 'delivered') return session;
  const workOrder = session.workOrder.status === 'running' || session.workOrder.status === 'awaiting_approval'
    ? applyCommand(session.workOrder, 'cancel')
    : session.workOrder;
  return appendStep({ ...session, workOrder, status: 'cancelled' }, 'system', 'cancelled', 'human:operator', '已停止本次会话', {
    result: '工具令牌已撤回，工作区保留至当前检查点。',
    evidenceRefs: ['evt://sessions/stopped'],
  });
}

export function pauseSession(session: ExecutionSession): ExecutionSession {
  if (session.status !== 'running') return session;
  return { ...session, status: 'paused' };
}

export function resumeSession(session: ExecutionSession): ExecutionSession {
  if (session.status !== 'paused') return session;
  return { ...session, status: 'running' };
}

export function reviseSop(session: ExecutionSession, sopMarkdown: string): ExecutionSession {
  return { ...session, sopMarkdown };
}

export function forkSession(session: ExecutionSession, fromSequence: number): ExecutionSession {
  const inheritedSteps = session.steps.filter((item) => item.sequence <= fromSequence);
  const workOrder = startDemoWorkOrder(`${session.workOrder.id}_fork_${fromSequence}`);
  const fork: ExecutionSession = {
    ...session,
    id: `${session.id}_fork_${fromSequence}`,
    branchId: `branch-${fromSequence}`,
    parentSessionId: session.id,
    status: 'running',
    workOrder,
    checkpointSequence: fromSequence,
    badCase: undefined,
    resultPackage: undefined,
    steps: inheritedSteps,
  };
  return appendStep(fork, 'system', 'completed', 'human:manager', `从第 ${fromSequence} 步创建复跑分支`, {
    result: '保留此前证据与输入，后续执行使用修订后的 SOP。',
    evidenceRefs: [`evt://sessions/${fork.id}/forked`],
  });
}

export function completeForkedSession(session: ExecutionSession): ExecutionSession {
  if (session.status !== 'running') return session;
  const workOrder = applyCommand(session.workOrder, 'deliver');
  const resultPackage = makeResultPackage(workOrder, session.sopMarkdown, true);
  const completed = appendStep({ ...session, workOrder, status: 'delivered', resultPackage }, 'tool', 'completed', ACTOR, '按修订 SOP 重新筛选账户', {
    tool: 'agent.replay',
    args: { checkpoint: session.checkpointSequence, sopRevision: true },
    result: resultPackage.summary,
    output: resultPackage.deliverables[0]?.uri,
    evidenceRefs: resultPackage.evidenceRefs,
    durationMs: 1_740,
    costCny: resultPackage.cost.totalCostCny,
  });
  return appendStep(completed, 'result', 'completed', ACTOR, '生成新的 ResultPackage', {
    result: '复跑结果已与主分支隔离，可比较差异后选择沉淀 SOP。',
    evidenceRefs: resultPackage.evidenceRefs,
  });
}

function startDemoWorkOrder(id: string): WorkOrder {
  return startWorkOrder(
    id,
    '华东目标账户研究与 CRM 草稿',
    '形成带证据的目标账户清单，并在批准后提交合成 CRM 写回。',
    'employee:gtm-researcher',
  );
}

function startWorkOrder(id: string, title: string, goal: string, assignedEmployeeId: string): WorkOrder {
  let order = createDemoWorkOrder({ id, title, goal, ownerActorRef: 'human:boss', assignedEmployeeId });
  order = applyCommand(order, 'submit');
  order = applyCommand(order, 'approve_assignment');
  order = applyCommand(order, 'plan');
  return applyCommand(order, 'start');
}

function stablePlanId(prompt: string): string {
  let hash = 2166136261;
  for (const character of prompt) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0).toString(36);
}

function employeeRef(assignee = '自动推荐数字员工'): string {
  return `employee:${assignee.replace(/[·\s（）()]/g, '-').replace(/-+/g, '-').toLowerCase()}`;
}

function estimateBudget(estimate: string): number {
  const matched = estimate.match(/¥\s*(\d+(?:\.\d+)?)/);
  return matched ? Number(matched[1]) : 3;
}

function applyCommand(order: WorkOrder, type: WorkOrderCommandType): WorkOrder {
  const transition = transitionWorkOrder(order, {
    type,
    actorRef: type === 'approve_approval' || type === 'reject_approval' ? 'human:manager' : ACTOR,
    expectedVersion: order.version,
    idempotencyKey: `${order.id}:${order.version + 1}:${type}`,
    occurredAt: NOW,
  });
  if (!transition.ok) throw new Error(transition.message);
  return transition.order;
}

function makeResultPackage(workOrder: WorkOrder, sopMarkdown: string, forked: boolean): ResultPackage {
  const prioritizesIndustry = /industry|行业/i.test(sopMarkdown);
  const summary = forked
    ? prioritizesIndustry
      ? '复跑完成：按行业优先级重排了 12 个账户，并补齐了 4 条证据链。'
      : '复跑完成：沿用原账户分层规则，结果与主分支保持一致。'
    : '已交付：12 个目标账户、CRM 差异草稿与可回滚凭证均已打包。';
  const resultPackage = createDemoResultPackage({
    id: `res_${workOrder.id}`,
    workOrderId: workOrder.id,
    tenantId: workOrder.tenantId,
    updatedAt: NOW,
  });
  return {
    ...resultPackage,
    summary,
    deliverables: [
      {
        id: `del_${workOrder.id}`,
        name: forked ? '复跑账户优先级报告' : '目标账户研究报告',
        kind: 'report',
        uri: forked ? 'fixture://results/gtm-research-replay.md' : 'fixture://results/gtm-research-report.md',
      },
    ],
    evidenceRefs: forked
      ? ['evi://workspace/customer-segmentation/v2.3', 'evi://replay/account-priority-diff']
      : ['evi://workspace/customer-segmentation/v2.3', 'evi://crm/receipt-001'],
  };
}

function appendStep(
  session: ExecutionSession,
  kind: TrajectoryStepKind,
  status: TrajectoryStepStatus,
  actorRef: string,
  title: string,
  details: Omit<TrajectoryStep, 'id' | 'sequence' | 'kind' | 'status' | 'actorRef' | 'title' | 'occurredAt'>,
): ExecutionSession {
  const sequence = session.steps.length === 0 ? 1 : Math.max(...session.steps.map((item) => item.sequence)) + 1;
  return {
    ...session,
    steps: [...session.steps, {
      id: `${session.id}:step:${sequence}`,
      sequence,
      kind,
      status,
      actorRef,
      title,
      occurredAt: NOW,
      ...details,
    }],
  };
}

function step(
  sequence: number,
  kind: TrajectoryStepKind,
  status: TrajectoryStepStatus,
  actorRef: string,
  title: string,
  details: Omit<TrajectoryStep, 'id' | 'sequence' | 'kind' | 'status' | 'actorRef' | 'title' | 'occurredAt'>,
): TrajectoryStep {
  return { id: `ses_gtm_q3_001:step:${sequence}`, sequence, kind, status, actorRef, title, occurredAt: NOW, ...details };
}
