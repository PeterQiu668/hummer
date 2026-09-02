import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openPersistence } from './database.js';

describe('M3 responsibility chain', () => {
  it('traces one durable employee id through delegation, approval and result package', () => {
    const directory = mkdtempSync(join(tmpdir(), 'hummer-m3-chain-'));
    const persistence = openPersistence({ dataDirectory: directory });
    const employeeId = 'employee_sales-east-01';
    const sessionId = 'ses_m3_chain';
    const approvalId = 'apr_m3_chain';
    try {
      const employee = persistence.organization.hireDigitalEmployee({
        id: employeeId,
        tenantId: 'tenant_demo',
        sponsorActorRef: 'human:owner',
        departmentId: 'department_sales',
        name: '华东客户研究员',
        jobTitle: '客户研究员',
        runtimeProfile: 'standard',
        autonomyLevel: 'L2',
        idempotencyKey: 'm3-chain-hire-001',
      });
      persistence.runtimeEvents.saveSession({
        sessionId,
        tenantId: 'tenant_demo',
        runtimeId: 'codex-cli',
        workOrderId: 'wo_m3_chain',
        startedAt: '2026-08-28T14:10:00.000Z',
        plan: { id: 'plan_m3_chain', prompt: '整理客户清单并在写回前确认', assignees: [employee.id] },
        handle: { runtimeId: 'codex-cli', sessionId, nativeSessionId: 'thread_m3_chain' },
      });
      const options = { tenantId: 'tenant_demo', runtimeId: 'codex-cli', correlationId: 'corr_m3_chain', workOrderId: 'wo_m3_chain' };
      persistence.runtimeEvents.save({ sessionId, sequence: 1, occurredAt: '2026-08-28T14:10:01.000Z', actorRef: 'human:owner', type: 'delegation', assigneeRef: employee.id, evidenceRefs: [] }, options);
      persistence.runtimeEvents.save({ sessionId, sequence: 2, occurredAt: '2026-08-28T14:10:02.000Z', actorRef: employee.id, type: 'approval_required', approvalId, tool: 'crm.write.accounts', evidenceRefs: [] }, options);
      persistence.approvalPolicies.ensureDefaults('tenant_demo', 'human:owner');
      const authorization = persistence.approvalPolicies.authorize({
        tenantId: 'tenant_demo', sessionId, approvalId, action: 'crm.write.accounts',
        requestedBy: employee.id, estimatedCostCny: 2, approverActorRef: 'human:owner',
        approved: true, occurredAt: '2026-08-28T14:10:03.000Z',
      });
      persistence.runtimeEvents.save({ sessionId, sequence: 3, occurredAt: '2026-08-28T14:10:04.000Z', actorRef: employee.id, type: 'tool', tool: 'crm.write.accounts', result: '12 records updated', evidenceRefs: [] }, options);
      persistence.runtimeEvents.save({ sessionId, sequence: 4, occurredAt: '2026-08-28T14:10:05.000Z', actorRef: employee.id, type: 'result', status: 'delivered', result: 'customer follow-up package', evidenceRefs: [] }, options);

      expect(authorization.approved).toBe(true);
      expect(persistence.organization.listDigitalEmployees('tenant_demo')[0].id).toBe(employeeId);
      expect(persistence.runtimeEvents.listSessions()[0].plan).toMatchObject({ assignees: [employeeId] });
      expect(persistence.runtimeEvents.listBySession(sessionId)).toEqual(expect.arrayContaining([
        expect.objectContaining({ actorRef: employeeId, type: 'approval_required' }),
        expect.objectContaining({ actorRef: employeeId, type: 'result' }),
      ]));
      expect(persistence.listApprovals(sessionId)).toEqual([expect.objectContaining({ id: approvalId, status: 'approved' })]);
      expect(persistence.listResultPackages(sessionId)).toEqual([expect.objectContaining({ sessionId, status: 'delivered' })]);
      expect(persistence.getSession(sessionId)).toMatchObject({ status: 'delivered', lastSequence: 4 });
      expect(persistence.verifyDomainEventIntegrity()).toEqual({ valid: true, checked: 6 });
    } finally {
      persistence.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
