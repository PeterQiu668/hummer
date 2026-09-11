import { afterEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openPersistence } from './database.js';

const roots: string[] = [];

afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe('builtin tool executor', () => {
  it('creates only an approved external-send draft and records its evidence', () => {
    const fixture = createFixture('approved');
    recordDecision(fixture, true);

    const result = fixture.persistence.builtinTools.createExternalSendDraft({
      tenantId: fixture.tenantId,
      sessionId: fixture.sessionId,
      approvalId: fixture.approvalId,
      requestedBy: 'employee:writer',
      relativePath: 'drafts/customer-update.md',
      content: 'Approved draft only. No delivery.',
      workspaceDirectory: fixture.workspace,
      occurredAt: '2026-09-11T05:00:02.000Z',
      idempotencyKey: 'draft-approved',
    });

    expect(existsSync(join(fixture.workspace, 'drafts/customer-update.md'))).toBe(true);
    expect(result.evidenceRef).toMatch(/^evidence:\/\/sha256\/[a-f0-9]{64}$/);
    expect(fixture.persistence.tools.listInvocations(fixture.tenantId, fixture.sessionId)).toEqual([
      expect.objectContaining({ capabilityId: 'external.send.draft', status: 'completed', evidenceRefs: [result.evidenceRef] }),
    ]);
    expect(fixture.persistence.verifyDomainEventIntegrity()).toMatchObject({ valid: true });
    fixture.persistence.close();
  });

  it('fails closed after rejection, records the declined invocation, and writes nothing', () => {
    const fixture = createFixture('rejected');
    recordDecision(fixture, false);

    expect(() => fixture.persistence.builtinTools.createExternalSendDraft({
      tenantId: fixture.tenantId,
      sessionId: fixture.sessionId,
      approvalId: fixture.approvalId,
      requestedBy: 'employee:writer',
      relativePath: 'drafts/rejected.md',
      content: 'Must not be written.',
      workspaceDirectory: fixture.workspace,
      occurredAt: '2026-09-11T05:00:02.000Z',
      idempotencyKey: 'draft-rejected',
    })).toThrow(/approved approval/i);

    expect(existsSync(join(fixture.workspace, 'drafts/rejected.md'))).toBe(false);
    expect(fixture.persistence.tools.listInvocations(fixture.tenantId, fixture.sessionId)).toEqual([
      expect.objectContaining({ capabilityId: 'external.send.draft', status: 'declined', evidenceRefs: [] }),
    ]);
    expect(fixture.persistence.verifyDomainEventIntegrity()).toMatchObject({ valid: true });
    fixture.persistence.close();
  });
});

function createFixture(label: string) {
  const root = mkdtempSync(join(tmpdir(), `hummer-builtin-${label}-`));
  roots.push(root);
  const persistence = openPersistence({ dataDirectory: join(root, 'facts') });
  const identity = persistence.identity.createCompany({ companyName: 'Builtin Test', displayName: 'Owner', email: `${label}@example.test` });
  const tenantId = identity.tenant.id;
  const approver = `account:${identity.account.id}`;
  const sessionId = `session_${label}`;
  const approvalId = `approval_${label}`;
  persistence.approvalPolicies.ensureDefaults(tenantId, approver);
  persistence.tools.ensureDefaults(tenantId, approver);
  persistence.runtimeEvents.saveSession({ sessionId, tenantId, runtimeId: 'builtin', startedAt: '2026-09-11T05:00:00.000Z', plan: {}, handle: { sessionId, runtimeId: 'builtin' } });
  persistence.runtimeEvents.save({ sessionId, sequence: 1, occurredAt: '2026-09-11T05:00:00.000Z', actorRef: 'employee:writer', type: 'approval_required', approvalId, tool: 'external.send.draft', evidenceRefs: [] }, { tenantId, runtimeId: 'builtin', correlationId: `corr_${sessionId}` });
  return { persistence, tenantId, approver, sessionId, approvalId, workspace: join(root, 'workspace') };
}

function recordDecision(fixture: ReturnType<typeof createFixture>, approved: boolean): void {
  fixture.persistence.approvalPolicies.authorize({
    tenantId: fixture.tenantId,
    sessionId: fixture.sessionId,
    approvalId: fixture.approvalId,
    action: 'external.send.draft',
    requestedBy: 'employee:writer',
    estimatedCostCny: null,
    approverActorRef: fixture.approver,
    approved,
    occurredAt: '2026-09-11T05:00:01.000Z',
  });
}
