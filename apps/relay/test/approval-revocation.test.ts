import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createStaticBadgeTokenAuthenticator, type BadgeScope } from '../src/badge-auth.js';
import { createSharedFleetValidators } from '../src/contract-adapter.js';
import { FleetService } from '../src/fleet-service.js';
import { createFleetRelayServer, type FleetSseBroker } from '../src/fastify-transport.js';
import { MemoryFleetStore } from '../src/memory-store.js';
import type { FleetStore } from '../src/ports.js';
import { SqliteFleetStore } from '../src/sqlite-store.js';

const NOW = '2026-10-07T00:00:00.000Z';
const TENANT = 'tenant-a';
const NODE = 'node-a';

const manifest = {
  schema: 'hummer.node-manifest', version: 1, nodeId: NODE, tenantIds: [TENANT],
  platform: 'win32', agentVersion: '0.1.0',
  runtimes: [{ kind: 'codex', available: true, pinnedVersion: '0.153.4' }],
  capabilities: ['workspace.exec'],
  mcp: { endpoint: 'stdio://hummer-local', tools: ['workspace_exec'] },
  load: { running: 0, queued: 0 },
};

const envelope = {
  schema: 'hummer.task-envelope', version: 1,
  workOrderTask: { schema: 'hummer.work-order-task', version: 1, title: 'Revocable task', target: 'Run', expectedDeliverable: 'outputs/result.md' },
  tenantId: TENANT, targetNodeId: NODE, targetRuntime: 'codex', idempotencyKey: 'delivery-revoke', leaseMs: 3_600_000,
  approvalPolicyRef: 'policy-deny-by-default', expiresAt: '2026-10-07T02:00:00Z', originRef: 'work-revoke',
};

const request = {
  schema: 'hummer.approval-request', version: 1, requestId: 'request-revoke', tenantId: TENANT,
  workOrderId: 'work-revoke', nodeId: NODE, runId: 'run-revoke', riskClass: 'write', action: 'task.execute',
  target: 'delivery-revoke', redactedPreview: 'Run revocable task',
  requestedScope: { capabilities: ['task.execute'], paths: ['outputs/result.md'], maxUses: 1 },
  expiresAt: '2026-10-07T01:00:00Z', requestedBy: `system:${NODE}`,
};

const decision = {
  schema: 'hummer.approval-decision', version: 1, decisionId: 'decision-revoke', requestId: 'request-revoke', tenantId: TENANT,
  deciderActorRef: 'human:operator', decidedAt: NOW, decision: 'approved' as const,
  grantedScope: { capabilities: ['task.execute'], paths: ['outputs/result.md'], maxUses: 1, expiresAt: '2026-10-07T00:30:00Z' },
};

const started = {
  schema: 'hummer.run-event', version: 1, eventId: 'event-started', tenantId: TENANT, workOrderId: 'work-revoke', nodeId: NODE,
  seq: 1, occurredAt: NOW, actorRef: 'employee:worker', idempotencyKey: 'event-started-key', type: 'started' as const,
  payload: { runId: 'run-revoke' },
};

const artifact = {
  schema: 'hummer.run-event', version: 1, eventId: 'event-artifact', tenantId: TENANT, workOrderId: 'work-revoke', nodeId: NODE,
  seq: 2, occurredAt: NOW, actorRef: 'employee:worker', idempotencyKey: 'event-artifact-key', type: 'artifact' as const,
  payload: { artifactId: 'artifact-1', sha256: 'a'.repeat(64), bytes: 1, relPath: 'outputs/result.md' },
};

async function approvedStore(store: FleetStore): Promise<void> {
  await store.registerNode(TENANT, manifest, { nodeId: NODE, tenantIds: [TENANT], agentVersion: '0.1.0' }, [TENANT], undefined, NOW, 60_000);
  await store.enqueueTask(TENANT, envelope, {
    taskId: 'delivery-revoke', workOrderId: 'work-revoke', tenantId: TENANT, targetNodeId: NODE, targetRuntime: 'codex',
    idempotencyKey: 'delivery-revoke', leaseMs: 3_600_000, expiresAt: '2026-10-07T02:00:00Z', originRef: 'work-revoke',
  }, null, NOW);
  await store.claimTask(TENANT, NODE, NOW);
  await store.putApprovalRequest(TENANT, 'delivery-revoke', request, {
    requestId: 'request-revoke', tenantId: TENANT, workOrderId: 'work-revoke', nodeId: NODE, runId: 'run-revoke',
    riskClass: 'write', action: 'task.execute', target: 'delivery-revoke',
    requestedScope: { capabilities: ['task.execute'], paths: ['outputs/result.md'], maxUses: 1 },
    expiresAt: '2026-10-07T01:00:00Z', requestedBy: `system:${NODE}`,
  }, NOW);
  await store.putApprovalDecision(TENANT, decision, {
    decisionId: 'decision-revoke', requestId: 'request-revoke', tenantId: TENANT, deciderActorRef: 'human:operator',
    decidedAt: NOW, decision: 'approved',
    grantedScope: { capabilities: ['task.execute'], paths: ['outputs/result.md'], maxUses: 1, expiresAt: '2026-10-07T00:30:00Z' },
  }, NOW);
}

describe.each([
  ['memory', () => new MemoryFleetStore()],
  ['sqlite', () => new SqliteFleetStore(':memory:')],
] as const)('%s approval authorization revocation', (_name, createStore) => {
  it('atomically revokes an approved active task and rejects replay and late events', async () => {
    const store = createStore();
    await approvedStore(store);
    expect(await store.getApprovalAuthorization(TENANT, NODE, 'delivery-revoke', 'request-revoke', NOW)).toMatchObject({ state: 'approved' });
    await store.consumeApprovalDecision(TENANT, NODE, 'delivery-revoke', 'request-revoke', NOW);
    await store.putEvent(TENANT, started, {
      eventId: 'event-started', tenantId: TENANT, workOrderId: 'work-revoke', nodeId: NODE, seq: 1, occurredAt: NOW,
      type: 'started', idempotencyKey: 'event-started-key',
    }, NOW);

    const revocation = await store.revokeApprovalAuthorization(TENANT, 'request-revoke', 'human:operator', NOW);
    expect(revocation).toEqual({ tenantId: TENANT, requestId: 'request-revoke', actorRef: 'human:operator', revokedAt: NOW, reasonCode: 'operator_revoked' });
    expect(await store.getApprovalAuthorization(TENANT, NODE, 'delivery-revoke', 'request-revoke', NOW)).toMatchObject({ state: 'revoked', revokedAt: NOW });
    expect(await store.getTask(TENANT, 'delivery-revoke', NOW)).toMatchObject({ status: 'failed', leaseOwnerNodeId: null, leaseExpiresAt: null });
    await expect(store.revokeApprovalAuthorization(TENANT, 'request-revoke', 'human:operator', NOW)).rejects.toMatchObject({ code: 'approval_replayed' });
    await expect(store.putEvent(TENANT, artifact, {
      eventId: 'event-artifact', tenantId: TENANT, workOrderId: 'work-revoke', nodeId: NODE, seq: 2, occurredAt: NOW,
      type: 'artifact', idempotencyKey: 'event-artifact-key',
    }, NOW)).rejects.toMatchObject({ code: 'invalid_transition' });
    await expect(store.putEvent(TENANT, { ...artifact, eventId: 'event-completed', idempotencyKey: 'event-completed-key', type: 'completed', payload: { summary: 'late' } }, {
      eventId: 'event-completed', tenantId: TENANT, workOrderId: 'work-revoke', nodeId: NODE, seq: 2, occurredAt: NOW,
      type: 'completed', idempotencyKey: 'event-completed-key',
    }, NOW)).rejects.toMatchObject({ code: 'invalid_transition' });
    await expect(store.consumeApprovalDecision(TENANT, NODE, 'delivery-revoke', 'request-revoke', NOW)).rejects.toMatchObject({ code: 'approval_replayed' });
    expect((await store.listTenantAudit(TENANT)).filter((entry) => entry.action === 'approval.revoked')).toHaveLength(1);
    await expect(store.getApprovalAuthorization('tenant-b', NODE, 'delivery-revoke', 'request-revoke', NOW)).rejects.toMatchObject({ code: 'approval_not_found' });
    await expect(store.getApprovalAuthorization(TENANT, 'node-b', 'delivery-revoke', 'request-revoke', NOW)).rejects.toMatchObject({ code: 'lease_owner_mismatch' });
    store.close();
  });

  it('fails closed when completion wins the atomic terminal-state race', async () => {
    const store = createStore();
    await approvedStore(store);
    await store.putEvent(TENANT, started, {
      eventId: 'event-started', tenantId: TENANT, workOrderId: 'work-revoke', nodeId: NODE, seq: 1, occurredAt: NOW,
      type: 'started', idempotencyKey: 'event-started-key',
    }, NOW);
    await store.putEvent(TENANT, artifact, {
      eventId: 'event-artifact', tenantId: TENANT, workOrderId: 'work-revoke', nodeId: NODE, seq: 2, occurredAt: NOW,
      type: 'artifact', idempotencyKey: 'event-artifact-key',
    }, NOW);
    await store.putEvent(TENANT, { ...artifact, eventId: 'event-completed', idempotencyKey: 'event-completed-key', seq: 3, type: 'completed', payload: { summary: 'done' } }, {
      eventId: 'event-completed', tenantId: TENANT, workOrderId: 'work-revoke', nodeId: NODE, seq: 3, occurredAt: NOW,
      type: 'completed', idempotencyKey: 'event-completed-key',
    }, NOW);
    await expect(store.revokeApprovalAuthorization(TENANT, 'request-revoke', 'human:operator', NOW)).rejects.toMatchObject({ code: 'invalid_transition' });
    expect(await store.getApprovalRevocation(TENANT, 'request-revoke')).toBeNull();
    store.close();
  });

  it('reports expiry without rewriting the immutable decision', async () => {
    const store = createStore();
    await approvedStore(store);
    expect(await store.getApprovalAuthorization(TENANT, NODE, 'delivery-revoke', 'request-revoke', '2026-10-07T00:31:00.000Z'))
      .toMatchObject({ state: 'expired', expiresAt: '2026-10-07T00:30:00Z' });
    expect(await store.getApprovalDecision(TENANT, 'request-revoke')).toMatchObject({ decisionId: 'decision-revoke', decision: 'approved' });
    store.close();
  });
});

function badge(token: string, nodeId: string | undefined, scopes: readonly BadgeScope[]) {
  return {
    token, tokenId: `badge-${token}`, tenantId: TENANT, actorRef: nodeId ? `system:${nodeId}` : 'human:operator',
    nodeId, scopes, expiresAt: '2099-01-01T00:00:00Z',
  };
}

const openApps: Array<{ app: FastifyInstance; events: FleetSseBroker }> = [];
afterEach(async () => {
  for (const entry of openApps.splice(0)) {
    entry.events.close();
    await entry.app.close();
  }
});

it('serves authorization query and tenant/node-scoped approval.revoked SSE over real Fastify', async () => {
  const store = new MemoryFleetStore();
  const service = new FleetService(store, createSharedFleetValidators(), { now: () => new Date(NOW) });
  const authenticator = createStaticBadgeTokenAuthenticator([
    badge('node-token', NODE, ['node.register', 'task.claim', 'task.event', 'approval.request', 'approval.consume', 'stream.connect']),
    badge('control-token', undefined, ['task.enqueue', 'approval.decide', 'approval.read']),
  ]);
  const entry = createFleetRelayServer(service, { authenticator, now: () => new Date(NOW) });
  openApps.push(entry);
  await entry.app.inject({ method: 'POST', url: '/v1/nodes/register', headers: { authorization: 'Bearer node-token' }, payload: manifest });
  await entry.app.inject({ method: 'POST', url: '/v1/tasks/enqueue', headers: { authorization: 'Bearer control-token' }, payload: envelope });
  await entry.app.inject({ method: 'POST', url: `/v1/nodes/${NODE}/tasks/claim`, headers: { authorization: 'Bearer node-token' } });
  await entry.app.inject({ method: 'POST', url: `/v1/nodes/${NODE}/tasks/delivery-revoke/approval-requests`, headers: { authorization: 'Bearer node-token' }, payload: request });
  await entry.app.inject({ method: 'POST', url: '/v1/approval-requests/request-revoke/decision', headers: { authorization: 'Bearer control-token' }, payload: decision });

  const before = await entry.app.inject({
    method: 'GET', url: `/v1/nodes/${NODE}/tasks/delivery-revoke/approval-requests/request-revoke/authorization`,
    headers: { authorization: 'Bearer node-token' },
  });
  expect(before.statusCode).toBe(200);
  expect(before.json()).toMatchObject({ authorization: { state: 'approved', requestId: 'request-revoke', taskId: 'delivery-revoke', nodeId: NODE } });

  const address = await entry.app.listen({ host: '127.0.0.1', port: 0 });
  const controller = new AbortController();
  const stream = await fetch(`${address}/v1/nodes/${NODE}/events`, {
    headers: { authorization: 'Bearer node-token' }, signal: controller.signal,
  });
  const reader = stream.body!.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toContain('connected');

  const revoked = await entry.app.inject({
    method: 'POST', url: '/v1/approval-requests/request-revoke/revoke', headers: { authorization: 'Bearer control-token' }, payload: {},
  });
  expect(revoked.statusCode).toBe(200);
  expect(revoked.json()).toEqual({ revocation: { tenantId: TENANT, requestId: 'request-revoke', actorRef: 'human:operator', revokedAt: NOW, reasonCode: 'operator_revoked' } });
  const frame = new TextDecoder().decode((await reader.read()).value);
  expect(frame).toContain('event: approval.revoked');
  expect(frame).toContain('"taskId":"delivery-revoke"');
  expect(frame).toContain('"requestId":"request-revoke"');
  controller.abort();

  const after = await entry.app.inject({
    method: 'GET', url: `/v1/nodes/${NODE}/tasks/delivery-revoke/approval-requests/request-revoke/authorization`,
    headers: { authorization: 'Bearer node-token' },
  });
  expect(after.json()).toMatchObject({ authorization: { state: 'revoked', revokedAt: NOW } });
  const projection = await entry.app.inject({ method: 'GET', url: '/v1/control/approval-requests/request-revoke', headers: { authorization: 'Bearer control-token' } });
  expect(projection.json()).toMatchObject({ approvalRequest: { decision: { decision: 'approved' }, revocation: { reasonCode: 'operator_revoked' }, authorization: { state: 'revoked' } } });
  expect((await entry.app.inject({ method: 'POST', url: '/v1/approval-requests/request-revoke/revoke', headers: { authorization: 'Bearer control-token' }, payload: { force: true } })).statusCode).toBe(400);
});
