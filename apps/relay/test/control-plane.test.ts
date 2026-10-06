import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createStaticBadgeTokenAuthenticator, type BadgeScope } from '../src/badge-auth.js';
import { createSharedFleetValidators } from '../src/contract-adapter.js';
import { createFleetRelayServer, type FleetSseBroker } from '../src/fastify-transport.js';
import { FleetService } from '../src/fleet-service.js';
import { MemoryFleetStore } from '../src/memory-store.js';
import type { ApprovalRequestClaims, FleetStore, NodeClaims, TaskClaims } from '../src/ports.js';
import { SqliteFleetStore } from '../src/sqlite-store.js';

const NOW = '2026-10-07T00:00:00.000Z';
const stores = [
  ['Memory', () => new MemoryFleetStore()],
  ['SQLite', () => new SqliteFleetStore(':memory:')],
] as const;

function nodeClaims(tenantId: string): NodeClaims {
  return { nodeId: `node-${tenantId}`, tenantIds: [tenantId], agentVersion: '1.0.0' };
}

function taskClaims(tenantId: string): TaskClaims {
  return {
    taskId: `task-${tenantId}`,
    workOrderId: `work-${tenantId}`,
    tenantId,
    targetNodeId: `node-${tenantId}`,
    targetRuntime: 'codex',
    idempotencyKey: `delivery-${tenantId}`,
    leaseMs: 30_000,
    expiresAt: '2026-10-07T01:00:00.000Z',
    originRef: `origin-${tenantId}`,
  };
}

function approvalClaims(tenantId: string): ApprovalRequestClaims {
  return {
    requestId: `approval-${tenantId}`,
    tenantId,
    workOrderId: `work-${tenantId}`,
    nodeId: `node-${tenantId}`,
    runId: `run-${tenantId}`,
    riskClass: 'write',
    action: 'task.execute',
    target: `task-${tenantId}`,
    requestedScope: { capabilities: ['task.execute'], maxUses: 1 },
    expiresAt: '2026-10-07T01:00:00.000Z',
    requestedBy: `system:node-${tenantId}`,
  };
}

async function seedTenant(store: FleetStore, tenantId: string): Promise<void> {
  const node = nodeClaims(tenantId);
  await store.registerNode(tenantId, { nodeId: node.nodeId, capabilities: ['workspace.exec'] }, node, [tenantId], undefined, NOW, 60_000);
  const task = taskClaims(tenantId);
  await store.enqueueTask(tenantId, { tenantId, taskId: task.taskId }, task, null, NOW);
  await store.claimTask(tenantId, node.nodeId, NOW);
  const approval = approvalClaims(tenantId);
  await store.putApprovalRequest(tenantId, task.taskId, { requestId: approval.requestId }, approval, NOW);
}

describe.each(stores)('%s control-plane store contract', (_name, createStore) => {
  it('lists and gets only tenant-qualified nodes, tasks, and approval requests', async () => {
    const store = createStore();
    try {
      await seedTenant(store, 'tenant-a');
      await seedTenant(store, 'tenant-b');

      expect((await store.listNodes('tenant-a', NOW)).map((entry) => entry.nodeId)).toEqual(['node-tenant-a']);
      expect((await store.listTasks('tenant-a', NOW)).map((entry) => entry.taskId)).toEqual(['task-tenant-a']);
      expect((await store.listApprovalRequests('tenant-a')).map((entry) => entry.requestId)).toEqual(['approval-tenant-a']);
      expect(await store.getNode('tenant-a', 'node-tenant-b', NOW)).toBeNull();
      expect(await store.getTask('tenant-a', 'task-tenant-b', NOW)).toBeNull();
      expect(await store.getApprovalRequest('tenant-a', 'approval-tenant-b')).toBeNull();
    } finally {
      store.close();
    }
  });
});

const openApps: Array<{ app: FastifyInstance; events: FleetSseBroker; store: FleetStore }> = [];
afterEach(async () => {
  for (const entry of openApps.splice(0)) {
    entry.events.close();
    await entry.app.close();
    entry.store.close();
  }
});

function badge(token: string, tenantId: string, scopes: readonly BadgeScope[]) {
  return {
    token,
    tokenId: `badge-${token}`,
    tenantId,
    actorRef: 'human:operator',
    scopes,
    expiresAt: '2026-10-07T01:00:00.000Z',
  };
}

describe.each(stores)('%s Fastify read-only control plane', (_name, createStore) => {
  it('derives tenant from the badge and makes foreign and unknown ids indistinguishable', async () => {
    const store = createStore();
    await seedTenant(store, 'tenant-a');
    await seedTenant(store, 'tenant-b');
    const scopes = ['node.read', 'task.read', 'approval.read'] as const;
    const service = new FleetService(store, createSharedFleetValidators(), { now: () => new Date(NOW) });
    const entry = createFleetRelayServer(service, {
      now: () => new Date(NOW),
      authenticator: createStaticBadgeTokenAuthenticator([
        badge('tenant-a-read', 'tenant-a', scopes),
        badge('tenant-b-read', 'tenant-b', scopes),
        badge('tenant-a-node-only', 'tenant-a', ['node.read']),
      ]),
    });
    openApps.push({ ...entry, store });
    const headers = { authorization: 'Bearer tenant-a-read' };

    expect((await entry.app.inject({ method: 'GET', url: '/v1/control/nodes', headers })).json())
      .toMatchObject({ nodes: [{ nodeId: 'node-tenant-a', tenantId: 'tenant-a' }] });
    expect((await entry.app.inject({ method: 'GET', url: '/v1/control/tasks', headers })).json())
      .toMatchObject({ tasks: [{ taskId: 'task-tenant-a', tenantId: 'tenant-a' }] });
    expect((await entry.app.inject({ method: 'GET', url: '/v1/control/approval-requests', headers })).json())
      .toMatchObject({ approvalRequests: [{ requestId: 'approval-tenant-a', tenantId: 'tenant-a' }] });
    expect((await entry.app.inject({ method: 'GET', url: '/v1/control/nodes/node-tenant-a', headers })).json())
      .toMatchObject({ node: { nodeId: 'node-tenant-a', tenantId: 'tenant-a' } });
    expect((await entry.app.inject({ method: 'GET', url: '/v1/control/tasks/task-tenant-a', headers })).json())
      .toMatchObject({ task: { taskId: 'task-tenant-a', tenantId: 'tenant-a' } });
    expect((await entry.app.inject({ method: 'GET', url: '/v1/control/approval-requests/approval-tenant-a', headers })).json())
      .toMatchObject({ approvalRequest: { requestId: 'approval-tenant-a', tenantId: 'tenant-a' } });

    for (const [resource, foreign, unknown] of [
      ['nodes', 'node-tenant-b', 'node-missing'],
      ['tasks', 'task-tenant-b', 'task-missing'],
      ['approval-requests', 'approval-tenant-b', 'approval-missing'],
    ] as const) {
      const foreignResponse = await entry.app.inject({ method: 'GET', url: `/v1/control/${resource}/${foreign}`, headers });
      const unknownResponse = await entry.app.inject({ method: 'GET', url: `/v1/control/${resource}/${unknown}`, headers });
      expect(foreignResponse.statusCode).toBe(404);
      expect(unknownResponse.statusCode).toBe(404);
      expect(foreignResponse.json()).toEqual(unknownResponse.json());
      expect(foreignResponse.json()).toEqual({
        error: { code: 'control_resource_not_found', message: 'control-plane resource was not found' },
      });
    }

    const override = await entry.app.inject({
      method: 'GET',
      url: '/v1/control/nodes?tenantId=tenant-b',
      headers,
    });
    expect(override.statusCode).toBe(400);
    expect(JSON.stringify(override.json())).not.toContain('node-tenant-b');

    const underScoped = await entry.app.inject({
      method: 'GET',
      url: '/v1/control/tasks',
      headers: { authorization: 'Bearer tenant-a-node-only' },
    });
    expect(underScoped.statusCode).toBe(403);
  });
});
