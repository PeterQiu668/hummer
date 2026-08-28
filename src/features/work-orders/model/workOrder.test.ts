import { describe, expect, it } from 'vitest';
import {
  createDemoWorkOrder,
  transitionWorkOrder,
  type WorkOrderCommand,
  type WorkOrderTransitionResult,
} from './workOrder';

const baseOrder = () => createDemoWorkOrder({
  id: 'wo_demo_001',
  title: '研究 10 家合成目标客户',
  goal: '输出客户优先级与 BD 草稿建议',
  ownerActorRef: 'human:boss_demo',
  assignedEmployeeId: 'employee:gtm_researcher',
});

const command = (
  type: WorkOrderCommand['type'],
  expectedVersion: number,
  idempotencyKey: string,
): WorkOrderCommand => ({
  type,
  actorRef: 'human:boss_demo',
  expectedVersion,
  idempotencyKey,
  occurredAt: '2026-08-23T10:00:00Z',
});

describe('WorkOrder state machine', () => {
  it('rejects an invalid direct transition to delivery', () => {
    const result = transitionWorkOrder(baseOrder(), command('deliver', 0, 'cmd-direct-delivery'));

    expect(result).toEqual({
      ok: false,
      code: 'invalid_transition',
      message: 'deliver is not allowed while WorkOrder is draft',
    });
  });

  it('requires the expected version before a state change', () => {
    const result = transitionWorkOrder(baseOrder(), command('submit', 4, 'cmd-stale'));

    expect(result).toEqual({
      ok: false,
      code: 'stale_version',
      message: 'expected version 4 but WorkOrder is at version 0',
    });
  });

  it('makes a protected write pause the task until a human decision', () => {
    const submitted = expectSuccess(transitionWorkOrder(baseOrder(), command('submit', 0, 'cmd-submit')));
    const approved = expectSuccess(transitionWorkOrder(submitted.order, command('approve_assignment', 1, 'cmd-approve')));
    const planned = expectSuccess(transitionWorkOrder(approved.order, command('plan', 2, 'cmd-plan')));
    const running = expectSuccess(transitionWorkOrder(planned.order, command('start', 3, 'cmd-start')));
    const waiting = expectSuccess(transitionWorkOrder(running.order, command('request_approval', 4, 'cmd-write-request')));

    expect(waiting.order.status).toBe('awaiting_approval');
    expect(waiting.event.type).toBe('approval.requested');

    const released = expectSuccess(transitionWorkOrder(waiting.order, command('approve_approval', 5, 'cmd-write-approve')));
    expect(released.order.status).toBe('running');
    expect(released.event.type).toBe('approval.decided');
  });

  it('replays a duplicate command instead of creating another business effect', () => {
    const first = expectSuccess(transitionWorkOrder(baseOrder(), command('submit', 0, 'cmd-submit-once')));
    const replay = expectSuccess(transitionWorkOrder(first.order, command('submit', 99, 'cmd-submit-once')));

    expect(replay.replayed).toBe(true);
    expect(replay.order.version).toBe(1);
    expect(replay.event.sequence).toBe(1);
  });
});

function expectSuccess(result: WorkOrderTransitionResult): Extract<WorkOrderTransitionResult, { ok: true }> {
  if (!result.ok) {
    throw new Error('Expected a successful state transition.');
  }

  return result;
}
