import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openPersistence } from './database.js';
import { openSqlite } from './sqlite.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

describe('[TEN-P0G-IDENTITY-BOUNDARY] authenticated identity and invitation isolation', () => {
  it('rejects account contact reuse while allowing invitation-authorized multi-tenant membership and session-local switching', () => {
    const persistence = openPersistence({ dataDirectory: temporaryDirectory() });
    const accountOwner = persistence.identity.createCompany({
      companyName: '账号原租户', displayName: '共享账号', email: 'shared@example.test', phone: '13800001001',
    });
    const invitingOwner = persistence.identity.createCompany({
      companyName: '邀请租户', displayName: '邀请人', email: 'inviter@example.test',
    });

    expect(errorMessage(() => persistence.identity.createCompany({
      companyName: '冒名租户', displayName: '冒名者', email: ' SHARED@example.test ',
    }))).toBe('Identity is unavailable');
    expect(errorMessage(() => persistence.identity.createCompany({
      companyName: '冒名租户', displayName: '冒名者', phone: '138 0000 1001',
    }))).toBe('Identity is unavailable');

    const invitation = persistence.identity.createInvitation(invitingOwner.session.token, {
      contactType: 'email', contactValue: 'shared@example.test', role: 'member',
    });
    const invitedSession = persistence.identity.acceptInvitation({
      token: invitation.token, displayName: '不得覆盖的名字', email: 'shared@example.test', phone: '13800001001',
    });

    expect(invitedSession.account.id).toBe(accountOwner.account.id);
    expect(invitedSession.account.displayName).toBe('共享账号');
    expect(persistence.identity.listTenants(accountOwner.session.token).map((tenant) => tenant.id).sort())
      .toEqual([accountOwner.tenant.id, invitingOwner.tenant.id].sort());
    expect(persistence.identity.listTenants(invitedSession.session.token).map((tenant) => tenant.id).sort())
      .toEqual([accountOwner.tenant.id, invitingOwner.tenant.id].sort());

    persistence.identity.switchTenant(invitedSession.session.token, accountOwner.tenant.id);
    expect(persistence.identity.currentTenantId(invitedSession.session.token)).toBe(accountOwner.tenant.id);
    expect(persistence.identity.currentTenantId(accountOwner.session.token)).toBe(accountOwner.tenant.id);
    persistence.identity.switchTenant(accountOwner.session.token, invitingOwner.tenant.id);
    expect(persistence.identity.currentTenantId(accountOwner.session.token)).toBe(invitingOwner.tenant.id);
    expect(persistence.identity.currentTenantId(invitedSession.session.token)).toBe(accountOwner.tenant.id);

    const foreign = persistence.identity.createCompany({
      companyName: '无关租户', displayName: '无关账号', email: 'foreign@example.test',
    });
    expect(errorMessage(() => persistence.identity.switchTenant(foreign.session.token, accountOwner.tenant.id)))
      .toBe(errorMessage(() => persistence.identity.switchTenant(foreign.session.token, 'tenant_unknown')));
    expect(persistence.identity.currentTenantId(foreign.session.token)).toBe(foreign.tenant.id);
    persistence.close();
  });

  it('binds invitation acceptance to one account contact and rejects the former cross-account phone collision', () => {
    const persistence = openPersistence({ dataDirectory: temporaryDirectory() });
    const victim = persistence.identity.createCompany({
      companyName: '既有账号租户', displayName: '既有账号', email: 'victim@example.test', phone: '13900002001',
    });
    const inviter = persistence.identity.createCompany({
      companyName: '邀请发起租户', displayName: '发起人', email: 'phone-inviter@example.test',
    });
    const invitation = persistence.identity.createInvitation(inviter.session.token, {
      contactType: 'phone', contactValue: '13800002002', role: 'member',
    });

    const collisionError = errorMessage(() => persistence.identity.acceptInvitation({
      token: invitation.token,
      displayName: '碰撞接收者',
      email: victim.account.email ?? undefined,
      phone: '13800002002',
    }));
    expect(collisionError).toBe(errorMessage(() => persistence.identity.acceptInvitation({
      token: 'unknown-invitation-token', displayName: '未知', phone: '13800002002',
    })));
    expect(persistence.identity.listTenants(victim.session.token).map((tenant) => tenant.id)).toEqual([victim.tenant.id]);
    expect(persistence.identity.listMembers(inviter.session.token)).toHaveLength(1);

    const accepted = persistence.identity.acceptInvitation({
      token: invitation.token, displayName: '真实接收者', phone: '13800002002',
    });
    expect(accepted.account.id).not.toBe(victim.account.id);
    expect(accepted.tenant.id).toBe(inviter.tenant.id);
    expect(persistence.identity.listMembers(inviter.session.token)).toHaveLength(2);
    persistence.close();
  });

  it('makes wrong-contact, expired, replayed, and unknown invitations indistinguishable and mutation-free', () => {
    const directory = temporaryDirectory();
    const persistence = openPersistence({ dataDirectory: directory });
    const owner = persistence.identity.createCompany({
      companyName: '邀请生命周期租户', displayName: '负责人', email: 'lifecycle-owner@example.test',
    });
    const wrongContact = persistence.identity.createInvitation(owner.session.token, {
      contactType: 'email', contactValue: 'expected@example.test', role: 'member',
    });
    const expired = persistence.identity.createInvitation(owner.session.token, {
      contactType: 'phone', contactValue: '13800003003', role: 'member',
    });
    const acceptedInvitation = persistence.identity.createInvitation(owner.session.token, {
      contactType: 'email', contactValue: 'accepted@example.test', role: 'member',
    });

    const genericError = errorMessage(() => persistence.identity.acceptInvitation({
      token: 'unknown-invitation-token', displayName: '未知', email: 'unknown@example.test',
    }));
    expect(errorMessage(() => persistence.identity.acceptInvitation({
      token: wrongContact.token, displayName: '错误联系人', email: 'wrong@example.test',
    }))).toBe(genericError);
    expect(persistence.identity.listMembers(owner.session.token)).toHaveLength(1);

    const accepted = persistence.identity.acceptInvitation({
      token: acceptedInvitation.token, displayName: '已接收', email: 'accepted@example.test',
    });
    expect(() => persistence.identity.createInvitation(accepted.session.token, {
      contactType: 'email', contactValue: 'member-cannot-invite@example.test', role: 'member',
    })).toThrow('Only owners and admins may invite members');
    expect(errorMessage(() => persistence.identity.acceptInvitation({
      token: acceptedInvitation.token, displayName: '重放', email: 'accepted@example.test',
    }))).toBe(genericError);
    expect(persistence.identity.listMembers(owner.session.token)).toHaveLength(2);
    expect(persistence.identity.listTenants(accepted.session.token).map((tenant) => tenant.id)).toEqual([owner.tenant.id]);

    const databasePath = persistence.databasePath;
    persistence.close();
    const database = openSqlite(databasePath);
    database.prepare('UPDATE invitations SET expires_at = ? WHERE id = ?')
      .run('2000-01-01T00:00:00.000Z', expired.id);
    database.close();

    const reopened = openPersistence({ dataDirectory: directory });
    expect(errorMessage(() => reopened.identity.acceptInvitation({
      token: expired.token, displayName: '过期', phone: '13800003003',
    }))).toBe(genericError);
    expect(reopened.identity.listMembers(owner.session.token)).toHaveLength(2);
    reopened.close();
  });

  it('keeps member, actor, twin, and session-token reads tenant-bound with generic negative outcomes', () => {
    const directory = temporaryDirectory();
    const persistence = openPersistence({ dataDirectory: directory });
    const companyA = persistence.identity.createCompany({
      companyName: '边界甲', displayName: '甲负责人', email: 'boundary-a@example.test',
    });
    const companyB = persistence.identity.createCompany({
      companyName: '边界乙', displayName: '乙负责人', email: 'boundary-b@example.test',
    });

    expect(persistence.identity.listMembers(companyB.session.token).map((member) => member.accountId))
      .toEqual([companyB.account.id]);
    expect(persistence.identity.resolveActor(companyB.session.token, `account:${companyA.account.id}`)).toBeUndefined();
    expect(persistence.identity.resolveActor(companyB.session.token, `human:${companyA.membership.humanUserId}`)).toBeUndefined();
    expect(persistence.identity.listActiveTwins(companyB.session.token, companyA.membership.humanUserId)).toEqual([]);
    expect(errorMessage(() => persistence.identity.createTwinForHuman(
      companyB.session.token, companyA.membership.humanUserId, '越权分身',
    ))).toBe(errorMessage(() => persistence.identity.createTwinForHuman(
      companyB.session.token, 'human_unknown', '未知分身',
    )));
    expect(errorMessage(() => persistence.identity.resumeSession('unknown-session-token')))
      .toBe('Authentication session is invalid or expired');

    const databasePath = persistence.databasePath;
    persistence.close();
    const database = openSqlite(databasePath);
    database.prepare('UPDATE sessions_auth SET expires_at = ? WHERE id = ?')
      .run('2000-01-01T00:00:00.000Z', companyA.session.id);
    database.close();
    const reopened = openPersistence({ dataDirectory: directory });
    expect(errorMessage(() => reopened.identity.resumeSession(companyA.session.token)))
      .toBe(errorMessage(() => reopened.identity.resumeSession('unknown-session-token')));
    expect(reopened.identity.currentTenantId(companyB.session.token)).toBe(companyB.tenant.id);
    reopened.close();
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
  const directory = mkdtempSync(join(tmpdir(), 'hummer-identity-boundary-'));
  temporaryDirectories.push(directory);
  return directory;
}
