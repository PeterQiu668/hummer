import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJson, sha256Hex } from './canonical-json.js';
import { openPersistence } from './database.js';
import type { MembershipRole } from './identity-store.js';
import { migrations } from './migrations.js';
import { openSqlite } from './sqlite.js';

const temporaryDirectories: string[] = [];
const MIGRATIONS_V1_TO_V11_SHA256 = 'b1c006a714b79cec29bdede92f36819862d34421a9d00898bd80dde6270f20f7';

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

describe('[TEN-W4-GOVERNANCE] additive migrations and tenant dual chain', () => {
  it('preserves the exact v1-v11 migration definitions', () => {
    const fingerprint = sha256Hex(canonicalJson(migrations.filter((migration) => migration.version <= 11).map((migration) => ({
      version: migration.version,
      name: migration.name,
      sql: migration.sql,
    }))));

    expect(fingerprint).toBe(MIGRATIONS_V1_TO_V11_SHA256);
  });

  it('upgrades a real v11 database through v12/v13 and backfills its legacy event into the tenant chain', () => {
    const directory = temporaryDirectory();
    const databasePath = join(directory, 'hummer.sqlite3');
    seedV11Database(databasePath);

    const persistence = openPersistence({ dataDirectory: directory });

    expect(persistence.schemaVersion()).toBe(13);
    expect(persistence.listTables()).toEqual(expect.arrayContaining([
      'tenant_settings',
      'tenant_event_chain',
      'tenant_chain_heads',
      'audit_exports',
      'quota_counters',
      'quota_admissions',
    ]));
    expect(persistence.appliedMigrations().slice(-2)).toEqual([
      expect.objectContaining({ version: 12, name: 'w4_tenant_governance_and_dual_chain' }),
      expect.objectContaining({ version: 13, name: 'w4_audit_exports_and_quota_counters' }),
    ]);
    expect(persistence.verifyDomainEventIntegrity()).toEqual({ valid: true, checked: 1 });
    expect(persistence.verifyTenantDomainEventIntegrity('tenant_v11')).toEqual({ valid: true, checked: 1 });
    expect(persistence.governance.getChainHead('tenant_v11')).toMatchObject({
      tenantId: 'tenant_v11', position: 1,
    });
    persistence.governance.setSetting('tenant_v11', 'notifications.quota', { enabled: true });
    expect(persistence.governance.getSetting('tenant_v11', 'notifications.quota')).toEqual({ enabled: true });
    persistence.close();

    const upgraded = openSqlite(databasePath);
    expect(upgraded.prepare('SELECT role FROM memberships WHERE id = ?').get<{ role: string }>('membership_v11'))
      .toEqual({ role: 'owner' });
    expect(upgraded.prepare('SELECT role FROM invitations WHERE id = ?').get<{ role: string }>('invitation_v11'))
      .toEqual({ role: 'member' });
    upgraded.close();
  });

  it('safely expands membership and invitation checks to five roles while invalid roles still fail', () => {
    const persistence = openPersistence({ dataDirectory: temporaryDirectory() });
    const owner = createCompany(persistence, '五角色租户', 'role-owner@example.test');
    const accepted = new Map<MembershipRole, string>([['owner', owner.session.token]]);

    for (const role of ['admin', 'member', 'auditor', 'operator'] as const) {
      const email = `role-${role}@example.test`;
      const invitation = persistence.identity.createInvitation(owner.session.token, {
        contactType: 'email', contactValue: email, role,
      });
      const context = persistence.identity.acceptInvitation({
        token: invitation.token, displayName: role, email,
      });
      expect(context.membership.role).toBe(role);
      accepted.set(role, context.session.token);
    }

    expect(persistence.identity.listMembers(owner.session.token).map((member) => member.role).sort())
      .toEqual(['admin', 'auditor', 'member', 'operator', 'owner']);
    for (const role of ['member', 'auditor', 'operator'] as const) {
      expect(() => persistence.identity.createInvitation(accepted.get(role)!, {
        contactType: 'email', contactValue: `forbidden-${role}@example.test`, role: 'member',
      })).toThrow('Only owners and admins may invite members');
    }
    expect(() => persistence.identity.createInvitation(owner.session.token, {
      contactType: 'email', contactValue: 'invalid-role@example.test',
      role: 'invalid' as Exclude<MembershipRole, 'owner'>,
    })).toThrow(/check constraint/i);
    const databasePath = persistence.databasePath;
    persistence.close();
    const database = openSqlite(databasePath);
    database.prepare(`
      INSERT INTO accounts (id, email, phone, display_name, status, created_at, updated_at)
      VALUES ('account_invalid_role', 'invalid-membership@example.test', NULL, 'Invalid', 'active', ?, ?)
    `).run('2026-10-07T00:00:00.000Z', '2026-10-07T00:00:00.000Z');
    database.prepare(`
      INSERT INTO human_users (id, tenant_id, display_name, role, status, created_at, updated_at, account_id)
      VALUES ('human_invalid_role', ?, 'Invalid', 'invalid', 'active', ?, ?, 'account_invalid_role')
    `).run(owner.tenant.id, '2026-10-07T00:00:00.000Z', '2026-10-07T00:00:00.000Z');
    expect(() => database.prepare(`
      INSERT INTO memberships (id, tenant_id, account_id, human_user_id, role, status, created_at, updated_at)
      VALUES ('membership_invalid_role', ?, 'account_invalid_role', 'human_invalid_role', 'invalid', 'active', ?, ?)
    `).run(owner.tenant.id, '2026-10-07T00:00:00.000Z', '2026-10-07T00:00:00.000Z')).toThrow(/check constraint/i);
    database.close();
  });

  it('keeps the global legacy chain while independently advancing interleaved tenant heads', () => {
    const persistence = openPersistence({ dataDirectory: temporaryDirectory() });
    const companyA = createCompany(persistence, '双链甲', 'dual-a@example.test');
    const companyB = createCompany(persistence, '双链乙', 'dual-b@example.test');
    const eventA1 = appendEvent(persistence, companyA.tenant.id, 'evt_dual_a_1', 1);
    const eventB1 = appendEvent(persistence, companyB.tenant.id, 'evt_dual_b_1', 1);
    const eventA2 = appendEvent(persistence, companyA.tenant.id, 'evt_dual_a_2', 2);

    expect(eventA2.previousHash).toBe(eventB1.hash);
    expect(eventB1.previousHash).toBe(eventA1.hash);
    expect(persistence.governance.getChainHead(companyA.tenant.id)).toMatchObject({ position: 3 });
    expect(persistence.governance.getChainHead(companyB.tenant.id)).toMatchObject({ position: 2 });
    expect(persistence.verifyTenantDomainEventIntegrity(companyA.tenant.id)).toEqual({ valid: true, checked: 3 });
    expect(persistence.verifyTenantDomainEventIntegrity(companyB.tenant.id)).toEqual({ valid: true, checked: 2 });
    expect(persistence.verifyDomainEventIntegrity()).toEqual({ valid: true, checked: 5 });
    const exported = persistence.governance.exportChainHead(companyA.tenant.id, 'device-governance-test');
    expect(exported).toEqual({
      device_id: 'device-governance-test',
      tenant_id: companyA.tenant.id,
      position: 3,
      hash: persistence.governance.getChainHead(companyA.tenant.id)?.hash,
      at: expect.any(String),
    });
    persistence.close();
  });

  it.each(['delete', 'reorder', 'tamper'] as const)('detects tenant-chain %s without contaminating another tenant verifier', (mutation) => {
    const directory = temporaryDirectory();
    const persistence = openPersistence({ dataDirectory: directory });
    const companyA = createCompany(persistence, `篡改甲-${mutation}`, `tamper-a-${mutation}@example.test`);
    const companyB = createCompany(persistence, `篡改乙-${mutation}`, `tamper-b-${mutation}@example.test`);
    const eventA = appendEvent(persistence, companyA.tenant.id, `evt_tamper_a_${mutation}`, 1);
    appendEvent(persistence, companyA.tenant.id, `evt_tamper_a_${mutation}_second`, 2);
    appendEvent(persistence, companyB.tenant.id, `evt_tamper_b_${mutation}`, 1);
    const databasePath = persistence.databasePath;
    persistence.close();

    const database = openSqlite(databasePath);
    if (mutation === 'delete') {
      database.pragma('foreign_keys = OFF');
      database.prepare('DELETE FROM domain_events WHERE tenant_id = ? AND id = ?')
        .run(companyA.tenant.id, eventA.id);
    } else if (mutation === 'reorder') {
      const rows = database.prepare(`
        SELECT event_id FROM tenant_event_chain WHERE tenant_id = ? ORDER BY tenant_position LIMIT 2
      `).all<{ event_id: string }>(companyA.tenant.id);
      database.prepare('UPDATE tenant_event_chain SET tenant_position = 99 WHERE tenant_id = ? AND event_id = ?')
        .run(companyA.tenant.id, rows[0]?.event_id);
      database.prepare('UPDATE tenant_event_chain SET tenant_position = 1 WHERE tenant_id = ? AND event_id = ?')
        .run(companyA.tenant.id, rows[1]?.event_id);
      database.prepare('UPDATE tenant_event_chain SET tenant_position = 2 WHERE tenant_id = ? AND event_id = ?')
        .run(companyA.tenant.id, rows[0]?.event_id);
    } else {
      database.prepare('UPDATE domain_events SET canonical_payload = ? WHERE tenant_id = ? AND id = ?')
        .run('{"sequence":999}', companyA.tenant.id, eventA.id);
    }
    database.close();

    const reopened = openPersistence({ dataDirectory: directory });
    expect(reopened.verifyTenantDomainEventIntegrity(companyA.tenant.id)).toMatchObject({ valid: false });
    expect(reopened.verifyTenantDomainEventIntegrity(companyB.tenant.id)).toEqual({ valid: true, checked: 2 });
    reopened.close();
  });
});

describe('[TEN-W4-GOVERNANCE] tenant audit export, quota, and lifecycle', () => {
  it('[TEN-W4-EXPORT-DESKTOP] creates a tenant-explicit audit manifest with file hashes and rejects foreign event/export references', () => {
    const directory = temporaryDirectory();
    const persistence = openPersistence({ dataDirectory: directory });
    const companyA = createCompany(persistence, '审计甲', 'audit-a@example.test');
    const companyB = createCompany(persistence, '审计乙', 'audit-b@example.test');
    appendEvent(persistence, companyA.tenant.id, 'evt_audit_a', 1);
    appendEvent(persistence, companyB.tenant.id, 'evt_audit_b', 1);
    const eventsA = persistence.listDomainEvents(companyA.session.token);
    const eventsB = persistence.listDomainEvents(companyB.session.token);
    const headA = persistence.governance.getChainHead(companyA.tenant.id)!;
    const headB = persistence.governance.getChainHead(companyB.tenant.id)!;

    const record = persistence.governance.createAuditExport({
      exportId: 'audit_export_a',
      tenantId: companyA.tenant.id,
      rangeFrom: 1,
      rangeTo: headA.position,
      eventIds: eventsA.map((event) => event.id),
      files: [
        { path: 'results/summary.json', sha256: sha256Hex('summary-a'), sizeBytes: 9 },
        { path: 'receipts/outcome.json', sha256: sha256Hex('receipt-a'), sizeBytes: 9 },
      ],
      createdAt: '2026-10-07T06:00:00.000Z',
    });

    expect(record.manifest.tenantId).toBe(companyA.tenant.id);
    expect(record.manifest.files).toEqual([
      expect.objectContaining({ path: 'receipts/outcome.json', sha256: sha256Hex('receipt-a') }),
      expect.objectContaining({ path: 'results/summary.json', sha256: sha256Hex('summary-a') }),
    ]);
    expect(record.sha256).toBe(sha256Hex(canonicalJson(record.manifest)));
    expect(persistence.governance.verifyAuditExport(companyA.tenant.id, record.exportId)).toBe(true);
    expect(persistence.governance.getAuditExport(companyB.tenant.id, record.exportId)).toBeUndefined();
    expect(canonicalJson(record.manifest)).not.toContain(companyB.tenant.id);
    expect(canonicalJson(record.manifest)).not.toContain(eventsB[0]!.id);

    const foreignReferenceError = errorMessage(() => persistence.governance.createAuditExport({
      exportId: 'audit_export_b_foreign_ref',
      tenantId: companyB.tenant.id,
      rangeFrom: 1,
      rangeTo: headB.position,
      eventIds: eventsA.slice(0, headB.position).map((event) => event.id),
      files: [],
    }));
    const unknownReferenceError = errorMessage(() => persistence.governance.createAuditExport({
      exportId: 'audit_export_b_unknown_ref',
      tenantId: companyB.tenant.id,
      rangeFrom: 1,
      rangeTo: headB.position,
      eventIds: Array.from({ length: headB.position }, (_, index) => `evt_unknown_${index}`),
      files: [],
    }));
    expect(foreignReferenceError).toBe(unknownReferenceError);
    expect(errorMessage(() => persistence.governance.createAuditExport({
      exportId: record.exportId,
      tenantId: companyB.tenant.id,
      rangeFrom: 1,
      rangeTo: headB.position,
      eventIds: eventsB.map((event) => event.id),
      files: [],
    }))).toBe(unknownReferenceError);
    const databasePath = persistence.databasePath;
    persistence.close();
    const database = openSqlite(databasePath);
    database.prepare('UPDATE audit_exports SET manifest_json = ? WHERE tenant_id = ? AND export_id = ?')
      .run('{}', companyA.tenant.id, record.exportId);
    database.close();
    const reopened = openPersistence({ dataDirectory: directory, databasePath });
    expect(reopened.governance.verifyAuditExport(companyA.tenant.id, record.exportId)).toBe(false);
    reopened.close();
  });

  it('warns once at 80%, rejects the next task at 100%, records rejection in-chain, and is idempotent', () => {
    const directory = temporaryDirectory();
    const first = openPersistence({ dataDirectory: directory });
    const companyA = createCompany(first, '配额甲', 'quota-a@example.test');
    const companyB = createCompany(first, '配额乙', 'quota-b@example.test');
    const databasePath = first.databasePath;
    first.close();
    seedFleetNode(databasePath, companyA.tenant.id, 'node-quota-a');
    seedFleetNode(databasePath, companyB.tenant.id, 'node-quota-b');

    const persistence = openPersistence({ dataDirectory: directory });
    for (const [metric, limit] of [['tasks', 2], ['tokens', 100], ['cost_cny', 10]] as const) {
      persistence.governance.configureQuota({
        tenantId: companyA.tenant.id, nodeId: 'node-quota-a', windowDay: '2026-10-07', metric, limit,
      });
    }
    expect(errorMessage(() => persistence.governance.configureQuota({
      tenantId: companyA.tenant.id,
      nodeId: 'node-quota-b',
      windowDay: '2026-10-07',
      metric: 'tasks',
      limit: 1,
    }))).toBe(errorMessage(() => persistence.governance.configureQuota({
      tenantId: companyA.tenant.id,
      nodeId: 'node-unknown',
      windowDay: '2026-10-07',
      metric: 'tasks',
      limit: 1,
    })));

    const firstAdmission = persistence.governance.admitQuotaUsage({
      tenantId: companyA.tenant.id, nodeId: 'node-quota-a', windowDay: '2026-10-07',
      idempotencyKey: 'quota-admission-1', actorRef: `account:${companyA.account.id}`,
      tasks: 1, tokens: 70, costCny: 5,
    });
    expect(firstAdmission).toMatchObject({ accepted: true, warnings: [] });
    const secondAdmission = persistence.governance.admitQuotaUsage({
      tenantId: companyA.tenant.id, nodeId: 'node-quota-a', windowDay: '2026-10-07',
      idempotencyKey: 'quota-admission-2', actorRef: `account:${companyA.account.id}`,
      tasks: 1, tokens: 10, costCny: 3,
    });
    expect(secondAdmission).toMatchObject({
      accepted: true,
      warnings: ['tasks', 'tokens', 'cost_cny'],
    });
    const headAfterAccepted = persistence.governance.getChainHead(companyA.tenant.id)!;
    expect(persistence.governance.admitQuotaUsage({
      tenantId: companyA.tenant.id, nodeId: 'node-quota-a', windowDay: '2026-10-07',
      idempotencyKey: 'quota-admission-2', actorRef: `account:${companyA.account.id}`,
      tasks: 1, tokens: 10, costCny: 3,
    })).toEqual(secondAdmission);
    expect(persistence.governance.getChainHead(companyA.tenant.id)).toEqual(headAfterAccepted);

    const rejected = persistence.governance.admitQuotaUsage({
      tenantId: companyA.tenant.id, nodeId: 'node-quota-a', windowDay: '2026-10-07',
      idempotencyKey: 'quota-admission-3', actorRef: `account:${companyA.account.id}`,
      tasks: 1, tokens: 1, costCny: 0,
    });
    expect(rejected).toMatchObject({ accepted: false, reason: 'quota_exceeded' });
    expect(rejected.counters.find((counter) => counter.metric === 'tasks')).toMatchObject({ used: 2, limit: 2 });
    const quotaEvents = persistence.listDomainEvents(companyA.session.token).filter((event) => event.type.startsWith('quota.'));
    expect(quotaEvents.filter((event) => event.type === 'quota.warning')).toHaveLength(3);
    expect(quotaEvents.at(-1)).toMatchObject({ type: 'quota.rejected' });
    expect(persistence.verifyTenantDomainEventIntegrity(companyA.tenant.id)).toMatchObject({ valid: true });
    expect(persistence.listDomainEvents(companyB.session.token).some((event) => event.type.startsWith('quota.'))).toBe(false);
    persistence.close();
  });

  it('stores lifecycle states, blocks quota admission while suspended, and requires L3 plus a complete export without deleting data', () => {
    const directory = temporaryDirectory();
    const first = openPersistence({ dataDirectory: directory });
    const company = createCompany(first, '生命周期租户', 'lifecycle-governance@example.test');
    const databasePath = first.databasePath;
    first.close();
    seedFleetNode(databasePath, company.tenant.id, 'node-lifecycle');

    const persistence = openPersistence({ dataDirectory: directory });
    for (const metric of ['tasks', 'tokens', 'cost_cny'] as const) {
      persistence.governance.configureQuota({
        tenantId: company.tenant.id, nodeId: 'node-lifecycle', windowDay: '2026-10-07', metric, limit: 100,
      });
    }
    expect(persistence.governance.suspendTenant(company.tenant.id, `account:${company.account.id}`)).toBe('suspended');
    expect(persistence.governance.admitQuotaUsage({
      tenantId: company.tenant.id, nodeId: 'node-lifecycle', windowDay: '2026-10-07',
      idempotencyKey: 'suspended-task', actorRef: `account:${company.account.id}`,
      tasks: 1, tokens: 1, costCny: 1,
    })).toMatchObject({ accepted: false, reason: 'tenant_unavailable' });
    expect(persistence.governance.activateTenant(company.tenant.id, `account:${company.account.id}`)).toBe('active');
    expect(persistence.governance.requireExportBeforeDestruction(company.tenant.id, `account:${company.account.id}`))
      .toBe('export_required');
    expect(() => persistence.governance.authorizeTenantDestruction(
      company.tenant.id, `account:${company.account.id}`,
      { level: 'L3', reference: 'L3-approved-but-no-export', approvedBy: 'owner', approvedAt: '2026-10-07T06:00:00.000Z' },
    )).toThrow('complete audit export');

    const headBeforeExport = persistence.governance.getChainHead(company.tenant.id)!;
    persistence.governance.createAuditExport({
      exportId: 'audit_before_destroy',
      tenantId: company.tenant.id,
      rangeFrom: 1,
      rangeTo: headBeforeExport.position,
      files: [],
    });
    expect(() => persistence.governance.authorizeTenantDestruction(
      company.tenant.id, `account:${company.account.id}`,
      { level: 'L3', reference: '   ', approvedBy: 'owner', approvedAt: '2026-10-07T06:00:00.000Z' },
    )).toThrow('L3 authorization reference');
    expect(persistence.governance.authorizeTenantDestruction(
      company.tenant.id, `account:${company.account.id}`,
      {
        level: 'L3',
        reference: 'L3-change-2026-10-07-001',
        approvedBy: '丘总',
        approvedAt: '2026-10-07T06:00:00.000Z',
      },
    )).toBe('destroyed');
    expect(persistence.governance.getTenantStatus(company.tenant.id)).toBe('destroyed');
    expect(persistence.governance.getChainHead(company.tenant.id)?.position).toBe(headBeforeExport.position + 1);
    expect(persistence.governance.getAuditExport(company.tenant.id, 'audit_before_destroy')).toBeDefined();
    expect(persistence.verifyTenantDomainEventIntegrity(company.tenant.id)).toMatchObject({ valid: true });
    expect(() => persistence.governance.setSetting(company.tenant.id, 'after_destroy', true)).toThrow('Tenant is unavailable');
    persistence.close();
  });
});

function createCompany(persistence: ReturnType<typeof openPersistence>, companyName: string, email: string) {
  return persistence.identity.createCompany({ companyName, displayName: `${companyName}负责人`, email });
}

function appendEvent(persistence: ReturnType<typeof openPersistence>, tenantId: string, id: string, sequence: number) {
  return persistence.appendDomainEvent({
    id,
    tenantId,
    aggregateType: 'governance_test',
    aggregateId: `aggregate_${tenantId}`,
    type: 'governance.tested',
    occurredAt: `2026-10-07T06:00:0${sequence}.000Z`,
    actorRef: 'system:test',
    correlationId: `corr_${tenantId}`,
    payload: { sequence },
  });
}

function seedV11Database(databasePath: string): void {
  const database = openSqlite(databasePath);
  database.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
  for (const migration of migrations.filter((item) => item.version <= 11)) {
    database.exec(migration.sql);
    database.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
      .run(migration.version, migration.name, '2026-10-07T00:00:00.000Z');
  }
  database.prepare(`
    INSERT INTO tenants (id, name, slug, status, created_at, updated_at)
    VALUES ('tenant_v11', 'V11 Tenant', 'v11-tenant', 'active', ?, ?)
  `).run('2026-10-07T00:00:00.000Z', '2026-10-07T00:00:00.000Z');
  database.prepare(`
    INSERT INTO accounts (id, email, phone, display_name, status, created_at, updated_at)
    VALUES ('account_v11', 'owner-v11@example.test', NULL, 'V11 Owner', 'active', ?, ?)
  `).run('2026-10-07T00:00:00.000Z', '2026-10-07T00:00:00.000Z');
  database.prepare(`
    INSERT INTO human_users (id, tenant_id, display_name, role, status, created_at, updated_at, account_id)
    VALUES ('human_v11', 'tenant_v11', 'V11 Owner', 'owner', 'active', ?, ?, 'account_v11')
  `).run('2026-10-07T00:00:00.000Z', '2026-10-07T00:00:00.000Z');
  database.prepare(`
    INSERT INTO memberships (id, tenant_id, account_id, human_user_id, role, status, created_at, updated_at)
    VALUES ('membership_v11', 'tenant_v11', 'account_v11', 'human_v11', 'owner', 'active', ?, ?)
  `).run('2026-10-07T00:00:00.000Z', '2026-10-07T00:00:00.000Z');
  database.prepare(`
    INSERT INTO invitations (
      id, tenant_id, contact_type, contact_value, role, token_hash, status,
      invited_by_account_id, accepted_by_account_id, expires_at, created_at, accepted_at
    ) VALUES (
      'invitation_v11', 'tenant_v11', 'email', 'member-v11@example.test', 'member',
      'v11-token-hash', 'pending', 'account_v11', NULL, ?, ?, NULL
    )
  `).run('2026-10-14T00:00:00.000Z', '2026-10-07T00:00:00.000Z');
  const event = {
    actorRef: 'system:v11',
    aggregateId: 'tenant_v11',
    aggregateType: 'tenant',
    aggregateVersion: 1,
    correlationId: 'corr_v11',
    id: 'evt_v11_legacy',
    occurredAt: '2026-10-07T00:00:01.000Z',
    payload: { legacy: true },
    previousHash: null,
    tenantId: 'tenant_v11',
    type: 'tenant.legacy',
  };
  database.prepare(`
    INSERT INTO domain_events (
      id, tenant_id, aggregate_type, aggregate_id, aggregate_version, event_type,
      occurred_at, actor_ref, correlation_id, canonical_payload, previous_hash, hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.id, event.tenantId, event.aggregateType, event.aggregateId, event.aggregateVersion, event.type,
    event.occurredAt, event.actorRef, event.correlationId, canonicalJson(event.payload), event.previousHash,
    sha256Hex(canonicalJson(event)),
  );
  database.close();
}

function seedFleetNode(databasePath: string, tenantId: string, nodeId: string): void {
  const database = openSqlite(databasePath);
  database.prepare(`
    INSERT INTO fleet_nodes (tenant_id, node_id, manifest_json, last_seen_at, status)
    VALUES (?, ?, '{}', '2026-10-07T00:00:00.000Z', 'online')
  `).run(tenantId, nodeId);
  database.close();
}

function errorMessage(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('Expected operation to fail');
}

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'hummer-tenant-governance-'));
  temporaryDirectories.push(directory);
  return directory;
}
