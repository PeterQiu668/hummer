import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  CapabilityGrantError,
  CapabilityGrantRegistry,
  createStaticBadgeTokenAuthenticator,
  type CapabilityGrantAuthority,
  type IssueCapabilityGrantInput,
} from '../src/badge-auth.js';
import { createSharedFleetValidators } from '../src/contract-adapter.js';
import { FleetService } from '../src/fleet-service.js';
import { createFleetRelayServer, type FleetSseBroker } from '../src/fastify-transport.js';
import { MemoryFleetStore } from '../src/memory-store.js';
import type { FleetStore } from '../src/ports.js';
import { SqliteFleetStore } from '../src/sqlite-store.js';

const NOW = '2026-10-07T00:00:00.000Z';
const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const TENANT_C = 'tenant-c';
const NODE = 'node-main';
const SESSION_A = { tenantId: TENANT_A, actorRef: `system:${NODE}`, nodeId: NODE };
const MULTI_TENANT_SESSION = {
  ...SESSION_A,
  authorizedTenantIds: [TENANT_A, TENANT_B],
  tenantGrantRef: 'tenant-grant:node-main-ab',
};

const grantAuthority = (tenantId: string): CapabilityGrantAuthority => ({
  authorityRef: `authority:${tenantId}`,
  tenantId,
  capabilities: ['node.register', 'node.heartbeat'],
  paths: ['outputs/report.md'],
  expiresAt: '2026-10-07T02:00:00.000Z',
  maxUses: 4,
  nodeId: NODE,
  workOrderId: 'work-shared',
  issuedToRunId: 'run-shared',
});

const grantInput = (tenantId: string, grantId = 'grant-shared'): IssueCapabilityGrantInput => ({
  grantId,
  tenantId,
  workOrderId: 'work-shared',
  nodeId: NODE,
  capabilities: ['node.register'],
  paths: ['outputs/report.md'],
  expiresAt: '2026-10-07T01:00:00.000Z',
  maxUses: 2,
  issuedToRunId: 'run-shared',
});

function tokenSequence(): () => string {
  const tokens = [`hgr_${'a'.repeat(43)}`, `hgr_${'b'.repeat(43)}`, `hgr_${'c'.repeat(43)}`];
  return () => tokens.shift() ?? `hgr_${'z'.repeat(43)}`;
}

function manifest(tenantIds: readonly string[]) {
  return {
    schema: 'hummer.node-manifest', version: 1, nodeId: NODE, tenantIds,
    platform: 'win32', agentVersion: '0.1.0',
    runtimes: [{ kind: 'codex', available: true, pinnedVersion: '0.153.4' }],
    capabilities: ['workspace.exec'],
    mcp: { endpoint: 'stdio://hummer-local', tools: ['workspace_exec'] },
    load: { running: 0, queued: 0 },
  };
}

function nodeClaims(tenantId: string) {
  return { nodeId: NODE, tenantIds: [tenantId], agentVersion: '0.1.0' };
}

function taskClaims(tenantId: string) {
  return {
    taskId: 'task-shared', workOrderId: 'work-shared', tenantId,
    targetNodeId: NODE, targetRuntime: 'codex', idempotencyKey: 'delivery-shared',
    leaseMs: 30_000, expiresAt: '2026-10-07T01:00:00.000Z', originRef: 'origin-shared',
  };
}

function eventClaims(tenantId: string) {
  return {
    eventId: 'event-shared', tenantId, workOrderId: 'work-shared', nodeId: NODE,
    seq: 1, occurredAt: NOW, type: 'started' as const, idempotencyKey: 'event-key-shared',
  };
}

function approvalRequestClaims(tenantId: string) {
  return {
    requestId: 'request-shared', tenantId, workOrderId: 'work-shared', nodeId: NODE,
    runId: 'run-shared', riskClass: 'write', action: 'task.execute', target: 'task-shared',
    requestedScope: { capabilities: ['task.execute'], paths: ['outputs/report.md'], maxUses: 1 },
    expiresAt: '2026-10-07T01:00:00.000Z', requestedBy: `system:${NODE}`,
  };
}

function approvalDecisionClaims(tenantId: string) {
  return {
    decisionId: 'decision-shared', requestId: 'request-shared', tenantId,
    deciderActorRef: 'human:operator', decidedAt: NOW, decision: 'approved' as const,
    grantedScope: {
      capabilities: ['task.execute'], paths: ['outputs/report.md'], maxUses: 1,
      expiresAt: '2026-10-07T00:30:00.000Z',
    },
  };
}

const openStores: FleetStore[] = [];
const openApps: Array<{ app: FastifyInstance; events: FleetSseBroker }> = [];

function serviceHarness(store: FleetStore) {
  openStores.push(store);
  return {
    store,
    service: new FleetService(store, createSharedFleetValidators(), { now: () => new Date(NOW) }),
  };
}

afterEach(async () => {
  for (const entry of openApps.splice(0)) {
    entry.events.close();
    await entry.app.close();
  }
  openStores.splice(0).forEach((store) => store.close());
});

for (const [name, factory] of [
  ['memory', () => new MemoryFleetStore()],
  ['sqlite', () => new SqliteFleetStore(':memory:')],
] as const) {
  describe(`${name} Relay tenant boundary`, () => {
    it('rejects an ungranted extra tenant in a node manifest without persisting or disclosing it', async () => {
      const { service, store } = serviceHarness(factory());
      let rejection: unknown;
      try {
        await service.register(SESSION_A, manifest([TENANT_A, TENANT_B]));
      } catch (error) {
        rejection = error;
      }

      expect(rejection).toMatchObject({ code: 'tenant_mismatch' });
      expect(String(rejection)).not.toContain(TENANT_B);
      expect(await store.getNode(TENANT_A, NODE, NOW)).toBeNull();
      expect(await store.getNode(TENANT_B, NODE, NOW)).toBeNull();
    });

    it('enforces the same tenant boundary for a direct store caller', async () => {
      const store = factory();
      openStores.push(store);
      const nodeManifest = manifest([TENANT_A, TENANT_B]);

      await expect(store.registerNode(
        TENANT_A,
        nodeManifest,
        { nodeId: NODE, tenantIds: [TENANT_A, TENANT_B], agentVersion: '0.1.0' },
        [TENANT_A],
        undefined,
        NOW,
        60_000,
      )).rejects.toMatchObject({ code: 'tenant_mismatch' });
      await expect(store.registerNode(
        TENANT_A,
        nodeManifest,
        { nodeId: NODE, tenantIds: [TENANT_A, TENANT_B], agentVersion: '0.1.0' },
        [TENANT_A, TENANT_B],
        undefined,
        NOW,
        60_000,
      )).rejects.toMatchObject({ code: 'tenant_mismatch' });
      expect(await store.getNode(TENANT_A, NODE, NOW)).toBeNull();
    });

    it('accepts only a manifest subset covered by an explicit multi-tenant grant', async () => {
      const { service, store } = serviceHarness(factory());
      await expect(service.register(MULTI_TENANT_SESSION, manifest([TENANT_A, TENANT_B])))
        .resolves.toMatchObject({ tenantId: TENANT_A, tenantIds: [TENANT_A, TENANT_B] });
      expect(await store.getNode(TENANT_B, NODE, NOW)).toBeNull();

      let rejection: unknown;
      try {
        await service.register(MULTI_TENANT_SESSION, manifest([TENANT_A, TENANT_C]));
      } catch (error) {
        rejection = error;
      }
      expect(rejection).toMatchObject({ code: 'tenant_mismatch' });
      expect(String(rejection)).not.toContain(TENANT_C);
      expect(await store.getNode(TENANT_A, NODE, NOW)).toMatchObject({
        tenantIds: [TENANT_A, TENANT_B],
      });
    });

    it('keeps identical node, task, event, approval, and audit identifiers tenant-isolated', async () => {
      const store = factory();
      openStores.push(store);
      for (const tenantId of [TENANT_A, TENANT_B]) {
        await store.registerNode(
          tenantId, manifest([tenantId]), nodeClaims(tenantId), [tenantId], undefined, NOW, 60_000,
        );
        const task = taskClaims(tenantId);
        await store.enqueueTask(tenantId, { ...task }, task, null, NOW);
        await store.claimTask(tenantId, NODE, NOW);
        const runEvent = eventClaims(tenantId);
        await store.putEvent(tenantId, { ...runEvent }, runEvent, NOW);
        const request = approvalRequestClaims(tenantId);
        await store.putApprovalRequest(tenantId, 'task-shared', { ...request }, request, NOW);
        const decision = approvalDecisionClaims(tenantId);
        await store.putApprovalDecision(tenantId, { ...decision }, decision, NOW);
      }

      expect(await store.getNode(TENANT_A, NODE, NOW)).toMatchObject({ tenantId: TENANT_A });
      expect(await store.getNode(TENANT_B, NODE, NOW)).toMatchObject({ tenantId: TENANT_B });
      expect(await store.getTask(TENANT_A, 'task-shared', NOW)).toMatchObject({ tenantId: TENANT_A, status: 'leased' });
      expect(await store.getTask(TENANT_B, 'task-shared', NOW)).toMatchObject({ tenantId: TENANT_B, status: 'leased' });
      expect(await store.listEvents(TENANT_A, 'work-shared')).toEqual([
        expect.objectContaining({ tenantId: TENANT_A, eventId: 'event-shared' }),
      ]);
      expect(await store.listEvents(TENANT_B, 'work-shared')).toEqual([
        expect.objectContaining({ tenantId: TENANT_B, eventId: 'event-shared' }),
      ]);
      expect(await store.getApprovalRequest(TENANT_A, 'request-shared')).toMatchObject({ tenantId: TENANT_A });
      expect(await store.getApprovalRequest(TENANT_B, 'request-shared')).toMatchObject({ tenantId: TENANT_B });
      expect(await store.getApprovalDecision(TENANT_A, 'request-shared')).toMatchObject({ tenantId: TENANT_A });
      expect(await store.getApprovalDecision(TENANT_B, 'request-shared')).toMatchObject({ tenantId: TENANT_B });

      await store.stopTask(TENANT_A, 'task-shared', 'human:operator', NOW);
      expect(await store.getTask(TENANT_A, 'task-shared', NOW)).toMatchObject({ status: 'blocked' });
      expect(await store.getTask(TENANT_B, 'task-shared', NOW)).toMatchObject({ status: 'leased' });
      expect(await store.listAudit(TENANT_A)).toEqual([
        expect.objectContaining({ tenantId: TENANT_A, taskId: 'task-shared' }),
      ]);
      expect(await store.listAudit(TENANT_B)).toEqual([]);
    });

    it('returns no cross-tenant object for a reference that exists only in another tenant', async () => {
      const store = factory();
      openStores.push(store);
      await store.registerNode(
        TENANT_A, manifest([TENANT_A]), nodeClaims(TENANT_A), [TENANT_A], undefined, NOW, 60_000,
      );
      const task = taskClaims(TENANT_A);
      await store.enqueueTask(TENANT_A, { ...task }, task, null, NOW);

      expect(await store.getNode(TENANT_B, NODE, NOW)).toBeNull();
      expect(await store.getTask(TENANT_B, 'task-shared', NOW)).toBeNull();
      expect(await store.listEvents(TENANT_B, 'work-shared')).toEqual([]);
      expect(await store.getApprovalRequest(TENANT_B, 'request-shared')).toBeNull();
      expect(await store.getApprovalDecision(TENANT_B, 'request-shared')).toBeNull();
      expect(await store.listAudit(TENANT_B)).toEqual([]);
      await expect(store.stopTask(TENANT_B, 'task-shared', 'human:operator', NOW))
        .rejects.toMatchObject({ code: 'invalid_transition' });
      expect(await store.getTask(TENANT_A, 'task-shared', NOW)).toMatchObject({ status: 'queued' });
    });
  });
}

describe('Fastify Relay tenant boundary', () => {
  it('rejects an invalid explicit badge tenant set during provisioning', () => {
    expect(() => createStaticBadgeTokenAuthenticator([{
      token: 'invalid-multi-tenant-token', tokenId: 'badge-invalid', tenantId: TENANT_A,
      actorRef: `system:${NODE}`, nodeId: NODE, scopes: ['node.register'],
      expiresAt: '2026-10-07T01:00:00.000Z', authorizedTenantIds: [TENANT_B],
    }])).toThrow('badge authorized tenant set is invalid');
    expect(() => createStaticBadgeTokenAuthenticator([{
      token: 'missing-grant-ref-token', tokenId: 'badge-missing-ref', tenantId: TENANT_A,
      actorRef: `system:${NODE}`, nodeId: NODE, scopes: ['node.register'],
      expiresAt: '2026-10-07T01:00:00.000Z', authorizedTenantIds: [TENANT_A, TENANT_B],
    }])).toThrow('badge authorized tenant set is invalid');
  });

  it('defaults a node badge to one tenant and rejects a manifest that smuggles another tenant', async () => {
    const { store, service } = serviceHarness(new MemoryFleetStore());
    const authenticator = createStaticBadgeTokenAuthenticator([{
      token: 'tenant-a-node-token', tokenId: 'badge-tenant-a', tenantId: TENANT_A,
      actorRef: `system:${NODE}`, nodeId: NODE, scopes: ['node.register'],
      expiresAt: '2026-10-07T01:00:00.000Z',
    }]);
    const entry = createFleetRelayServer(service, { authenticator, now: () => new Date(NOW) });
    openApps.push(entry);

    const response = await entry.app.inject({
      method: 'POST', url: '/v1/nodes/register',
      headers: { authorization: 'Bearer tenant-a-node-token' },
      payload: manifest([TENANT_A, TENANT_B]),
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: 'tenant_mismatch' } });
    expect(response.body).not.toContain(TENANT_B);
    expect(await store.getNode(TENANT_A, NODE, NOW)).toBeNull();
  });

  it('accepts an explicitly granted tenant subset and rejects anything beyond it', async () => {
    const { store, service } = serviceHarness(new MemoryFleetStore());
    const authenticator = createStaticBadgeTokenAuthenticator([{
      token: 'multi-tenant-node-token', tokenId: 'badge-multi-tenant', tenantId: TENANT_A,
      actorRef: `system:${NODE}`, nodeId: NODE, scopes: ['node.register'],
      expiresAt: '2026-10-07T01:00:00.000Z', authorizedTenantIds: [TENANT_A, TENANT_B],
      grantRef: 'tenant-grant:node-main-ab',
    }]);
    const entry = createFleetRelayServer(service, { authenticator, now: () => new Date(NOW) });
    openApps.push(entry);

    const accepted = await entry.app.inject({
      method: 'POST', url: '/v1/nodes/register',
      headers: { authorization: 'Bearer multi-tenant-node-token' },
      payload: manifest([TENANT_A, TENANT_B]),
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({ node: { tenantId: TENANT_A, tenantIds: [TENANT_A, TENANT_B] } });
    expect(await store.getNode(TENANT_B, NODE, NOW)).toBeNull();

    const denied = await entry.app.inject({
      method: 'POST', url: '/v1/nodes/register',
      headers: { authorization: 'Bearer multi-tenant-node-token' },
      payload: manifest([TENANT_A, TENANT_C]),
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.body).not.toContain(TENANT_C);
    expect(await store.getNode(TENANT_A, NODE, NOW)).toMatchObject({ tenantIds: [TENANT_A, TENANT_B] });
  });
});

describe('[TEN-P0-RELAY-MULTITENANT-GRANT] tenant-scoped CapabilityGrant registry', () => {
  it('isolates identical grant ids and makes wrong-tenant references indistinguishable from unknown ids', () => {
    const registry = new CapabilityGrantRegistry({
      now: () => new Date(NOW),
      tokenFactory: tokenSequence(),
    });
    registry.issue(grantAuthority(TENANT_A), grantInput(TENANT_A));
    registry.issue(grantAuthority(TENANT_B), grantInput(TENANT_B));

    expect(registry.get(TENANT_A, 'grant-shared')).toMatchObject({ tenantId: TENANT_A, status: 'active' });
    expect(registry.get(TENANT_B, 'grant-shared')).toMatchObject({ tenantId: TENANT_B, status: 'active' });
    expect(registry.get(TENANT_C, 'grant-shared')).toBeNull();
    expect(registry.get(TENANT_C, 'missing')).toBeNull();
    expect(registry.list(TENANT_A)).toEqual([
      expect.objectContaining({ tenantId: TENANT_A, grantId: 'grant-shared' }),
    ]);
    expect(registry.list(TENANT_C)).toEqual([]);
    expect(registry.snapshot(TENANT_A)).toEqual([
      expect.objectContaining({ tenantId: TENANT_A, grantId: 'grant-shared' }),
    ]);
    expect(registry.snapshot(TENANT_C)).toEqual([]);

    const revokeError = (tenantId: string, grantId: string): CapabilityGrantError => {
      try {
        registry.revoke(tenantId, grantId);
        throw new Error('expected revoke to fail');
      } catch (error) {
        expect(error).toBeInstanceOf(CapabilityGrantError);
        return error as CapabilityGrantError;
      }
    };
    const wrongTenantRevoke = revokeError(TENANT_C, 'grant-shared');
    const unknownRevoke = revokeError(TENANT_C, 'missing');
    expect({ code: wrongTenantRevoke.code, message: wrongTenantRevoke.message })
      .toEqual({ code: unknownRevoke.code, message: unknownRevoke.message });

    const rotateError = (tenantId: string, grantId: string): CapabilityGrantError => {
      try {
        registry.rotate(tenantId, grantId, grantInput(tenantId, 'replacement'));
        throw new Error('expected rotate to fail');
      } catch (error) {
        expect(error).toBeInstanceOf(CapabilityGrantError);
        return error as CapabilityGrantError;
      }
    };
    const wrongTenantRotate = rotateError(TENANT_C, 'grant-shared');
    const unknownRotate = rotateError(TENANT_C, 'missing');
    expect({ code: wrongTenantRotate.code, message: wrongTenantRotate.message })
      .toEqual({ code: unknownRotate.code, message: unknownRotate.message });

    registry.revoke(TENANT_B, 'grant-shared');
    expect(registry.get(TENANT_B, 'grant-shared')).toMatchObject({ status: 'revoked' });
    expect(registry.get(TENANT_A, 'grant-shared')).toMatchObject({ status: 'active' });
  });

  it('exports and restores one tenant snapshot at a time', () => {
    const registry = new CapabilityGrantRegistry({
      now: () => new Date(NOW),
      tokenFactory: tokenSequence(),
    });
    registry.issue(grantAuthority(TENANT_A), grantInput(TENANT_A));
    registry.issue(grantAuthority(TENANT_B), grantInput(TENANT_B));
    const snapshotA = registry.snapshot(TENANT_A);
    const snapshotB = registry.snapshot(TENANT_B);

    const restoredA = new CapabilityGrantRegistry({
      now: () => new Date(NOW), initialTenantId: TENANT_A, initialRecords: snapshotA,
    });
    expect(restoredA.get(TENANT_A, 'grant-shared')).toMatchObject({ tenantId: TENANT_A });
    expect(restoredA.get(TENANT_B, 'grant-shared')).toBeNull();
    expect(() => new CapabilityGrantRegistry({
      initialTenantId: TENANT_A, initialRecords: snapshotB,
    })).toThrowError(expect.objectContaining({ code: 'invalid_grant' }));
    expect(() => new CapabilityGrantRegistry({
      initialRecords: snapshotA,
    })).toThrowError(expect.objectContaining({ code: 'invalid_grant' }));
  });
});
