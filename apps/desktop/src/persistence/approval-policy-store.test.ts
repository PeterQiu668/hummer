import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openPersistence } from './database.js';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

describe('ApprovalPolicyStore', () => {
  it('authorizes only the assigned approver and records the decision in the hash chain', () => {
    const directory = mkdtempSync(join(tmpdir(), 'hummer-policy-'));
    directories.push(directory);
    const persistence = openPersistence({ dataDirectory: directory });
    persistence.approvalPolicies.ensureDefaults('tenant_demo', 'human:owner');
    persistence.runtimeEvents.saveSession({
      sessionId: 'ses_policy', tenantId: 'tenant_demo', runtimeId: 'codex-cli',
      startedAt: '2026-08-28T09:00:00.000Z', plan: { id: 'plan_policy' },
      handle: { runtimeId: 'codex-cli', sessionId: 'ses_policy' },
    });
    persistence.runtimeEvents.save({
      sessionId: 'ses_policy', sequence: 1, occurredAt: '2026-08-28T09:00:01.000Z',
      actorRef: 'employee_m-1', type: 'approval_required', approvalId: 'apr_policy',
      tool: 'shell.command', evidenceRefs: [],
    }, { tenantId: 'tenant_demo', runtimeId: 'codex-cli', correlationId: 'corr_ses_policy' });

    const result = persistence.approvalPolicies.authorize({
      tenantId: 'tenant_demo', sessionId: 'ses_policy', approvalId: 'apr_policy',
      action: 'crm.write.accounts', requestedBy: 'employee_m-1', estimatedCostCny: 2,
      approverActorRef: 'human:owner', approved: true, occurredAt: '2026-08-28T09:00:02.000Z',
    });

    expect(result).toEqual(expect.objectContaining({ approved: true, approverActorRef: 'human:owner' }));
    expect(persistence.listApprovals('ses_policy')[0].status).toBe('approved');
    expect(persistence.verifyDomainEventIntegrity()).toEqual({ valid: true, checked: 2 });
    persistence.close();
  });

  it('fails closed when the approver does not own the matching rule', () => {
    const directory = mkdtempSync(join(tmpdir(), 'hummer-policy-'));
    directories.push(directory);
    const persistence = openPersistence({ dataDirectory: directory });
    persistence.approvalPolicies.ensureDefaults('tenant_demo', 'human:owner');
    persistence.runtimeEvents.saveSession({ sessionId: 'ses_deny', tenantId: 'tenant_demo', runtimeId: 'codex-cli', startedAt: '2026-08-28T09:10:00.000Z', plan: { id: 'plan_deny' }, handle: { runtimeId: 'codex-cli', sessionId: 'ses_deny' } });
    persistence.runtimeEvents.save({ sessionId: 'ses_deny', sequence: 1, occurredAt: '2026-08-28T09:10:01.000Z', actorRef: 'employee_m-1', type: 'approval_required', approvalId: 'apr_deny', tool: 'shell.command', evidenceRefs: [] }, { tenantId: 'tenant_demo', runtimeId: 'codex-cli', correlationId: 'corr_ses_deny' });

    expect(persistence.approvalPolicies.authorize({ tenantId: 'tenant_demo', sessionId: 'ses_deny', approvalId: 'apr_deny', action: 'shell.command', requestedBy: 'employee_m-1', estimatedCostCny: null, approverActorRef: 'human:other', approved: true, occurredAt: '2026-08-28T09:10:02.000Z' }).approved).toBe(false);
    expect(persistence.listApprovals('ses_deny')[0].status).toBe('declined');
    expect(persistence.approvalPolicies.getEvidence('tenant_demo', 'ses_deny', 'apr_deny')).toMatchObject({ decisionEventType: 'approval.denied' });
    persistence.close();
  });
  it('records an explicit rejection as durable approval evidence', () => {
    const directory = mkdtempSync(join(tmpdir(), 'hummer-policy-'));
    directories.push(directory);
    const persistence = openPersistence({ dataDirectory: directory });
    persistence.approvalPolicies.ensureDefaults('tenant_demo', 'account_owner');
    persistence.runtimeEvents.saveSession({ sessionId: 'ses_reject', tenantId: 'tenant_demo', runtimeId: 'codex-cli', startedAt: '2026-09-01T09:00:00.000Z', plan: { id: 'plan_reject' }, handle: { runtimeId: 'codex-cli', sessionId: 'ses_reject' } });
    persistence.runtimeEvents.save({ sessionId: 'ses_reject', sequence: 1, occurredAt: '2026-09-01T09:00:01.000Z', actorRef: 'employee_m-1', type: 'approval_required', approvalId: 'apr_reject', tool: 'file.write.report', evidenceRefs: [] }, { tenantId: 'tenant_demo', runtimeId: 'codex-cli', correlationId: 'corr_ses_reject' });

    const authorization = persistence.approvalPolicies.authorize({
      tenantId: 'tenant_demo', sessionId: 'ses_reject', approvalId: 'apr_reject',
      action: 'file.write.report', requestedBy: 'employee_m-1', estimatedCostCny: 8,
      approverActorRef: 'account_owner', approved: false, occurredAt: '2026-09-01T09:00:02.000Z',
    });

    persistence.runtimeEvents.save({
      sessionId: 'ses_reject', sequence: 2, occurredAt: '2026-09-01T09:00:03.000Z', actorRef: 'human:operator',
      type: 'approval_resolved', approvalId: 'apr_reject', approved: false, result: '拒绝本次写入。', evidenceRefs: [],
    }, { tenantId: 'tenant_demo', runtimeId: 'codex-cli', correlationId: 'corr_ses_reject' });

    expect(authorization.approved).toBe(false);
    expect(persistence.listApprovals('ses_reject')).toEqual([expect.objectContaining({ id: 'apr_reject', status: 'declined' })]);
    expect(persistence.approvalPolicies.getEvidence('tenant_demo', 'ses_reject', 'apr_reject')).toMatchObject({
      status: 'declined', action: 'file.write.report', requestedBy: 'employee_m-1', estimatedCostCny: 8,
      policyId: 'tenant_demo_policy_file_write', decisionEventType: 'approval.rejected', decisionActorRef: 'account_owner',
    });
    expect(persistence.verifyDomainEventIntegrity()).toEqual({ valid: true, checked: 3 });
    persistence.close();
  });
});
