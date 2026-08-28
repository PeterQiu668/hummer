import { describe, expect, it } from 'vitest';
import { draftPlanFromPrompt } from '../model/session';
import type { RuntimeEvent } from './adapter';
import { MockRuntimeAdapter } from './mockRuntimeAdapter';

describe('MockRuntimeAdapter', () => {
  it('streams an append-only runtime-neutral event log and pauses at approval', async () => {
    const runtime = new MockRuntimeAdapter({ stepDelayMs: 1 });
    const plan = draftPlanFromPrompt('把这周的线索整理成跟进清单，写回 CRM 前先给我看');
    const handle = await runtime.startSession(plan);
    const events: RuntimeEvent[] = [];

    const unsubscribe = runtime.subscribe(handle, (event) => events.push(event));
    await waitForEvent(events, 'approval_required');
    unsubscribe();

    expect(events.map((event) => event.sequence)).toEqual(
      events.map((_, index) => index + 1),
    );
    expect(events.every((event) => event.sessionId === handle.sessionId)).toBe(true);
    expect(events.every((event) => Number.isNaN(Date.parse(event.occurredAt)) === false)).toBe(true);

    const toolEvents = events.filter((event) => event.type === 'tool');
    expect(toolEvents.length).toBeGreaterThan(0);
    for (const event of toolEvents) {
      expect(event.tool).toBeTruthy();
      expect(event.args).toBeTypeOf('object');
      expect(event.result).toBeTypeOf('string');
      expect(event.durationMs).toBeGreaterThanOrEqual(0);
      expect(event.costCny).toBeGreaterThanOrEqual(0);
      expect(event.evidenceRefs).toBeInstanceOf(Array);
    }
  });

  it('uses the same step event for human and AI actors and continues after approval', async () => {
    const runtime = new MockRuntimeAdapter({ stepDelayMs: 1 });
    const handle = await runtime.startSession(draftPlanFromPrompt('整理本周线索'));
    const events: RuntimeEvent[] = [];
    runtime.subscribe(handle, (event) => events.push(event));

    await waitForEvent(events, 'approval_required');
    await runtime.sendHumanMessage(handle, '等一下，先只做华东的');
    const humanEvent = events.find(
      (event) => event.type === 'step' && event.actorRef === 'human:operator',
    );
    const aiEvent = events.find(
      (event) => event.type === 'step' && event.actorRef.startsWith('employee:'),
    );
    expect(humanEvent?.type).toBe('step');
    expect(aiEvent?.type).toBe('step');

    const approval = events.find((event) => event.type === 'approval_required');
    if (!approval || approval.type !== 'approval_required') throw new Error('approval missing');
    await runtime.respondToApproval(handle, approval.approvalId, true);
    await waitForEvent(events, 'result');

    expect(events.some((event) => event.type === 'approval_resolved' && event.approved)).toBe(true);
    expect(events.at(-1)?.type).toBe('result');
  });

  it('stops future scripted work with one control call', async () => {
    const runtime = new MockRuntimeAdapter({ stepDelayMs: 20 });
    const handle = await runtime.startSession(draftPlanFromPrompt('做一份竞对报告'));
    const events: RuntimeEvent[] = [];
    runtime.subscribe(handle, (event) => events.push(event));

    await runtime.stop(handle);
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'status', status: 'cancelled' });
  });

  it('keeps L1 read-only and never creates an external-write approval', async () => {
    const runtime = new MockRuntimeAdapter({ stepDelayMs: 1 });
    const plan = draftPlanFromPrompt('整理本周线索');
    plan.approvalMode = 'L1';
    const handle = await runtime.startSession(plan);
    const events: RuntimeEvent[] = [];
    runtime.subscribe(handle, (event) => events.push(event));

    await waitForEvent(events, 'status');

    expect(events.some((event) => event.type === 'approval_required')).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: 'status', status: 'blocked' });
  });
});

async function waitForEvent(events: RuntimeEvent[], type: RuntimeEvent['type']): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    if (events.some((event) => event.type === type)) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error(`Timed out waiting for ${type}`);
}
