import type { RiskClass } from '@hummer/contracts';

export const START_WORK_CONTROLLED_RISK_CLASSES = [
  'egress',
  'write',
  'spend',
  'delete',
  'privilege',
  'network',
  'unknown',
] as const satisfies readonly RiskClass[];

export const START_WORK_RISK_CLASSES = [
  'none',
  ...START_WORK_CONTROLLED_RISK_CLASSES,
] as const;

export const START_WORK_RISK_PRESENTATION: Record<RiskClass, {
  label: string;
  approvalLabel: string;
  confirmable: boolean;
}> = {
  egress: { label: '对外发送', approvalLabel: '人工明确确认', confirmable: true },
  write: { label: '写入或覆盖', approvalLabel: '人工明确确认', confirmable: true },
  spend: { label: '产生费用', approvalLabel: '人工明确确认', confirmable: true },
  delete: { label: '删除', approvalLabel: '人工明确确认', confirmable: true },
  privilege: { label: '权限变更', approvalLabel: '人工明确确认', confirmable: true },
  network: { label: '新网络端点', approvalLabel: '人工明确确认', confirmable: true },
  unknown: { label: '未知 · 最高风险', approvalLabel: '禁止确认 · 先澄清', confirmable: false },
};

export type StartWorkRiskClass = 'none' | RiskClass;
export type StartWorkPlanStatus = 'pending' | 'confirmed' | 'rejected';
export type StartWorkDecision = 'confirm' | 'reject';

export interface StartWorkPlanStep {
  id: string;
  title: string;
  nodeLabel: string;
  targetNodeId: string | null;
  targetRuntime: 'codex' | 'claude' | 'deepseek' | 'cli-other' | 'gui-exec' | null;
  riskClass: StartWorkRiskClass;
  estimatedCostCny: number | null;
}

export interface StartWorkPlan {
  id: string;
  target: string;
  status: StartWorkPlanStatus;
  steps: StartWorkPlanStep[];
  decidedBy: string | null;
  decidedAt: string | null;
}

export interface StartWorkPlanValidation {
  ok: boolean;
  errors: string[];
}

export interface StartWorkPlanTransition {
  accepted: boolean;
  plan: StartWorkPlan;
  reason: string | null;
}

export function validatePendingStartWorkPlan(plan: StartWorkPlan): StartWorkPlanValidation {
  const errors: string[] = [];

  if (typeof plan.id !== 'string' || !plan.id.trim()) errors.push('计划缺少标识');
  if (typeof plan.target !== 'string' || !plan.target.trim()) errors.push('计划缺少目标');
  if (plan.status !== 'pending') errors.push('只允许载入待确认计划');
  if (plan.decidedBy !== null || plan.decidedAt !== null) errors.push('待确认计划不能包含既有决策');
  if (!Array.isArray(plan.steps) || plan.steps.length < 2 || plan.steps.length > 5) {
    errors.push('计划必须包含 2–5 个步骤');
    return { ok: false, errors };
  }

  const ids = new Set<string>();
  for (const [index, step] of plan.steps.entries()) {
    const prefix = `第 ${index + 1} 步`;
    if (!step || typeof step !== 'object') {
      errors.push(`${prefix}格式无效`);
      continue;
    }
    if (typeof step.id !== 'string' || !step.id.trim()) errors.push(`${prefix}缺少标识`);
    if (typeof step.id === 'string' && ids.has(step.id)) errors.push(`${prefix}标识重复`);
    if (typeof step.id === 'string') ids.add(step.id);
    if (typeof step.title !== 'string' || !step.title.trim()) errors.push(`${prefix}缺少动作`);
    if (typeof step.nodeLabel !== 'string' || !step.nodeLabel.trim()) errors.push(`${prefix}缺少执行节点`);
    if (!isStartWorkRiskClass(step.riskClass)) errors.push(`${prefix}风险类型无效`);
    if (step.estimatedCostCny !== null
      && (!Number.isFinite(step.estimatedCostCny) || step.estimatedCostCny < 0)) {
      errors.push(`${prefix}预估成本无效`);
    }
  }

  return { ok: errors.length === 0, errors };
}

export function validateDispatchableStartWorkPlan(plan: StartWorkPlan): StartWorkPlanValidation {
  const pending = validatePendingStartWorkPlan(plan);
  if (!pending.ok) return pending;

  const errors: string[] = [];
  for (const [index, step] of plan.steps.entries()) {
    const prefix = `第 ${index + 1} 步`;
    if (!step.targetNodeId || !step.targetRuntime) errors.push(`${prefix}没有可用执行节点`);
    if (step.riskClass !== 'none' && !START_WORK_RISK_PRESENTATION[step.riskClass]?.confirmable) {
      errors.push(`${prefix}风险未知，必须先澄清`);
    }
  }
  const nodeIds = new Set(plan.steps.map((step) => step.targetNodeId).filter(Boolean));
  const runtimes = new Set(plan.steps.map((step) => step.targetRuntime).filter(Boolean));
  if (nodeIds.size > 1 || runtimes.size > 1) errors.push('单个派发意图不能跨多个节点或运行时');

  return { ok: errors.length === 0, errors };
}

export function decideStartWorkPlan(
  plan: StartWorkPlan,
  decision: StartWorkDecision,
  actorRef: string,
  decidedAt: string,
): StartWorkPlanTransition {
  const validation = validatePendingStartWorkPlan(plan);
  if (!validation.ok) {
    return { accepted: false, plan, reason: validation.errors.join('；') };
  }
  if (!actorRef.startsWith('human:') || actorRef.length <= 'human:'.length) {
    return { accepted: false, plan, reason: '只有具名人类操作者可以确认或拒绝计划' };
  }
  if (!isIsoTimestamp(decidedAt)) {
    return { accepted: false, plan, reason: '决策时间无效' };
  }

  return {
    accepted: true,
    plan: {
      ...plan,
      status: decision === 'confirm' ? 'confirmed' : 'rejected',
      decidedBy: actorRef,
      decidedAt,
    },
    reason: null,
  };
}

export function totalEstimatedCostCny(plan: StartWorkPlan): number | null {
  if (plan.steps.some((step) => step.estimatedCostCny === null)) return null;
  return plan.steps.reduce((total, step) => total + (step.estimatedCostCny ?? 0), 0);
}

function isIsoTimestamp(value: string): boolean {
  return Boolean(value) && Number.isFinite(Date.parse(value));
}

function isStartWorkRiskClass(value: unknown): value is StartWorkRiskClass {
  return typeof value === 'string' && (START_WORK_RISK_CLASSES as readonly string[]).includes(value);
}
