import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createStaticBadgeTokenAuthenticator, type BadgeScope } from '../src/badge-auth.js';
import { createSharedFleetValidators } from '../src/contract-adapter.js';
import { FleetService } from '../src/fleet-service.js';
import { createFleetRelayServer, type FleetSseBroker } from '../src/fastify-transport.js';
import { MemoryFleetStore } from '../src/memory-store.js';

const NOW = '2026-10-07T00:00:00.000Z';
const TENANT = 'tenant-a';
const NODE = 'node-main';
const NODE_SCOPES = ['node.register', 'node.heartbeat', 'task.claim', 'task.event', 'stream.connect'] as const;

const manifest = (nodeId = NODE, tenantIds = [TENANT]) => ({
  schema: 'hummer.node-manifest', version: 1, nodeId, tenantIds,
  platform: 'win32', agentVersion: '0.1.0',
  runtimes: [{ kind: 'codex', available: true, pinnedVersion: '0.153.4' }],
  capabilities: ['workspace.exec'],
  mcp: { endpoint: 'stdio://hummer-local', tools: ['workspace_exec'] },
  load: { running: 0, queued: 0 },
});

const envelope = (index = 1, overrides: Record<string, unknown> = {}) => ({
  schema: 'hummer.task-envelope', version: 1,
  workOrderTask: {
    schema: 'hummer.work-order-task', version: 1,
    title: `Task ${index}`, target: 'Prepare a report', expectedDeliverable: 'outputs/report.md',
  },
  tenantId: TENANT, targetNodeId: NODE, targetRuntime: 'codex',
  idempotencyKey: `delivery-${index}`, leaseMs: 30_000,
  approvalPolicyRef: 'policy-deny-by-default', expiresAt: '2026-10-07T01:00:00Z',
  originRef: `work-${index}`,
  ...overrides,
});

const runEvent = (
  index: number,
  seq: number,
  type: 'started' | 'artifact' | 'completed' | 'failed',
  overrides: Record<string, unknown> = {},
) => ({
  schema: 'hummer.run-event', version: 1, eventId: `event-${index}-${seq}`,
  tenantId: TENANT, workOrderId: `work-${index}`, nodeId: NODE, seq,
  occurredAt: NOW, actorRef: 'employee:worker', idempotencyKey: `event-key-${index}-${seq}`,
  type,
  payload: type === 'started' ? { runId: `run-${index}` }
    : type === 'artifact' ? { artifactId: `artifact-${index}`, sha256: 'a'.repeat(64), bytes: 12, relPath: 'outputs/report.md' }
      : type === 'failed' ? { code: 'runtime_error', message: 'safe failure', retryable: false }
        : { summary: 'done' },
  ...overrides,
});

function badge(token: string, tenantId: string, nodeId: string | undefined, scopes: readonly BadgeScope[], expiresAt = '2026-10-07T01:00:00Z') {
  return { token, tokenId: `badge-${token}`, tenantId, actorRef: nodeId ? `system:${nodeId}` : 'human:operator', nodeId, scopes, expiresAt };
}

function authorization(token: string) {
  return { authorization: `Bearer ${token}` };
}

function harness() {
  const store = new MemoryFleetStore();
  const service = new FleetService(store, createSharedFleetValidators(), { now: () => new Date(NOW) });
  const authenticator = createStaticBadgeTokenAuthenticator([
    badge('node-token', TENANT, NODE, NODE_SCOPES),
    badge('node-b-token', TENANT, 'node-b', NODE_SCOPES),
    badge('control-token', TENANT, undefined, ['task.enqueue', 'task.stop']),
    badge('tenant-b-token', 'tenant-b', undefined, ['task.enqueue', 'task.stop']),
    badge('claim-only-token', TENANT, NODE, ['task.claim']),
    badge('expired-token', TENANT, NODE, NODE_SCOPES, '2026-10-06T23:59:59Z'),
  ]);
  const result = createFleetRelayServer(service, { authenticator, now: () => new Date(NOW) });
  return { ...result, store, service };
}

const openApps: Array<{ app: FastifyInstance; events: FleetSseBroker }> = [];
afterEach(async () => {
  for (const entry of openApps.splice(0)) {
    entry.events.close();
    await entry.app.close();
  }
});

async function register(app: FastifyInstance) {
  return app.inject({ method: 'POST', url: '/v1/nodes/register', headers: authorization('node-token'), payload: manifest() });
}

async function enqueue(app: FastifyInstance, payload = envelope()) {
  return app.inject({ method: 'POST', url: '/v1/tasks/enqueue', headers: authorization('control-token'), payload });
}

describe('Fastify fleet relay transport', () => {
  it('serves register, enqueue, claim, ack, event, complete and stop through authenticated HTTP', async () => {
    const { app, events } = harness();
    openApps.push({ app, events });
    expect((await register(app)).statusCode).toBe(200);
    expect((await enqueue(app)).statusCode).toBe(200);

    const claimed = await app.inject({ method: 'POST', url: `/v1/nodes/${NODE}/tasks/claim`, headers: authorization('node-token') });
    expect(claimed.statusCode).toBe(200);
    expect(claimed.json()).toMatchObject({ task: { taskId: 'delivery-1', tenantId: TENANT, leaseOwnerNodeId: NODE } });

    expect((await app.inject({ method: 'POST', url: '/v1/tasks/ack', headers: authorization('node-token'), payload: runEvent(1, 1, 'started') })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/v1/tasks/events', headers: authorization('node-token'), payload: runEvent(1, 2, 'artifact') })).statusCode).toBe(200);
    const completed = await app.inject({ method: 'POST', url: '/v1/tasks/complete', headers: authorization('node-token'), payload: runEvent(1, 3, 'completed') });
    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toMatchObject({ task: { status: 'completed' } });

    expect((await enqueue(app, envelope(2))).statusCode).toBe(200);
    const stopped = await app.inject({ method: 'POST', url: '/v1/tasks/delivery-2/stop', headers: authorization('control-token') });
    expect(stopped.statusCode).toBe(200);
    expect(stopped.json()).toMatchObject({ task: { status: 'blocked' } });
  });

  it('rejects missing, wrong, expired and under-scoped badge tokens', async () => {
    const { app, events } = harness();
    openApps.push({ app, events });
    expect((await app.inject({ method: 'POST', url: `/v1/nodes/${NODE}/tasks/claim` })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: `/v1/nodes/${NODE}/tasks/claim`, headers: authorization('wrong-token') })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: `/v1/nodes/${NODE}/tasks/claim`, headers: authorization('expired-token') })).statusCode).toBe(401);
    const denied = await app.inject({ method: 'POST', url: '/v1/nodes/register', headers: authorization('claim-only-token'), payload: manifest() });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error: { code: 'scope_denied' } });
  });

  it('fails closed on cross-tenant access and node binding mismatches', async () => {
    const { app, events, store } = harness();
    openApps.push({ app, events });
    await register(app);
    await enqueue(app);

    const crossTenant = await app.inject({
      method: 'POST', url: '/v1/tasks/delivery-1/stop', headers: authorization('tenant-b-token'),
    });
    expect(crossTenant.statusCode).toBe(409);
    expect(await store.getTask(TENANT, 'delivery-1', NOW)).toMatchObject({ status: 'queued' });

    const wrongPath = await app.inject({
      method: 'POST', url: `/v1/nodes/${NODE}/tasks/claim`, headers: authorization('node-b-token'),
    });
    expect(wrongPath.statusCode).toBe(403);
    expect(wrongPath.json()).toMatchObject({ error: { code: 'node_mismatch' } });

    const wrongEvent = await app.inject({
      method: 'POST', url: '/v1/tasks/ack', headers: authorization('node-token'),
      payload: runEvent(1, 1, 'started', { nodeId: 'node-b' }),
    });
    expect(wrongEvent.statusCode).toBe(403);
  });

  it('rejects unknown contract and command fields before state changes', async () => {
    const { app, events, store } = harness();
    openApps.push({ app, events });
    await register(app);
    const unknownEnvelope = await enqueue(app, envelope(1, { autoApprove: true }));
    expect(unknownEnvelope.statusCode).toBe(400);
    expect(unknownEnvelope.json()).toMatchObject({ error: { code: 'invalid_contract' } });
    expect(await store.getTask(TENANT, 'delivery-1', NOW)).toBeNull();

    const unknownClaim = await app.inject({
      method: 'POST', url: `/v1/nodes/${NODE}/tasks/claim`, headers: authorization('node-token'), payload: { force: true },
    });
    expect(unknownClaim.statusCode).toBe(400);
    expect(unknownClaim.json()).toMatchObject({ error: { code: 'invalid_contract' } });
  });

  it('requires fresh authorization after an SSE disconnect and never widens node scope', async () => {
    const entry = harness();
    openApps.push({ app: entry.app, events: entry.events });
    const address = await entry.app.listen({ host: '127.0.0.1', port: 0 });
    const controller = new AbortController();
    const response = await fetch(`${address}/v1/nodes/${NODE}/events`, {
      headers: authorization('node-token'), signal: controller.signal,
    });
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('connected');
    entry.events.publish(TENANT, NODE, 'task.stop', { taskId: 'delivery-1' });
    const streamed = new TextDecoder().decode((await reader.read()).value);
    expect(streamed).toContain('event: task.stop');
    expect(streamed).toContain('delivery-1');
    controller.abort();
    await reader.cancel().catch(() => undefined);
    await new Promise<void>((resolve) => setImmediate(resolve));

    const crossNodeReconnect = await fetch(`${address}/v1/nodes/${NODE}/events`, {
      headers: authorization('node-b-token'),
    });
    expect(crossNodeReconnect.status).toBe(403);
    expect(await crossNodeReconnect.json()).toMatchObject({ error: { code: 'node_mismatch' } });

    const unauthenticatedReconnect = await fetch(`${address}/v1/nodes/${NODE}/events`, {
      headers: authorization('wrong-token'),
    });
    expect(unauthenticatedReconnect.status).toBe(401);
    expect(() => entry.events.publish(TENANT, NODE, 'task.stop', { taskId: 'delivery-1' })).not.toThrow();
  });
});
