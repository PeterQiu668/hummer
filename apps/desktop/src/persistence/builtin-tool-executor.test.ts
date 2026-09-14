import { afterEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

  it('exports an approved sandbox artifact to a user-selected directory and records delivery proof', () => {
    const fixture = createFixture('egress-approved', 'external.send');
    recordDecision(fixture, true, 'external.send');
    const orderWorkspace = join(fixture.workspace, 'order-42');
    const destinationDirectory = join(fixture.root, 'customer-delivery');
    mkdirSync(orderWorkspace, { recursive: true });
    mkdirSync(destinationDirectory, { recursive: true });
    writeFileSync(join(orderWorkspace, 'proposal.md'), 'approved customer proposal', 'utf8');

    const result = fixture.persistence.builtinTools.exportApprovedArtifact({
      tenantId: fixture.tenantId,
      sessionId: fixture.sessionId,
      approvalId: fixture.approvalId,
      requestedBy: 'employee:writer',
      sourceWorkspaceDirectory: orderWorkspace,
      sourceRelativePath: 'proposal.md',
      destinationDirectory,
      occurredAt: '2026-09-14T08:00:02.000Z',
      idempotencyKey: 'egress-approved',
    });

    expect(readFileSync(join(destinationDirectory, 'proposal.md'), 'utf8')).toBe('approved customer proposal');
    expect(result).toMatchObject({ capabilityId: 'external.send', status: 'delivered', fileName: 'proposal.md' });
    expect(result.contentSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(fixture.persistence.tools.listInvocations(fixture.tenantId, fixture.sessionId)).toEqual([
      expect.objectContaining({ capabilityId: 'external.send', status: 'completed', evidenceRefs: [result.evidenceRef] }),
    ]);
    expect(fixture.persistence.verifyDomainEventIntegrity()).toMatchObject({ valid: true });
    fixture.persistence.close();
  });

  it('leaves no destination trace when external delivery was rejected', () => {
    const fixture = createFixture('egress-rejected', 'external.send');
    recordDecision(fixture, false, 'external.send');
    const orderWorkspace = join(fixture.workspace, 'order-43');
    const destinationDirectory = join(fixture.root, 'customer-delivery');
    mkdirSync(orderWorkspace, { recursive: true });
    mkdirSync(destinationDirectory, { recursive: true });
    writeFileSync(join(orderWorkspace, 'rejected.md'), 'must stay in sandbox', 'utf8');

    expect(() => fixture.persistence.builtinTools.exportApprovedArtifact({
      tenantId: fixture.tenantId,
      sessionId: fixture.sessionId,
      approvalId: fixture.approvalId,
      requestedBy: 'employee:writer',
      sourceWorkspaceDirectory: orderWorkspace,
      sourceRelativePath: 'rejected.md',
      destinationDirectory,
      occurredAt: '2026-09-14T08:00:02.000Z',
      idempotencyKey: 'egress-rejected',
    })).toThrow(/approved approval/i);

    expect(existsSync(join(destinationDirectory, 'rejected.md'))).toBe(false);
    expect(fixture.persistence.tools.listInvocations(fixture.tenantId, fixture.sessionId)).toEqual([
      expect.objectContaining({ capabilityId: 'external.send', status: 'declined', evidenceRefs: [] }),
    ]);
    expect(fixture.persistence.verifyDomainEventIntegrity()).toMatchObject({ valid: true });
    fixture.persistence.close();
  });
});

function createFixture(label: string, action = 'external.send.draft') {
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
  persistence.runtimeEvents.save({ sessionId, sequence: 1, occurredAt: '2026-09-11T05:00:00.000Z', actorRef: 'employee:writer', type: 'approval_required', approvalId, tool: action, evidenceRefs: [] }, { tenantId, runtimeId: 'builtin', correlationId: `corr_${sessionId}` });
  return { persistence, tenantId, approver, sessionId, approvalId, workspace: join(root, 'workspace'), root };
}

function recordDecision(fixture: ReturnType<typeof createFixture>, approved: boolean, action = 'external.send.draft'): void {
  fixture.persistence.approvalPolicies.authorize({
    tenantId: fixture.tenantId,
    sessionId: fixture.sessionId,
    approvalId: fixture.approvalId,
    action,
    requestedBy: 'employee:writer',
    estimatedCostCny: null,
    approverActorRef: fixture.approver,
    approved,
    occurredAt: '2026-09-11T05:00:01.000Z',
  });
}
