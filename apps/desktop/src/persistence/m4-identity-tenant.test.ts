import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openPersistence } from './database.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

describe('M4-A identity and tenant boundary', () => {
  it('creates migration v3 identity tables without changing older migrations', () => {
    const persistence = openPersistence({ dataDirectory: temporaryDirectory() });

    expect(persistence.schemaVersion()).toBeGreaterThanOrEqual(3);
    expect(persistence.listTables()).toEqual(expect.arrayContaining([
      'tenants',
      'accounts',
      'memberships',
      'invitations',
      'sessions_auth',
    ]));
    persistence.close();
  });

  it('isolates domain events and runtime projections by the tenant in each authenticated session', () => {
    const persistence = openPersistence({ dataDirectory: temporaryDirectory() });
    const first = persistence.identity.createCompany({
      companyName: '甲方公司',
      displayName: '甲方负责人',
      email: 'owner-a@example.test',
    });
    const second = persistence.identity.createCompany({
      companyName: '乙方公司',
      displayName: '乙方负责人',
      email: 'owner-b@example.test',
    });

    persistence.appendDomainEvent({
      id: 'evt_tenant_a_only',
      tenantId: first.tenant.id,
      aggregateType: 'work_order',
      aggregateId: 'wo_tenant_a',
      type: 'work_order.created',
      occurredAt: '2026-08-29T01:00:00.000Z',
      actorRef: `human:${first.membership.humanUserId}`,
      correlationId: 'corr_tenant_a',
      payload: { title: '仅甲方可见' },
    });

    expect(persistence.identity.currentTenantId(first.session.token)).toBe(first.tenant.id);
    expect(persistence.identity.currentTenantId(second.session.token)).toBe(second.tenant.id);
    expect(persistence.listDomainEvents(first.session.token)).toHaveLength(2);
    expect(persistence.listDomainEvents(second.session.token)).toHaveLength(1);
    expect(persistence.listDomainEvents(second.session.token).some((event) => event.id === 'evt_tenant_a_only')).toBe(false);
    persistence.close();
  });

  it('accepts an invitation durably and enforces one active twin per human in SQLite', () => {
    const directory = temporaryDirectory();
    const first = openPersistence({ dataDirectory: directory });
    const owner = first.identity.createCompany({
      companyName: '协作公司',
      displayName: '公司负责人',
      phone: '13800000001',
    });
    const invitation = first.identity.createInvitation(owner.session.token, {
      contactType: 'phone',
      contactValue: '13800000002',
      role: 'member',
    });
    const accepted = first.identity.acceptInvitation({
      token: invitation.token,
      displayName: '受邀同事',
      phone: '13800000002',
    });

    expect(first.identity.listMembers(owner.session.token)).toHaveLength(2);
    expect(first.identity.listActiveTwins(owner.session.token, accepted.membership.humanUserId)).toHaveLength(1);
    expect(() => first.identity.createTwinForHuman(owner.session.token, accepted.membership.humanUserId, '重复分身'))
      .toThrow(/one active twin/i);
    first.close();

    const reopened = openPersistence({ dataDirectory: directory });
    const resumed = reopened.identity.resumeSession(accepted.session.token);
    expect(resumed.account.displayName).toBe('受邀同事');
    expect(reopened.identity.listMembers(accepted.session.token)).toHaveLength(2);
    expect(reopened.identity.listActiveTwins(accepted.session.token, accepted.membership.humanUserId)).toHaveLength(1);
    reopened.close();
  });

  it('resolves the approver actor from the authenticated account membership', () => {
    const persistence = openPersistence({ dataDirectory: temporaryDirectory() });
    const owner = persistence.identity.createCompany({
      companyName: '审批公司',
      displayName: '真实审批人',
      email: 'approver@example.test',
    });

    const accountActorRef = `account:${owner.account.id}`;
    expect(persistence.identity.currentActorRef(owner.session.token)).toBe(accountActorRef);
    expect(persistence.identity.resolveActor(owner.session.token, accountActorRef)).toMatchObject({
      accountId: owner.account.id,
      displayName: '真实审批人',
    });
    expect(persistence.approvalPolicies.list(owner.tenant.id).every((policy) => policy.approverActorRef === accountActorRef)).toBe(true);
    persistence.close();
  });
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'hummer-m4-identity-'));
  temporaryDirectories.push(directory);
  return directory;
}
