import { describe, expect, it } from 'vitest';
import { DomainError, InMemoryWorkOrderService, type TenantRole } from './index.ts';

const now = '2026-08-24T00:00:00.000Z';
const input = {
  tenantId: 'tenant_demo', title: 'Synthetic GTM research', goal: 'Prioritize synthetic accounts', scope: 'Synthetic workspace only',
  acceptanceCriteria: [{ id: 'criterion_1', text: 'Reviewable report', required: true }], ownerActorRef: 'human:boss_demo',
  assignedEmployeeId: 'employee_gtm_researcher', budgetLimitCny: 10, riskLevel: 'low' as const,
};
const context = (expectedVersion: number, idempotencyKey: string, actorRef = 'human:boss_demo', tenantId = input.tenantId, actorRole: TenantRole = 'owner') => ({ tenantId, actorRef, actorRole, expectedVersion, idempotencyKey, correlationId: 'cor_demo', occurredAt: now });

async function runningService() {
  const service = new InMemoryWorkOrderService({ now: () => now });
  const order = await service.create(input, context(0, 'create-001'));
  await service.submit(order.id, context(0, 'submit-001'));
  await service.approve(order.id, context(1, 'assign-001'));
  await service.plan(order.id, context(2, 'plan-001'));
  return { service, order: await service.start(order.id, context(3, 'start-001')) };
}

const resultInput = {
  summary: 'Synthetic result',
  deliverables: [{ id: 'del_1', name: 'Research report', kind: 'report' as const }],
  acceptanceCriteria: [{ id: 'criterion_1', text: 'Reviewable report', verdict: 'pending' as const }],
  evidenceRefs: ['evi_00000001'], cost: { modelTokens: 10, modelCostCny: 0.1, toolCostCny: 0.2, totalCostCny: 0.3 },
  risk: { level: 'low' as const, notes: ['Synthetic workspace only'] }, rollback: { supported: true, instructions: 'Restore fixture revision.' },
};

describe('Wave 1 WorkOrder service', () => {
  it('enforces the state machine and appends a hash-chained event for each transition', async () => {
    const service = new InMemoryWorkOrderService({ now: () => now });
    const order = await service.create(input, context(0, 'create-002'));
    await expect(service.start(order.id, context(0, 'start-invalid'))).rejects.toMatchObject({ code: 'invalid_transition' });
    const submitted = await service.submit(order.id, context(0, 'submit-002'));
    expect(submitted.status).toBe('submitted');
    const events = service.listEvents(order.id, input.tenantId);
    expect(events.map((event) => event.type)).toEqual(['work_order.created', 'work_order.submitted']);
    expect(events.map((event) => event.sequence)).toEqual([1, 2]);
    expect(events[1].previousEventHash).toBe(events[0].eventHash);
    expect(Object.isFrozen(events[0])).toBe(true);
    expect(() => { (events[0] as { type: string }).type = 'tampered'; }).toThrow();
  });

  it('replays duplicate commands and rejects stale versions without appending', async () => {
    const service = new InMemoryWorkOrderService({ now: () => now });
    const order = await service.create(input, context(0, 'create-003'));
    const first = await service.submit(order.id, context(0, 'submit-003'));
    const replay = await service.submit(order.id, context(99, 'submit-003'));
    expect(replay).toBe(first);
    await expect(service.approve(order.id, context(0, 'assign-stale'))).rejects.toMatchObject({ code: 'stale_version' });
    expect(service.listEvents(order.id, input.tenantId)).toHaveLength(2);
  });

  it('holds every high-risk synthetic write for human approval and blocks rejected writes', async () => {
    const { service, order } = await runningService();
    const approval = await service.requestApproval(order.id, { action: 'synthetic_csv_write', riskLevel: 'high', rationale: 'Write to synthetic fixture', requesterActorRef: 'employee:gtm_researcher' }, context(4, 'approval-001', 'employee:gtm_researcher'));
    expect(approval.status).toBe('pending');
    expect(service.get(input.tenantId, order.id).status).toBe('awaiting_approval');
    await expect(service.executeSyntheticWrite(order.id, context(5, 'write-before-decision', 'employee:gtm_researcher'))).rejects.toMatchObject({ code: 'forbidden' });
    await service.reject(order.id, context(5, 'approval-reject-001'));
    await expect(service.executeSyntheticWrite(order.id, context(6, 'write-after-reject', 'employee:gtm_researcher'))).rejects.toMatchObject({ code: 'forbidden' });
    expect(service.getApproval(input.tenantId, approval.id).status).toBe('rejected');
    expect(service.listEvents(order.id, input.tenantId).some((event) => event.type === 'tool.invoked')).toBe(false);
  });

  it('allows an approved synthetic write and keeps the approval decision immutable', async () => {
    const { service, order } = await runningService();
    const approval = await service.requestApproval(order.id, { action: 'synthetic_crm_write', riskLevel: 'high', rationale: 'Write to synthetic fixture', requesterActorRef: 'employee:gtm_researcher' }, context(4, 'approval-002', 'employee:gtm_researcher'));
    await service.approve(order.id, context(5, 'approval-approve-002'));
    const invocation = await service.executeSyntheticWrite(order.id, context(6, 'write-approved', 'employee:gtm_researcher'));
    expect(invocation.event.type).toBe('tool.invoked');
    expect(service.getApproval(input.tenantId, approval.id).status).toBe('approved');
    await expect(service.decideApproval(order.id, context(6, 'approval-change-002'), 'rejected')).rejects.toMatchObject({ code: 'invalid_transition' });
  });

  it('hashes evidence bytes and requires a complete ResultPackage', async () => {
    const { service, order } = await runningService();
    const evidence = await service.addEvidence(order.id, { sourceRef: 'fixture://synthetic/report', bytes: new TextEncoder().encode('evidence'), redactedSummary: 'Synthetic report summary', ownerActorRef: 'employee:gtm_researcher' }, context(4, 'evidence-001', 'employee:gtm_researcher'));
    expect(evidence.hash).toBe('ee8250fb76e094b34b471f13a73dbbe51d1ae142e9df59d7c0d31ec20f0a0a8e');
    const result = await service.createResultPackage(order.id, { ...resultInput, evidenceRefs: [evidence.id] }, context(4, 'result-001', 'employee:gtm_researcher'));
    expect(result.status).toBe('delivered');
    const accepted = await service.accept(order.id, { actorRef: 'human:boss_demo', decision: 'accepted', verdicts: [{ criterionId: 'criterion_1', verdict: 'passed' }] }, context(5, 'accept-001'));
    expect(accepted.status).toBe('accepted');
    await expect(service.createResultPackage(order.id, { ...resultInput, deliverables: [] }, context(6, 'result-invalid', 'employee:gtm_researcher'))).rejects.toBeInstanceOf(DomainError);
  });

  it('[TEN-P0-API-WORKORDER-BARE-ID] rejects cross-tenant reads, writes, idempotency collisions and final acceptance by auditor/operator roles', async () => {
    const service = new InMemoryWorkOrderService({ now: () => now });
    const sharedId = 'wo_shared';
    const tenantA = await service.create({ ...input, id: sharedId }, context(0, 'same-command', 'human:boss_demo', 'tenant_demo'));
    const tenantB = await service.create({ ...input, id: sharedId, tenantId: 'tenant_other', ownerActorRef: 'human:other' }, context(0, 'same-command', 'human:other', 'tenant_other'));

    expect(tenantA.tenantId).toBe('tenant_demo');
    expect(tenantB.tenantId).toBe('tenant_other');
    expect(service.get('tenant_demo', sharedId).ownerActorRef).toBe('human:boss_demo');
    expect(service.get('tenant_other', sharedId).ownerActorRef).toBe('human:other');
    expect(() => service.get('tenant_missing', sharedId)).toThrowError(DomainError);
    await expect(service.submit(sharedId, context(0, 'cross-write', 'human:other', 'tenant_missing'))).rejects.toMatchObject({ code: 'not_found' });

    await service.submit(sharedId, context(0, 'a-submit-01', 'human:boss_demo', 'tenant_demo'));
    await service.approve(sharedId, context(1, 'a-approve-1', 'human:boss_demo', 'tenant_demo'));
    await service.plan(sharedId, context(2, 'a-plan-001', 'human:boss_demo', 'tenant_demo'));
    await service.start(sharedId, context(3, 'a-start-001', 'human:boss_demo', 'tenant_demo'));
    const evidence = await service.addEvidence(sharedId, { sourceRef: 'fixture://tenant-a', bytes: new TextEncoder().encode('tenant-a'), redactedSummary: 'tenant A evidence', ownerActorRef: 'employee:gtm_researcher' }, context(4, 'a-evid-001', 'employee:gtm_researcher', 'tenant_demo', 'operator'));
    await service.createResultPackage(sharedId, { ...resultInput, evidenceRefs: [evidence.id] }, context(4, 'a-result-01', 'employee:gtm_researcher', 'tenant_demo', 'operator'));
    await expect(service.accept(sharedId, { actorRef: 'human:auditor', decision: 'accepted', verdicts: [{ criterionId: 'criterion_1', verdict: 'passed' }] }, context(5, 'a-accept-01', 'human:auditor', 'tenant_demo', 'auditor'))).rejects.toMatchObject({ code: 'forbidden' });
    await expect(service.accept(sharedId, { actorRef: 'human:operator', decision: 'accepted', verdicts: [{ criterionId: 'criterion_1', verdict: 'passed' }] }, context(5, 'a-accept-02', 'human:operator', 'tenant_demo', 'operator'))).rejects.toMatchObject({ code: 'forbidden' });
    expect(service.get('tenant_other', sharedId).status).toBe('draft');
  });
});
