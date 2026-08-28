import { createDemoResultPackage } from '../../work-orders/model/resultPackage';
import { createSessionFromPlan, type ExecutionSession, type SessionPlan, type TrajectoryStep } from '../model/session';
import type { RuntimeEvent, RuntimeHandle } from './adapter';

export interface RuntimeSessionProjection {
  session: ExecutionSession;
  pendingApproval?: Extract<RuntimeEvent, { type: 'approval_required' }>;
}

export function projectRuntimeSession(
  plan: SessionPlan,
  handle: RuntimeHandle,
  events: RuntimeEvent[],
): RuntimeSessionProjection {
  const base = createSessionFromPlan(plan);
  const steps = events.flatMap((event) => {
    const step = eventToTrajectoryStep(handle.sessionId, event);
    return step ? [step] : [];
  });
  const status = events.reduce<ExecutionSession['status']>((current, event) => {
    if (event.type === 'approval_required') return 'awaiting_approval';
    if (event.type === 'approval_resolved') return event.approved ? 'running' : 'blocked';
    if (event.type === 'status') return event.status;
    if (event.type === 'result') return 'delivered';
    return current;
  }, 'running');
  const resultEvent = [...events].reverse().find((event) => event.type === 'result');
  const resultPackage = resultEvent?.type === 'result'
    ? {
        ...createDemoResultPackage({
          id: `res_${handle.sessionId}`,
          workOrderId: base.workOrder.id,
          tenantId: base.tenantId,
          updatedAt: resultEvent.occurredAt,
          createdAt: resultEvent.occurredAt,
        }),
        summary: resultEvent.summary,
        deliverables: resultEvent.deliverables.map((deliverable, index) => ({
          id: `del_${handle.sessionId}_${index + 1}`,
          ...deliverable,
        })),
        evidenceRefs: resultEvent.evidenceRefs,
        cost: {
          modelTokens: resultEvent.usage?.totalTokens ?? 0,
          modelCostCny: resultEvent.costCny ?? 0,
          toolCostCny: 0,
          totalCostCny: resultEvent.costCny ?? 0,
        },
        rollback: resultEvent.rollback,
      }
    : undefined;
  const workOrderStatus = status === 'paused' ? 'running' : status;

  return {
    session: {
      ...base,
      id: handle.sessionId,
      branchId: handle.sessionId.includes('_fork_') ? handle.sessionId.split('_fork_').at(-1) ?? 'fork' : 'main',
      parentSessionId: handle.sessionId.includes('_fork_') ? handle.sessionId.split('_fork_')[0] : undefined,
      status,
      workOrder: { ...base.workOrder, status: workOrderStatus },
      checkpointSequence: steps.at(-1)?.sequence ?? 0,
      steps,
      resultPackage,
    },
    pendingApproval: findPendingApproval(events),
  };
}

export function findPendingApproval(events: RuntimeEvent[]): Extract<RuntimeEvent, { type: 'approval_required' }> | undefined {
  const resolved = new Set(
    events.filter((event) => event.type === 'approval_resolved').map((event) => event.approvalId),
  );
  return [...events]
    .reverse()
    .find((event): event is Extract<RuntimeEvent, { type: 'approval_required' }> => (
      event.type === 'approval_required' && !resolved.has(event.approvalId)
    ));
}

function eventToTrajectoryStep(sessionId: string, event: RuntimeEvent): TrajectoryStep | undefined {
  const common = {
    id: `${sessionId}:event:${event.sequence}`,
    sequence: event.sequence,
    actorRef: event.actorRef,
    occurredAt: event.occurredAt,
  };
  if (event.type === 'step') {
    return {
      ...common,
      kind: stepKind(event),
      status: event.status,
      title: event.title,
      result: event.result,
      output: event.output,
      durationMs: event.durationMs ?? undefined,
      costCny: event.costCny ?? undefined,
      evidenceRefs: event.evidenceRefs,
    };
  }
  if (event.type === 'tool') {
    return {
      ...common,
      kind: 'tool',
      status: event.status,
      title: event.title,
      tool: event.tool,
      args: event.args,
      result: event.result,
      output: event.output,
      durationMs: event.durationMs ?? undefined,
      costCny: event.costCny ?? undefined,
      evidenceRefs: event.evidenceRefs,
    };
  }
  if (event.type === 'approval_required') {
    return {
      ...common,
      kind: 'approval',
      status: 'awaiting_human',
      title: event.title,
      tool: event.tool,
      args: event.args,
      result: event.result,
      output: event.diffRef,
      durationMs: event.durationMs ?? undefined,
      costCny: event.costCny ?? undefined,
      evidenceRefs: event.evidenceRefs,
    };
  }
  if (event.type === 'approval_resolved') {
    return {
      ...common,
      kind: 'human_to_ai',
      status: event.approved ? 'completed' : 'blocked',
      title: event.approved ? '真人批准，交还 AI 执行' : '真人拒绝受保护动作',
      result: event.result,
      evidenceRefs: event.evidenceRefs,
    };
  }
  if (event.type === 'status') {
    return {
      ...common,
      kind: 'system',
      status: event.status === 'cancelled' ? 'cancelled' : event.status === 'blocked' ? 'blocked' : 'completed',
      title: statusTitle(event.status),
      result: event.reason ?? '会话状态已更新。',
      evidenceRefs: event.evidenceRefs,
    };
  }
  return {
    ...common,
    kind: 'result',
    status: 'completed',
    title: event.title,
    result: event.summary,
    output: event.deliverables[0]?.uri,
    durationMs: event.durationMs ?? undefined,
    costCny: event.costCny ?? undefined,
    usage: event.usage,
    evidenceRefs: event.evidenceRefs,
  };
}

function stepKind(event: Extract<RuntimeEvent, { type: 'step' }>): TrajectoryStep['kind'] {
  if (event.category === 'delegation') return 'delegation';
  if (event.category === 'system') return 'system';
  if (event.actorRef.startsWith('human:')) return 'human_to_ai';
  return event.category === 'handoff' ? 'ai_to_human' : 'system';
}

function statusTitle(status: Extract<RuntimeEvent, { type: 'status' }>['status']): string {
  return {
    running: '会话继续执行',
    awaiting_approval: '会话等待批准',
    paused: '会话已暂停',
    blocked: '会话被策略阻断',
    delivered: '会话已交付',
    cancelled: '已停止本次会话',
  }[status];
}
