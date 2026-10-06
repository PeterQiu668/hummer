import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  FleetService,
  MemoryFleetStore,
  RELAY_SCHEMA_VERSION,
  SqliteFleetStore,
  createFleetRelayServer,
  createSharedFleetValidators,
  createStaticBadgeTokenAuthenticator,
  verifyTenantAuditChain,
  verifyTenantAuditExport,
  type BadgeScope,
  type FleetStore,
  type NodeClaims,
  type TaskClaims,
} from '../src/index.js';

const NOW = '2026-10-07T00:00:00.000Z';
const DAY = '2026-10-07';
const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const NODE = 'node-main';
const openStores: FleetStore[] = [];
const openApps: FastifyInstance[] = [];

const nodeClaims = (tenantId: string): NodeClaims => ({ nodeId: NODE, tenantIds: [tenantId], agentVersion: '0.1.0' });
const manifest = (tenantId: string) => ({ nodeId: NODE, tenantIds: [tenantId], agentVersion: '0.1.0' });
const taskClaims = (tenantId: string, index: number): TaskClaims => ({
  taskId: `task-${index}`, workOrderId: `work-${index}`, tenantId,
  targetNodeId: NODE, targetRuntime: 'codex', idempotencyKey: `delivery-${index}`,
  leaseMs: 30_000, expiresAt: '2026-10-07T01:00:00.000Z', originRef: `work-${index}`,
});

async function register(store: FleetStore, tenantId: string) {
  const claims = nodeClaims(tenantId);
  return store.registerNode(tenantId, manifest(tenantId), claims, [tenantId], undefined, NOW, 60_000);
}

async function enqueue(store: FleetStore, tenantId: string, index: number) {
  const claims = taskClaims(tenantId, index);
  return store.enqueueTask(tenantId, { ...claims }, claims, null, NOW);
}

afterEach(async () => {
  openStores.splice(0).forEach((store) => store.close());
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

for (const [name, factory] of [
  ['memory', () => new MemoryFleetStore()],
  ['sqlite', () => new SqliteFleetStore(':memory:')],
] as const) {
  describe(`[TEN-W4-RELAY-GOVERNANCE] ${name} tenant governance`, () => {
    it('[TEN-W4-SIDE-CHAIN-HEAD] maintains independent verifiable tenant audit chains and chain heads', async () => {
      const store = factory();
      openStores.push(store);
      await register(store, TENANT_A);
      await register(store, TENANT_B);
      await store.configureQuota(TENANT_A, NODE, DAY, { tasks: 2 }, 'human:owner', NOW);

      const auditA = await store.listTenantAudit(TENANT_A);
      const auditB = await store.listTenantAudit(TENANT_B);
      expect(auditA.map((entry) => entry.position)).toEqual([1, 2]);
      expect(auditB.map((entry) => entry.position)).toEqual([1]);
      expect(verifyTenantAuditChain(TENANT_A, auditA)).toEqual({ valid: true, position: 2, hash: auditA[1]!.hash });
      expect(verifyTenantAuditChain(TENANT_B, auditB)).toEqual({ valid: true, position: 1, hash: auditB[0]!.hash });
      expect(await store.getTenantChainHead(TENANT_A)).toMatchObject({ tenantId: TENANT_A, position: 2, hash: auditA[1]!.hash });
      expect(await store.getTenantChainHead(TENANT_B)).toMatchObject({ tenantId: TENANT_B, position: 1, hash: auditB[0]!.hash });
      expect(JSON.stringify(auditA)).not.toContain(TENANT_B);
      expect(JSON.stringify(auditB)).not.toContain(TENANT_A);
    });

    it('[TEN-W4-QUOTA-ADMISSION] warns once at 80 percent and rejects only new enqueue after a quota reaches 100 percent', async () => {
      const store = factory();
      openStores.push(store);
      await register(store, TENANT_A);
      await store.configureQuota(TENANT_A, NODE, DAY, { tasks: 5, tokens: 100, costCny: 10 }, 'human:owner', NOW);

      for (let index = 1; index <= 5; index += 1) await enqueue(store, TENANT_A, index);
      expect((await enqueue(store, TENANT_A, 5)).inserted).toBe(false);
      const taskCounter = (await store.listQuotaCounters(TENANT_A, NODE, DAY)).find((counter) => counter.metric === 'tasks');
      expect(taskCounter).toMatchObject({ used: 5, limit: 5, warningEmitted: true });
      expect((await store.listTenantAudit(TENANT_A)).filter((entry) => entry.action === 'quota.warning' && entry.metadata.metric === 'tasks')).toHaveLength(1);

      await expect(enqueue(store, TENANT_A, 6)).rejects.toMatchObject({ code: 'quota_exceeded' });
      expect(await store.getTask(TENANT_A, 'task-6', NOW)).toBeNull();
      expect((await store.listTenantAudit(TENANT_A)).at(-1)).toMatchObject({
        action: 'quota.exceeded', nodeId: NODE, metadata: { metrics: ['tasks'] },
      });

      await store.recordQuotaUsage(TENANT_A, NODE, { tokens: 80, costCny: 8 }, 'system:node-main', NOW);
      await store.recordQuotaUsage(TENANT_A, NODE, { tokens: 20, costCny: 2 }, 'system:node-main', NOW);
      expect(await store.listQuotaCounters(TENANT_A, NODE, DAY)).toEqual(expect.arrayContaining([
        expect.objectContaining({ metric: 'tokens', used: 100, limit: 100, warningEmitted: true }),
        expect.objectContaining({ metric: 'costCny', used: 10, limit: 10, warningEmitted: true }),
      ]));
      expect((await store.listTenantAudit(TENANT_A)).filter((entry) => entry.action === 'quota.warning' && entry.metadata.metric === 'tokens')).toHaveLength(1);
      expect((await store.listTenantAudit(TENANT_A)).filter((entry) => entry.action === 'quota.warning' && entry.metadata.metric === 'costCny')).toHaveLength(1);
    });

    it('[TEN-W4-READ-AUDIT-EXPORT] [TEN-W4-EXPORT-MANIFEST] persists tenant-qualified audit export metadata and hides foreign export references', async () => {
      const store = factory();
      openStores.push(store);
      await register(store, TENANT_A);
      await register(store, TENANT_B);
      await enqueue(store, TENANT_A, 1);
      const before = await store.getTenantChainHead(TENANT_A);
      const exported = await store.createAuditExport(TENANT_A, 1, before!.position, 'human:auditor', NOW);

      expect(exported).toMatchObject({
        tenantId: TENANT_A, rangeFrom: 1, rangeTo: before!.position,
        manifest: { schema: 'hummer.relay-audit-export', version: 1, tenantId: TENANT_A, chainHeadHash: before!.hash },
      });
      expect(exported.sha256).toMatch(/^[a-f0-9]{64}$/);
      const exportedEvents = await store.listTenantAudit(TENANT_A, exported.rangeFrom, exported.rangeTo);
      expect(verifyTenantAuditExport(exported, exportedEvents)).toEqual({
        valid: true, eventCount: exportedEvents.length, chainHeadHash: before!.hash,
      });
      const tampered = structuredClone(exportedEvents);
      tampered[0]!.metadata = { altered: true };
      expect(verifyTenantAuditExport(exported, tampered)).toMatchObject({ valid: false, reason: 'chain_mismatch' });
      expect(await store.getAuditExport(TENANT_A, exported.exportId)).toEqual(exported);
      expect(await store.getAuditExport(TENANT_B, exported.exportId)).toBeNull();
      expect(await store.getAuditExport(TENANT_B, 'audit-export-missing')).toBeNull();
      expect(JSON.stringify(exported)).not.toContain(TENANT_B);
      expect((await store.getTenantChainHead(TENANT_A))!.position).toBe(before!.position + 1);
      expect((await store.listTenantAudit(TENANT_B)).map((entry) => entry.action)).toEqual(['node.registered']);
    });

    it('[TEN-W4-QUOTA-TOKEN-COST] blocks new tasks when token or cost usage has exhausted the node day window', async () => {
      const store = factory();
      openStores.push(store);
      await register(store, TENANT_A);
      await store.configureQuota(TENANT_A, NODE, DAY, { tasks: 10, tokens: 100, costCny: 10 }, 'human:owner', NOW);
      await store.recordQuotaUsage(TENANT_A, NODE, { tokens: 100, costCny: 10 }, 'system:node-main', NOW);

      await expect(enqueue(store, TENANT_A, 1)).rejects.toMatchObject({ code: 'quota_exceeded' });
      expect(await store.getTask(TENANT_A, 'task-1', NOW)).toBeNull();
      expect((await store.listTenantAudit(TENANT_A)).at(-1)).toMatchObject({
        action: 'quota.exceeded', metadata: { metrics: ['costCny', 'tokens'] },
      });
    });

    it('[TEN-W4-QUOTA-FOREIGN-NODE] treats foreign and unknown quota node references identically', async () => {
      const store = factory();
      openStores.push(store);
      await register(store, TENANT_A);
      let foreign;
      let unknown;
      try {
        await store.configureQuota(TENANT_B, NODE, DAY, { tasks: 1 }, 'human:owner', NOW);
      } catch (error) {
        foreign = error;
      }
      try {
        await store.configureQuota(TENANT_B, 'node-missing', DAY, { tasks: 1 }, 'human:owner', NOW);
      } catch (error) {
        unknown = error;
      }
      expect(foreign).toMatchObject({ code: 'node_unknown' });
      expect(unknown).toMatchObject({ code: 'node_unknown' });
      expect(String(foreign)).toBe(String(unknown));
      expect(await store.listQuotaCounters(TENANT_B, NODE, DAY)).toEqual([]);
    });
  });
}

it('[TEN-W4-RELAY-GOVERNANCE] Memory and SQLite produce identical audit hashes for the same tenant facts', async () => {
  const memory = new MemoryFleetStore();
  const sqlite = new SqliteFleetStore(':memory:');
  openStores.push(memory, sqlite);
  for (const store of [memory, sqlite]) {
    await register(store, TENANT_A);
    await store.configureQuota(TENANT_A, NODE, DAY, { tasks: 2 }, 'human:owner', NOW);
    await enqueue(store, TENANT_A, 1);
  }
  expect(await sqlite.listTenantAudit(TENANT_A)).toEqual(await memory.listTenantAudit(TENANT_A));
  expect(await sqlite.getTenantChainHead(TENANT_A)).toEqual(await memory.getTenantChainHead(TENANT_A));
});

it('[TEN-W4-RELAY-GOVERNANCE] upgrades an existing Relay v13 database through v15 without changing legacy audit rows', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'hummer-relay-v13-')), 'relay.sqlite3');
  const require = createRequire(import.meta.url);
  const Database = require('better-sqlite3') as new(path: string) => {
    exec(sql: string): void;
    prepare(sql: string): { run(...params: unknown[]): unknown; all<T>(...params: unknown[]): T[] };
    close(): void;
  };
  const old = new Database(path);
  old.exec(`
    CREATE TABLE relay_schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);
    CREATE TABLE relay_audit (tenant_id TEXT NOT NULL, action TEXT NOT NULL, task_id TEXT NOT NULL, actor_ref TEXT NOT NULL, at TEXT NOT NULL, detail TEXT NOT NULL);
  `);
  const migration = old.prepare('INSERT INTO relay_schema_migrations (version, name, applied_at) VALUES (?, ?, ?)');
  migration.run(11, 'fleet_relay_nodes_tasks_leases', NOW);
  migration.run(12, 'relay_monotonic_clock', NOW);
  migration.run(13, 'relay_append_only_approval_binding', NOW);
  old.prepare('INSERT INTO relay_audit VALUES (?, ?, ?, ?, ?, ?)').run(TENANT_A, 'stop', 'legacy-task', 'human:owner', NOW, 'task-blocked');
  old.close();

  const upgraded = new SqliteFleetStore(path);
  expect(await upgraded.listAudit(TENANT_A)).toEqual([{
    tenantId: TENANT_A, action: 'stop', taskId: 'legacy-task', actorRef: 'human:owner', at: NOW, detail: 'task-blocked',
  }]);
  upgraded.close();
  const inspected = new Database(path);
  expect(inspected.prepare('SELECT version FROM relay_schema_migrations ORDER BY version').all<{ version: number }>().map((row) => row.version))
    .toEqual([11, 12, 13, 14, 15]);
  expect(RELAY_SCHEMA_VERSION).toBe(15);
  inspected.close();
});

it('[TEN-W4-RELAY-GOVERNANCE] reopens SQLite v15 with the same chain head, counters, and export manifest', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'hummer-relay-v15-')), 'relay.sqlite3');
  const first = new SqliteFleetStore(path);
  await register(first, TENANT_A);
  await first.configureQuota(TENANT_A, NODE, DAY, { tasks: 2, tokens: 100 }, 'human:owner', NOW);
  await enqueue(first, TENANT_A, 1);
  const head = await first.getTenantChainHead(TENANT_A);
  const auditExport = await first.createAuditExport(TENANT_A, 1, head!.position, 'human:auditor', NOW);
  const counters = await first.listQuotaCounters(TENANT_A, NODE, DAY);
  first.close();

  const reopened = new SqliteFleetStore(path);
  openStores.push(reopened);
  expect(await reopened.getAuditExport(TENANT_A, auditExport.exportId)).toEqual(auditExport);
  expect(await reopened.listQuotaCounters(TENANT_A, NODE, DAY)).toEqual(counters);
  expect((await reopened.getTenantChainHead(TENANT_A))!.position).toBe(head!.position + 1);
  expect(verifyTenantAuditChain(TENANT_A, await reopened.listTenantAudit(TENANT_A))).toMatchObject({ valid: true });
});

describe('[TEN-W4-RELAY-GOVERNANCE] authorized governance HTTP surfaces', () => {
  const token = (value: string, tenantId: string, nodeId: string | undefined, scopes: readonly BadgeScope[]) => ({
    token: value, tokenId: `badge-${value}`, tenantId, actorRef: nodeId ? `system:${nodeId}` : 'human:auditor', nodeId,
    scopes, expiresAt: '2026-10-07T01:00:00.000Z',
  });

  it('[TEN-W4-EXPORT-HTTP-TENANT] requires explicit scopes and derives tenant from the badge for quota, chain, and exports', async () => {
    const store = new MemoryFleetStore();
    openStores.push(store);
    await register(store, TENANT_A);
    await register(store, TENANT_B);
    const service = new FleetService(store, createSharedFleetValidators(), { now: () => new Date(NOW) });
    const authenticator = createStaticBadgeTokenAuthenticator([
      token('audit-a', TENANT_A, undefined, ['audit.read', 'audit.export', 'quota.manage', 'quota.read']),
      token('node-a', TENANT_A, NODE, ['quota.record', 'quota.read']),
      token('audit-b', TENANT_B, undefined, ['audit.read']),
      token('enqueue-only', TENANT_A, undefined, ['task.enqueue']),
    ]);
    const { app } = createFleetRelayServer(service, { authenticator, now: () => new Date(NOW) });
    openApps.push(app);

    expect((await app.inject({ method: 'GET', url: '/v1/governance/chain-head' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/v1/governance/chain-head', headers: { authorization: 'Bearer enqueue-only' } })).statusCode).toBe(403);

    const quota = await app.inject({
      method: 'PUT', url: `/v1/governance/nodes/${NODE}/quotas/${DAY}`,
      headers: { authorization: 'Bearer audit-a' }, payload: { limits: { tasks: 2, tokens: 100, costCny: 10 } },
    });
    expect(quota.statusCode).toBe(200);
    const smuggledQuota = await app.inject({
      method: 'PUT', url: `/v1/governance/nodes/${NODE}/quotas/${DAY}`,
      headers: { authorization: 'Bearer audit-a' }, payload: { tenantId: TENANT_B, limits: { tasks: 1 } },
    });
    expect(smuggledQuota.statusCode).toBe(400);
    expect(await store.listQuotaCounters(TENANT_B, NODE, DAY)).toEqual([]);
    const usage = await app.inject({
      method: 'POST', url: `/v1/governance/nodes/${NODE}/usage`,
      headers: { authorization: 'Bearer node-a' }, payload: { tokens: 80, costCny: 8 },
    });
    expect(usage.statusCode).toBe(200);

    const created = await app.inject({
      method: 'POST', url: '/v1/governance/audit-exports', headers: { authorization: 'Bearer audit-a' }, payload: {},
    });
    expect(created.statusCode).toBe(200);
    const exportId = created.json().auditExport.exportId as string;
    expect((await app.inject({
      method: 'GET', url: `/v1/governance/audit-exports/${exportId}`, headers: { authorization: 'Bearer audit-a' },
    })).statusCode).toBe(200);
    const foreign = await app.inject({
      method: 'GET', url: `/v1/governance/audit-exports/${exportId}`, headers: { authorization: 'Bearer audit-b' },
    });
    const unknown = await app.inject({
      method: 'GET', url: '/v1/governance/audit-exports/audit-export-missing', headers: { authorization: 'Bearer audit-b' },
    });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json()).toMatchObject({ error: { code: 'audit_export_not_found' } });
    expect(unknown.statusCode).toBe(foreign.statusCode);
    expect(unknown.json()).toEqual(foreign.json());
  });
});
