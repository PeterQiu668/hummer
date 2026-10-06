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

describe('[TEN-P0B-DESKTOP-IDENTIFIERS] tenant-scoped persistence identifiers', () => {
  it('keeps domain-event idempotency tenant-scoped and tenant integrity independent of foreign tampering', () => {
    const directory = temporaryDirectory();
    const persistence = openPersistence({ dataDirectory: directory });
    const companyA = createCompany(persistence, '事件甲', 'event-a@example.test');
    const companyB = createCompany(persistence, '事件乙', 'event-b@example.test');
    const eventA = domainEvent('evt_shared_tenant_identifier', companyA.tenant.id, 'tenant-a-private');

    persistence.appendDomainEvent(eventA);
    expect(persistence.appendDomainEvent(eventA)).toMatchObject({ id: eventA.id, tenantId: companyA.tenant.id });
    expect(() => persistence.appendDomainEvent(domainEvent(eventA.id, companyB.tenant.id, 'tenant-b-private')))
      .toThrow('Domain event is unavailable in the current tenant');
    expect(persistence.listDomainEvents(companyB.session.token).some((event) => event.id === eventA.id)).toBe(false);

    const foreignEvent = persistence.listDomainEvents(companyB.session.token)[0];
    const databasePath = persistence.databasePath;
    persistence.close();
    const database = openSqlite(databasePath);
    database.prepare('UPDATE domain_events SET canonical_payload = ? WHERE tenant_id = ? AND id = ?')
      .run('{"tampered":true}', companyB.tenant.id, foreignEvent.id);
    database.close();

    const reopened = openPersistence({ dataDirectory: directory });
    expect(reopened.verifyTenantDomainEventIntegrity(companyA.tenant.id)).toMatchObject({ valid: true });
    expect(reopened.verifyTenantDomainEventIntegrity(companyB.tenant.id)).toMatchObject({
      valid: false, eventId: foreignEvent.id, reason: 'hash_mismatch',
    });
    expect(reopened.verifyDomainEventIntegrity()).toMatchObject({ valid: false, eventId: foreignEvent.id });
    reopened.close();
  });

  it('prevents execution-node overwrite, mutation, and current-session lookup across tenants', () => {
    const persistence = openPersistence({ dataDirectory: temporaryDirectory() });
    const companyA = createCompany(persistence, '节点甲', 'node-a@example.test');
    const companyB = createCompany(persistence, '节点乙', 'node-b@example.test');
    const tenantA = companyA.tenant.id;
    const tenantB = companyB.tenant.id;

    persistence.runtimeEvents.saveSession({
      sessionId: 'session_node_a', tenantId: tenantA, runtimeId: 'codex-cli',
      startedAt: '2026-10-07T05:00:00.000Z', plan: {}, handle: {},
    });
    persistence.runtimeEvents.saveSession({
      sessionId: 'session_node_b', tenantId: tenantB, runtimeId: 'codex-cli',
      startedAt: '2026-10-07T05:00:01.000Z', plan: {}, handle: {},
    });
    persistence.executionNodes.registerLocal({
      id: 'node_shared_global_id', tenantId: tenantA, displayName: '甲节点', runtimeId: 'codex-cli',
      cwd: 'C:\\tenant-a', permissionScope: 'read-only', lastSeenAt: '2026-10-07T05:00:02.000Z',
    });

    expect(persistence.executionNodes.list(tenantA)[0]).toMatchObject({
      displayName: '甲节点', currentSessionId: 'session_node_a', status: 'online',
    });
    expect(() => persistence.executionNodes.registerLocal({
      id: 'node_shared_global_id', tenantId: tenantB, displayName: '乙覆盖', runtimeId: 'codex-cli',
      cwd: 'C:\\tenant-b', permissionScope: 'workspace-write', lastSeenAt: '2026-10-07T05:00:03.000Z',
    })).toThrow('Execution node is unavailable in the current tenant');

    expect(errorMessage(() => persistence.executionNodes.markOffline(tenantB, 'node_shared_global_id', '2026-10-07T05:00:04.000Z')))
      .toBe(errorMessage(() => persistence.executionNodes.markOffline(tenantB, 'node_unknown', '2026-10-07T05:00:04.000Z')));
    expect(persistence.executionNodes.list(tenantA)[0]).toMatchObject({ displayName: '甲节点', status: 'online' });
    expect(persistence.executionNodes.list(tenantB)).toEqual([]);

    persistence.executionNodes.markOffline(tenantA, 'node_shared_global_id', '2026-10-07T05:00:05.000Z');
    expect(persistence.executionNodes.list(tenantA)[0].status).toBe('offline');
    persistence.close();
  });

  it('rejects foreign employee, department, human, and twin identifiers without leaking ownership', () => {
    const persistence = openPersistence({ dataDirectory: temporaryDirectory() });
    const companyA = createCompany(persistence, '组织甲', 'organization-a@example.test');
    const companyB = createCompany(persistence, '组织乙', 'organization-b@example.test');
    const tenantA = companyA.tenant.id;
    const tenantB = companyB.tenant.id;
    const humanA = companyA.membership.humanUserId;
    const humanB = companyB.membership.humanUserId;
    const twinA = persistence.identity.listActiveTwins(companyA.session.token, humanA)[0].id;

    persistence.organization.hireDigitalEmployee({
      id: 'employee_tenant_a_private', tenantId: tenantA, sponsorActorRef: `human:${humanA}`,
      departmentId: 'department_tenant_a_private', name: '甲员工', jobTitle: '研究员',
      runtimeProfile: 'standard', autonomyLevel: 'L2', idempotencyKey: 'hire-tenant-a-private',
    });

    expect(errorMessage(() => persistence.organization.hireDigitalEmployee({
      id: 'employee_foreign_human', tenantId: tenantB, sponsorActorRef: `human:${humanA}`,
      departmentId: 'department_b_human', name: '错误员工', jobTitle: '研究员',
      runtimeProfile: 'standard', autonomyLevel: 'L2', idempotencyKey: 'hire-foreign-human',
    }))).toBe(errorMessage(() => persistence.organization.hireDigitalEmployee({
      id: 'employee_unknown_human', tenantId: tenantB, sponsorActorRef: 'human:human_unknown',
      departmentId: 'department_b_unknown_human', name: '错误员工', jobTitle: '研究员',
      runtimeProfile: 'standard', autonomyLevel: 'L2', idempotencyKey: 'hire-unknown-human',
    })));
    expect(errorMessage(() => persistence.organization.hireDigitalEmployee({
      id: 'employee_foreign_twin', tenantId: tenantB, sponsorActorRef: `twin:${twinA}`,
      departmentId: 'department_b_twin', name: '错误员工', jobTitle: '研究员',
      runtimeProfile: 'standard', autonomyLevel: 'L2', idempotencyKey: 'hire-foreign-twin',
    }))).toBe(errorMessage(() => persistence.organization.hireDigitalEmployee({
      id: 'employee_unknown_twin', tenantId: tenantB, sponsorActorRef: 'twin:twin_unknown',
      departmentId: 'department_b_unknown', name: '错误员工', jobTitle: '研究员',
      runtimeProfile: 'standard', autonomyLevel: 'L2', idempotencyKey: 'hire-unknown-twin',
    })));
    expect(() => persistence.organization.hireDigitalEmployee({
      id: 'employee_foreign_department', tenantId: tenantB, sponsorActorRef: `human:${humanB}`,
      departmentId: 'department_tenant_a_private', name: '错误员工', jobTitle: '研究员',
      runtimeProfile: 'standard', autonomyLevel: 'L2', idempotencyKey: 'hire-foreign-department',
    })).toThrow('Organization resource is unavailable in the current tenant');
    expect(() => persistence.organization.hireDigitalEmployee({
      id: 'employee_tenant_a_private', tenantId: tenantB, sponsorActorRef: `human:${humanB}`,
      departmentId: 'department_tenant_b_private', name: '覆盖员工', jobTitle: '研究员',
      runtimeProfile: 'standard', autonomyLevel: 'L2', idempotencyKey: 'hire-foreign-employee',
    })).toThrow('Organization resource is unavailable in the current tenant');

    expect(persistence.organization.listDigitalEmployees(tenantA)).toEqual([
      expect.objectContaining({ id: 'employee_tenant_a_private', name: '甲员工' }),
    ]);
    expect(persistence.organization.listDigitalEmployees(tenantB)).toEqual([]);
    expect(persistence.identity.listActiveTwins(companyB.session.token, humanA)).toEqual([]);
    expect(persistence.identity.resolveActor(companyB.session.token, `human:${humanA}`)).toBeUndefined();
    expect(errorMessage(() => persistence.identity.createTwinForHuman(companyB.session.token, humanA, '越权分身')))
      .toBe(errorMessage(() => persistence.identity.createTwinForHuman(companyB.session.token, 'human_unknown', '未知分身')));
    persistence.close();
  });
});

function createCompany(persistence: ReturnType<typeof openPersistence>, companyName: string, email: string) {
  return persistence.identity.createCompany({ companyName, displayName: `${companyName}负责人`, email });
}

function domainEvent(id: string, tenantId: string, secret: string) {
  return {
    id, tenantId, aggregateType: 'work_order', aggregateId: `work_${tenantId}`,
    type: 'work_order.created', occurredAt: '2026-10-07T04:00:00.000Z',
    actorRef: 'human:owner', correlationId: `corr_${tenantId}`, payload: { secret },
  };
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
  const directory = mkdtempSync(join(tmpdir(), 'hummer-tenant-identifiers-'));
  temporaryDirectories.push(directory);
  return directory;
}
