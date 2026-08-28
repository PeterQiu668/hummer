import { describe, expect, it } from 'vitest';
import { InMemoryWorkOrderService } from '../work-orders/index.ts';
import { MockRuntimeAdapter } from './mock-runtime-adapter.ts';
import { RuntimeService } from './runtime-service.ts';

const now = '2026-08-24T00:00:00.000Z';
const context = (expectedVersion: number, idempotencyKey: string, actorRef = 'employee:gtm_researcher') => ({ actorRef, expectedVersion, idempotencyKey, correlationId: 'cor_runtime_demo', occurredAt: now });

async function runningService() {
  const service = new InMemoryWorkOrderService({ now: () => now });
  const order = await service.create({
    tenantId: 'tenant_demo', title: 'Synthetic GTM research', goal: 'Prioritize synthetic accounts', scope: 'Synthetic workspace only',
    acceptanceCriteria: [{ id: 'criterion_1', text: 'Reviewable report', required: true }], ownerActorRef: 'human:boss_demo',
    assignedEmployeeId: 'employee_gtm_researcher', budgetLimitCny: 10, riskLevel: 'low',
  }, { ...context(0, 'create-run-1', 'human:boss_demo') });
  await service.submit(order.id, { ...context(0, 'submit-run-1', 'human:boss_demo') });
  await service.approve(order.id, { ...context(1, 'approve-run-1', 'human:boss_demo') });
  await service.plan(order.id, { ...context(2, 'plan-run-1', 'human:boss_demo') });
  return { service, order: await service.start(order.id, { ...context(3, 'start-run-1') }) };
}

describe('MockRuntimeAdapter', () => {
  it('runs deterministic GTM research and creates a complete result package', async () => {
    const { service, order } = await runningService();
    const runtime = new RuntimeService(new MockRuntimeAdapter(), service, { now: () => now });
    const run = await runtime.start({ workOrder: order, runId: 'run_demo_001' });

    expect(run.status).toBe('awaiting_approval');
    expect(run.traceRef).toBe('trace_run_demo_001');
    expect(run.cost).toEqual({ modelTokens: 320, modelCostCny: 0.32, toolCostCny: 0.1, totalCostCny: 0.42 });
    expect(run.evidenceRefs).toEqual(['evi_00000001']);
    expect(run.resultPackage).toBeUndefined();

    const resumed = await runtime.resume(run.jobId, { approval: { status: 'approved', action: 'synthetic_csv_write' } });
    expect(resumed.status).toBe('completed');
    expect(resumed.resultPackage?.status).toBe('delivered');
    expect(resumed.resultPackage?.evidenceRefs).toEqual(['evi_00000001']);
    expect(resumed.resultPackage?.risk).toEqual({ level: 'high', notes: ['Synthetic CSV write is approval-gated.', 'No external system was contacted.'] });
  });

  it('emits redacted tool traces and never executes the write before approval', async () => {
    const { service, order } = await runningService();
    const runtime = new RuntimeService(new MockRuntimeAdapter(), service, { now: () => now });
    const run = await runtime.start({ workOrder: order, runId: 'run_demo_002' });
    const events = service.listEvents(order.id, order.tenantId);
    const toolEvents = events.filter((event) => event.type === 'tool.invoked');

    expect(toolEvents.map((event) => event.data)).toEqual([
      { tool: 'synthetic_gtm_search', class: 'read', traceRef: 'trace_run_demo_002', status: 'completed' },
      { tool: 'synthetic_csv_parse', class: 'read', traceRef: 'trace_run_demo_002', status: 'completed' },
      { tool: 'synthetic_crm_csv_write', class: 'write', traceRef: 'trace_run_demo_002', status: 'awaiting_approval', riskLevel: 'high' },
    ]);
    expect(JSON.stringify(toolEvents)).not.toMatch(/secret|token|password|customer|raw/i);
    expect(run.status).toBe('awaiting_approval');
    expect(events.some((event) => event.data.status === 'executed')).toBe(false);
  });

  it('blocks a rejected synthetic write and records classified risk', async () => {
    const { service, order } = await runningService();
    const runtime = new RuntimeService(new MockRuntimeAdapter(), service, { now: () => now });
    const run = await runtime.start({ workOrder: order, runId: 'run_demo_003' });
    const rejected = await runtime.resume(run.jobId, { approval: { status: 'rejected', action: 'synthetic_csv_write' } });

    expect(rejected.status).toBe('failed');
    expect(rejected.failure).toEqual({ code: 'approval_rejected', safeSummary: 'Synthetic write was blocked after human approval rejection.' });
    expect(rejected.risk).toEqual({ level: 'high', notes: ['Synthetic CSV write was rejected and not executed.'] });
    expect(service.listEvents(order.id, order.tenantId).some((event) => event.data.status === 'executed')).toBe(false);
  });

  it('cancels a pending run without network access', async () => {
    const { service, order } = await runningService();
    const runtime = new RuntimeService(new MockRuntimeAdapter(), service, { now: () => now });
    const run = await runtime.start({ workOrder: order, runId: 'run_demo_004' });
    const cancelled = await runtime.cancel(run.jobId, 'operator requested cancellation');
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.failure).toEqual({ code: 'cancelled', safeSummary: 'operator requested cancellation' });
  });
});
