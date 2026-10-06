import type { TaskEnvelope } from '@hummer/contracts';
import type { RemoteRelayBatchResult } from '../execution-nodes/remoteRelayClient';

export type BatchRuntime = TaskEnvelope['targetRuntime'];

export interface BatchDispatchNode {
  id: string;
  label: string;
  runtime: BatchRuntime;
  status: 'online' | 'offline';
}

export interface BatchDispatchDraft {
  target: string;
  expectedDeliverable: string;
  targetNodeId: string;
}

export interface BatchDispatchPort {
  listNodes(): Promise<readonly BatchDispatchNode[]>;
  enqueueBatch(envelopes: readonly TaskEnvelope[]): Promise<readonly RemoteRelayBatchResult[]>;
}

export function buildBatchTaskEnvelopes(input: {
  drafts: readonly BatchDispatchDraft[];
  nodes: readonly BatchDispatchNode[];
  tenantId: string;
  confirmedBy: string;
  confirmedAt: string;
  batchId: string;
}): readonly TaskEnvelope[] {
  if (input.drafts.length < 2 || input.drafts.length > 20) {
    throw new Error('批量派活必须包含 2–20 条任务');
  }
  if (!input.tenantId.trim() || input.tenantId.length > 128) throw new Error('当前租户不可用');
  if (!/^human:[A-Za-z0-9_-]+$/.test(input.confirmedBy)) throw new Error('只有具名人类操作者可以确认批量派活');
  if (!input.batchId.trim() || input.batchId.length > 80 || !Number.isFinite(Date.parse(input.confirmedAt))) {
    throw new Error('批量确认信息无效');
  }

  const nodes = new Map(input.nodes.map((node) => [node.id, node]));
  const expiresAt = new Date(Date.parse(input.confirmedAt) + 15 * 60_000).toISOString();
  return input.drafts.map((draft, index) => {
    const target = draft.target.trim();
    const expectedDeliverable = draft.expectedDeliverable.trim();
    const node = nodes.get(draft.targetNodeId);
    if (!target) throw new Error(`第 ${index + 1} 条缺少目标`);
    if (!expectedDeliverable) throw new Error(`第 ${index + 1} 条缺少交付物`);
    if (target.length > 32_768 || expectedDeliverable.length > 32_768) throw new Error(`第 ${index + 1} 条内容过长`);
    if (!node || node.status !== 'online') throw new Error(`第 ${index + 1} 条目标节点不可用`);
    if (!node.id.trim() || node.id.length > 128) throw new Error(`第 ${index + 1} 条目标节点无效`);
    const itemId = `${input.batchId}-${index + 1}`;
    const envelope = {
      schema: 'hummer.task-envelope',
      version: 1,
      workOrderTask: {
        schema: 'hummer.work-order-task',
        version: 1,
        title: target.length <= 80 ? target : `${target.slice(0, 79)}…`,
        target,
        expectedDeliverable,
        assignee: (node.label.trim() || node.id).slice(0, 512),
        prompt: target,
        origin: {
          system: 'hummer-web',
          device: 'mobile-web',
          agent: input.confirmedBy,
          taskId: itemId,
        },
      },
      tenantId: input.tenantId,
      targetNodeId: node.id,
      targetRuntime: node.runtime,
      idempotencyKey: `mobile-batch:${itemId}`.slice(0, 128),
      leaseMs: 300_000,
      approvalPolicyRef: 'phase0-default-deny',
      expiresAt,
      originRef: `wo_mobile_${itemId}`.slice(0, 128),
    } satisfies TaskEnvelope;
    return envelope;
  });
}
