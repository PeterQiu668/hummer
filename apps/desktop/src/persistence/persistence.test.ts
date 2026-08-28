import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openPersistence } from './database.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

describe('desktop persistence migrations', () => {
  it('creates every M2 fact and projection table through versioned migrations', () => {
    const directory = temporaryDirectory();
    const persistence = openPersistence({ dataDirectory: directory });

    expect(persistence.schemaVersion()).toBeGreaterThanOrEqual(1);
    expect(persistence.listTables()).toEqual(expect.arrayContaining([
      'schema_migrations',
      'domain_events',
      'work_orders',
      'sessions',
      'steps',
      'approvals',
      'evidence',
      'result_packages',
    ]));

    persistence.close();
  });
  it('adds M3 organization and responsibility tables through migration version 2', () => {
    const persistence = openPersistence({ dataDirectory: temporaryDirectory() });

    expect(persistence.schemaVersion()).toBeGreaterThanOrEqual(2);
    expect(persistence.listTables()).toEqual(expect.arrayContaining([
      'human_users',
      'digital_twins',
      'digital_employees',
      'departments',
      'approval_policies',
      'execution_nodes',
    ]));
    persistence.close();
  });

  it('reopens the same database without rerunning or duplicating migrations', () => {
    const directory = temporaryDirectory();
    const first = openPersistence({ dataDirectory: directory });
    const version = first.schemaVersion();
    first.close();

    const reopened = openPersistence({ dataDirectory: directory });
    expect(reopened.schemaVersion()).toBe(version);
    expect(reopened.appliedMigrations()).toHaveLength(version);
    reopened.close();
  });
});

describe('M3 organization persistence', () => {
  it('keeps a hired employee under one durable id and appends the hire to the hash chain', () => {
    const directory = temporaryDirectory();
    const first = openPersistence({ dataDirectory: directory });
    const hired = first.organization.hireDigitalEmployee({
      id: 'employee_market-sales-01',
      tenantId: 'tenant_demo',
      sponsorActorRef: 'human:owner',
      departmentId: 'department_sales',
      name: '华东客户研究员',
      jobTitle: '客户研究员',
      runtimeProfile: 'standard',
      autonomyLevel: 'L2',
      idempotencyKey: 'hire-market-sales-01',
    });

    expect(hired.id).toBe('employee_market-sales-01');
    expect(first.organization.listDigitalEmployees('tenant_demo')).toHaveLength(1);
    expect(first.verifyDomainEventIntegrity()).toEqual({ valid: true, checked: 1 });
    first.close();

    const reopened = openPersistence({ dataDirectory: directory });
    expect(reopened.organization.listDigitalEmployees('tenant_demo')).toEqual([
      expect.objectContaining({
        id: 'employee_market-sales-01',
        sponsorActorRef: 'human:owner',
        departmentId: 'department_sales',
        runtimeProfile: 'standard',
      }),
    ]);
    expect(reopened.verifyDomainEventIntegrity()).toEqual({ valid: true, checked: 1 });
    reopened.close();
  });
});
describe('append-only domain event ledger', () => {
  it('stores canonical JSON and chains each event to the previous event hash', () => {
    const persistence = openPersistence({ dataDirectory: temporaryDirectory() });

    const first = persistence.appendDomainEvent({
      id: 'evt_001',
      tenantId: 'tenant_demo',
      aggregateType: 'session',
      aggregateId: 'ses_001',
      type: 'session.started',
      occurredAt: '2026-08-28T01:00:00.000Z',
      actorRef: 'system:desktop',
      correlationId: 'corr_001',
      payload: { z: 2, nested: { beta: true, alpha: 'first' }, a: 1 },
    });
    const second = persistence.appendDomainEvent({
      id: 'evt_002',
      tenantId: 'tenant_demo',
      aggregateType: 'session',
      aggregateId: 'ses_001',
      type: 'session.progressed',
      occurredAt: '2026-08-28T01:00:01.000Z',
      actorRef: 'employee:researcher',
      correlationId: 'corr_001',
      payload: { sequence: 2 },
    });

    expect(first.canonicalPayload).toBe('{"a":1,"nested":{"alpha":"first","beta":true},"z":2}');
    expect(first.previousHash).toBeNull();
    expect(second.previousHash).toBe(first.hash);
    expect(persistence.verifyDomainEventIntegrity()).toEqual({ valid: true, checked: 2 });
    expect(() => persistence.replaceDomainEvent(first.id, { payload: { altered: true } })).toThrow(/append-only/i);

    persistence.close();
  });

  it('detects a manual SQL UPDATE to any stored event', () => {
    const directory = temporaryDirectory();
    const persistence = openPersistence({ dataDirectory: directory });
    persistence.appendDomainEvent({
      id: 'evt_tamper_001',
      tenantId: 'tenant_demo',
      aggregateType: 'session',
      aggregateId: 'ses_tamper',
      type: 'session.started',
      occurredAt: '2026-08-28T02:00:00.000Z',
      actorRef: 'system:desktop',
      correlationId: 'corr_tamper',
      payload: { trusted: true },
    });
    persistence.appendDomainEvent({
      id: 'evt_tamper_002',
      tenantId: 'tenant_demo',
      aggregateType: 'session',
      aggregateId: 'ses_tamper',
      type: 'session.completed',
      occurredAt: '2026-08-28T02:00:01.000Z',
      actorRef: 'system:desktop',
      correlationId: 'corr_tamper',
      payload: { trusted: true },
    });
    const databasePath = persistence.databasePath;
    persistence.close();

    manuallyUpdateEvent(databasePath, 'evt_tamper_001', '{"trusted":false}');

    const reopened = openPersistence({ dataDirectory: directory });
    expect(reopened.verifyDomainEventIntegrity()).toMatchObject({
      valid: false,
      checked: 1,
      eventId: 'evt_tamper_001',
    });
    reopened.close();
  });
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'hummer-persistence-'));
  temporaryDirectories.push(directory);
  return directory;
}

function manuallyUpdateEvent(databasePath: string, eventId: string, canonicalPayload: string): void {
  const require = createRequire(import.meta.url);
  const Database = require('better-sqlite3') as new (path: string) => {
    prepare(sql: string): { run(...params: unknown[]): unknown };
    close(): void;
  };
  const database = new Database(databasePath);
  database.prepare('UPDATE domain_events SET canonical_payload = ? WHERE id = ?').run(canonicalPayload, eventId);
  database.close();
}
