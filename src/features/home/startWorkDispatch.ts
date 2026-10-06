import type { TaskEnvelope, WorkOrderTask } from '@hummer/contracts';
import type { ExecutionNodeRecord } from '../execution-nodes/executionNodeClient';
import type { SessionPlan } from '../sessions/model/session';
import type { StartWorkPlan, StartWorkRiskClass } from './startWorkPlan';
import { validateDispatchableStartWorkPlan } from './startWorkPlan';

export interface StartWorkDispatchIntent {
  schema: 'hummer.start-work-dispatch-intent';
  version: 1;
  status: 'pending';
  planId: string;
  confirmedBy: string;
  confirmedAt: string;
  envelope: TaskEnvelope;
}

export interface StartWorkDispatchIntentPort {
  record(intent: StartWorkDispatchIntent): void | Promise<void>;
}

export function adaptSessionPlanToStartWorkPlan(
  source: SessionPlan,
  nodes: readonly ExecutionNodeRecord[],
): StartWorkPlan {
  const node = nodes.find((candidate) => candidate.status === 'online' && candidate.currentSessionId === null)
    ?? nodes.find((candidate) => candidate.status === 'online');
  const targetRuntime = node ? fleetRuntime(node.runtimeId) : null;
  const totalCost = estimatedPlanCost(source.estimate);
  const steps = source.understanding.slice(0, 5);
  const perStepCost = totalCost === null ? null : totalCost / Math.max(steps.length, 1);

  return {
    id: source.id,
    target: source.prompt,
    status: 'pending',
    decidedBy: null,
    decidedAt: null,
    steps: steps.map((title, index) => ({
      id: `${source.id}:step:${index + 1}`,
      title,
      nodeLabel: node?.displayName ?? '未找到在线执行节点',
      targetNodeId: node?.id ?? null,
      targetRuntime,
      riskClass: node ? classifyRisk(title, source.tools) : 'unknown',
      estimatedCostCny: perStepCost,
    })),
  };
}

export function createStartWorkDispatchIntent(input: {
  plan: StartWorkPlan;
  sourcePlan: SessionPlan;
  tenantId: string;
  confirmedBy: string;
  confirmedAt: string;
}): StartWorkDispatchIntent {
  const validation = validateDispatchableStartWorkPlan(input.plan);
  if (!validation.ok) throw new Error(validation.errors.join('；'));
  if (!input.confirmedBy.startsWith('human:') || input.confirmedBy.length <= 'human:'.length) {
    throw new Error('只有具名人类操作者可以生成派发意图');
  }
  const first = input.plan.steps[0];
  const workOrderTask: WorkOrderTask = {
    schema: 'hummer.work-order-task',
    version: 1,
    title: conciseTitle(input.sourcePlan.prompt),
    target: input.sourcePlan.prompt,
    expectedDeliverable: input.sourcePlan.understanding.at(-1) ?? `完成「${input.sourcePlan.prompt}」`,
    assignee: input.sourcePlan.assignees.join(' + '),
    ...(input.sourcePlan.attachmentNames.length ? { attachmentNames: input.sourcePlan.attachmentNames } : {}),
    prompt: input.sourcePlan.prompt,
    origin: { system: 'hummer-ui', agent: input.confirmedBy, taskId: input.plan.id },
  };
  const envelope: TaskEnvelope = {
    schema: 'hummer.task-envelope',
    version: 1,
    workOrderTask,
    tenantId: input.tenantId,
    targetNodeId: first.targetNodeId!,
    targetRuntime: first.targetRuntime!,
    idempotencyKey: `start-work:${input.plan.id}`.slice(0, 128),
    leaseMs: 300_000,
    approvalPolicyRef: 'phase0-default-deny',
    expiresAt: new Date(Date.parse(input.confirmedAt) + 15 * 60_000).toISOString(),
    originRef: input.sourcePlan.workOrderId ?? `wo_${input.plan.id}`,
  };
  return {
    schema: 'hummer.start-work-dispatch-intent',
    version: 1,
    status: 'pending',
    planId: input.plan.id,
    confirmedBy: input.confirmedBy,
    confirmedAt: input.confirmedAt,
    envelope,
  };
}

function classifyRisk(step: string, tools: readonly string[]): StartWorkRiskClass {
  const text = `${step} ${tools.join(' ')}`;
  if (/未知|未识别|mystery|unknown/i.test(text)) return 'unknown';
  if (/删除|移除|清空|delete|remove|unlink/i.test(text)) return 'delete';
  if (/付款|采购|付费|费用|spend|payment|purchase/i.test(text)) return 'spend';
  if (/权限|授权|凭证|密钥|privilege|credential|grant/i.test(text)) return 'privilege';
  if (/联网|网络|端点|network|endpoint|browser/i.test(text)) return 'network';
  if (/发送|外发|发布|联系|邮件|egress|external\.send/i.test(text)) return 'egress';
  if (/写入|更新|覆盖|提交|回写|write|update|crm\./i.test(text)) return 'write';
  return 'none';
}

function fleetRuntime(runtimeId: string): StartWorkPlan['steps'][number]['targetRuntime'] {
  const normalized = runtimeId.toLowerCase();
  if (normalized.includes('codex')) return 'codex';
  if (normalized.includes('claude')) return 'claude';
  if (normalized.includes('deepseek')) return 'deepseek';
  if (normalized.includes('gui')) return 'gui-exec';
  return 'cli-other';
}

function estimatedPlanCost(estimate: string): number | null {
  const match = estimate.match(/¥\s*(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

function conciseTitle(prompt: string): string {
  const normalized = prompt.trim();
  return normalized.length <= 80 ? normalized : `${normalized.slice(0, 79)}…`;
}
