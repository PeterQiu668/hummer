import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openPersistence } from './database.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

describe('[TEN-P0-DESKTOP-SESSION-BARE-ID] tenant-scoped persistence reads', () => {
  it('[TEN-W4-READ-DOMAIN-EVENT] returns not found or empty for every cross-tenant session projection', () => {
    const persistence = openPersistence({ dataDirectory: temporaryDirectory() });
    const companyA = persistence.identity.createCompany({
      companyName: '租户甲', displayName: '甲负责人', email: 'tenant-a-read@example.test',
    });
    const companyB = persistence.identity.createCompany({
      companyName: '租户乙', displayName: '乙负责人', email: 'tenant-b-read@example.test',
    });
    const tenantA = companyA.tenant.id;
    const tenantB = companyB.tenant.id;
    const sessionA = 'session_tenant_a_private';
    const sessionB = 'session_tenant_b_private';
    const approvalA = 'approval_tenant_a_private';

    persistence.runtimeEvents.saveSession({
      sessionId: sessionA, tenantId: tenantA, runtimeId: 'test', workOrderId: 'work_tenant_a',
      startedAt: '2026-10-07T01:00:00.000Z', plan: { private: 'tenant-a-plan' }, handle: { private: 'tenant-a-handle' },
    });
    persistence.runtimeEvents.saveSession({
      sessionId: sessionB, tenantId: tenantB, runtimeId: 'test', workOrderId: 'work_tenant_b',
      startedAt: '2026-10-07T01:00:00.000Z', plan: { private: 'tenant-b-plan' }, handle: { private: 'tenant-b-handle' },
    });
    const optionsA = { tenantId: tenantA, runtimeId: 'test', correlationId: 'corr_tenant_a', workOrderId: 'work_tenant_a' };
    persistence.runtimeEvents.save({
      sessionId: sessionA, sequence: 1, occurredAt: '2026-10-07T01:00:01.000Z',
      actorRef: 'human:tenant-a', type: 'approval_required', approvalId: approvalA,
      title: 'tenant-a-only', evidenceRefs: [],
    }, optionsA);
    persistence.runtimeEvents.save({
      sessionId: sessionA, sequence: 2, occurredAt: '2026-10-07T01:00:02.000Z',
      actorRef: 'human:tenant-a', type: 'approval_resolved', approvalId: approvalA,
      approved: true, evidenceRefs: [],
    }, optionsA);
    const evidenceA = persistence.evidence.put(Buffer.from('tenant-a-secret'), {
      tenantId: tenantA, sessionId: sessionA, mediaType: 'text/plain', name: 'private.txt',
      createdAt: '2026-10-07T01:00:03.000Z',
    });
    persistence.runtimeEvents.save({
      sessionId: sessionA, sequence: 3, occurredAt: '2026-10-07T01:00:04.000Z',
      actorRef: 'human:tenant-a', type: 'result', title: 'tenant-a-result',
      evidenceRefs: [evidenceA.ref],
    }, optionsA);
    persistence.runtimeEvents.save({
      sessionId: sessionB, sequence: 1, occurredAt: '2026-10-07T01:00:01.000Z',
      actorRef: 'human:tenant-b', type: 'status', status: 'running', evidenceRefs: [],
    }, { tenantId: tenantB, runtimeId: 'test', correlationId: 'corr_tenant_b', workOrderId: 'work_tenant_b' });

    expect(persistence.getSession(tenantA, sessionA)).toMatchObject({ tenantId: tenantA, status: 'delivered' });
    expect(persistence.listApprovals(tenantA, sessionA)).toHaveLength(1);
    expect(persistence.listResultPackages(tenantA, sessionA)).toHaveLength(1);
    expect(persistence.listEvidence(tenantA, sessionA)).toHaveLength(1);
    expect(persistence.runtimeEvents.listBySession(tenantA, sessionA)).toHaveLength(3);

    expect(persistence.getSession(tenantB, sessionA)).toBeUndefined();
    expect(persistence.getSession(tenantB, 'session_unknown')).toBeUndefined();
    expect(persistence.listApprovals(tenantB, sessionA)).toEqual([]);
    expect(persistence.listApprovals(tenantB, 'session_unknown')).toEqual([]);
    expect(persistence.listResultPackages(tenantB, sessionA)).toEqual([]);
    expect(persistence.listResultPackages(tenantB, 'session_unknown')).toEqual([]);
    expect(persistence.listEvidence(tenantB, sessionA)).toEqual([]);
    expect(persistence.listEvidence(tenantB, 'session_unknown')).toEqual([]);
    expect(persistence.runtimeEvents.listBySession(tenantB, sessionA)).toEqual([]);
    expect(persistence.runtimeEvents.listBySession(tenantB, 'session_unknown')).toEqual([]);
    expect(persistence.runtimeEvents.listSessions(tenantB).map((session) => session.sessionId)).toEqual([sessionB]);

    expect(errorMessage(() => persistence.evidence.read(tenantB, evidenceA.ref)))
      .toBe(errorMessage(() => persistence.evidence.read(tenantB, 'evidence://sha256/unknown')));
    expect(errorMessage(() => persistence.evidence.verify(tenantB, evidenceA.ref)))
      .toBe(errorMessage(() => persistence.evidence.verify(tenantB, 'evidence://sha256/unknown')));
    persistence.close();
  });

  it('[TEN-W4-READ-EVIDENCE-APPROVAL] rejects cross-tenant session, approval, and evidence references without altering the owner tenant', () => {
    const persistence = openPersistence({ dataDirectory: temporaryDirectory() });
    const companyA = persistence.identity.createCompany({
      companyName: '写隔离甲', displayName: '甲负责人', email: 'tenant-a-write@example.test',
    });
    const companyB = persistence.identity.createCompany({
      companyName: '写隔离乙', displayName: '乙负责人', email: 'tenant-b-write@example.test',
    });
    const tenantA = companyA.tenant.id;
    const tenantB = companyB.tenant.id;
    const sessionA = 'session_write_tenant_a';
    const sessionB = 'session_write_tenant_b';
    const sharedApprovalId = 'approval_cross_tenant_collision';

    persistence.runtimeEvents.saveSession({
      sessionId: sessionA, tenantId: tenantA, runtimeId: 'test',
      startedAt: '2026-10-07T02:00:00.000Z', plan: { owner: 'a' }, handle: { owner: 'a' },
    });
    persistence.runtimeEvents.save({
      sessionId: sessionA, sequence: 1, occurredAt: '2026-10-07T02:00:01.000Z', actorRef: 'human:a',
      type: 'approval_required', approvalId: sharedApprovalId, evidenceRefs: [],
    }, { tenantId: tenantA, runtimeId: 'test', correlationId: 'corr_write_a' });
    persistence.runtimeEvents.saveSession({
      sessionId: sessionB, tenantId: tenantB, runtimeId: 'test',
      startedAt: '2026-10-07T02:00:00.000Z', plan: { owner: 'b' }, handle: { owner: 'b' },
    });

    expect(() => persistence.runtimeEvents.saveSession({
      sessionId: sessionA, tenantId: tenantB, runtimeId: 'test',
      startedAt: '2026-10-07T02:00:02.000Z', plan: { overwritten: true }, handle: {},
    })).toThrow(/unavailable in the current tenant/i);
    expect(() => persistence.runtimeEvents.save({
      sessionId: sessionA, sequence: 2, occurredAt: '2026-10-07T02:00:02.000Z', actorRef: 'human:b',
      type: 'status', status: 'running', evidenceRefs: [],
    }, { tenantId: tenantB, runtimeId: 'test', correlationId: 'corr_cross_session' }))
      .toThrow(/unavailable in the current tenant/i);
    expect(() => persistence.runtimeEvents.save({
      sessionId: sessionB, sequence: 1, occurredAt: '2026-10-07T02:00:03.000Z', actorRef: 'human:b',
      type: 'approval_required', approvalId: sharedApprovalId, evidenceRefs: [],
    }, { tenantId: tenantB, runtimeId: 'test', correlationId: 'corr_cross_approval' }))
      .toThrow(/unavailable in the current tenant/i);
    expect(() => persistence.approvalPolicies.authorize({
      tenantId: tenantB,
      sessionId: sessionA,
      approvalId: sharedApprovalId,
      action: 'file.write.report',
      requestedBy: 'human:b',
      estimatedCostCny: 0,
      approverActorRef: `account:${companyB.account.id}`,
      approved: true,
      occurredAt: '2026-10-07T02:00:03.500Z',
    })).toThrow(/unavailable in the current tenant/i);
    expect(() => persistence.evidence.put(Buffer.from('cross-tenant'), {
      tenantId: tenantB, sessionId: sessionA, mediaType: 'text/plain',
      createdAt: '2026-10-07T02:00:04.000Z',
    })).toThrow(/unavailable in the current tenant/i);

    expect(persistence.getSession(tenantA, sessionA)).toMatchObject({ tenantId: tenantA, lastSequence: 1 });
    expect(persistence.runtimeEvents.listBySession(tenantA, sessionA)).toHaveLength(1);
    expect(persistence.listApprovals(tenantA, sessionA)).toEqual([
      expect.objectContaining({ id: sharedApprovalId, status: 'pending' }),
    ]);
    expect(persistence.runtimeEvents.listBySession(tenantB, sessionB)).toEqual([]);
    expect(persistence.listApprovals(tenantB, sessionB)).toEqual([]);
    persistence.close();
  });
});

function errorMessage(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('Expected operation to fail');
}

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'hummer-tenant-read-isolation-'));
  temporaryDirectories.push(directory);
  return directory;
}
