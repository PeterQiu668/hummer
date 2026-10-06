import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { createStaticBadgeTokenAuthenticator, type BadgeScope } from '../src/badge-auth.js';
import { createSharedFleetValidators } from '../src/contract-adapter.js';
import { FleetService } from '../src/fleet-service.js';
import { createFleetRelayServer, type FleetSseBroker } from '../src/fastify-transport.js';
import { MemoryFleetStore } from '../src/memory-store.js';
import { FleetRejectedError, type FleetStore } from '../src/ports.js';
import { SqliteFleetStore } from '../src/sqlite-store.js';

const NOW = '2026-10-07T00:00:00.000Z';
const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const NODE = 'node-shared';
const ALL_NODE_SCOPES = [
  'node.register', 'task.claim', 'task.event', 'stream.connect',
  'approval.request', 'approval.consume',
] as const satisfies readonly BadgeScope[];

const session = (tenantId: string) => ({
  tenantId,
  actorRef: `system:${NODE}`,
  nodeId: NODE,
});

const manifest = (tenantId: string) => ({
  schema: 'hummer.node-manifest', version: 1, nodeId: NODE, tenantIds: [tenantId],
  platform: 'win32', agentVersion: '0.1.0',
  runtimes: [{ kind: 'codex', available: true, pinnedVersion: '0.153.4' }],
  capabilities: ['workspace.exec'],
  mcp: { endpoint: 'stdio://hummer-local', tools: ['workspace_exec'] },
  load: { running: 0, queued: 0 },
});

const envelope = (tenantId: string, id = 'foreign') => ({
  schema: 'hummer.task-envelope', version: 1,
  workOrderTask: {
    schema: 'hummer.work-order-task', version: 1,
    title: `Task ${id}`, target: 'Prepare a report', expectedDeliverable: 'outputs/report.md',
  },
  tenantId, targetNodeId: NODE, targetRuntime: 'codex',
  idempotencyKey: `task-${id}`, leaseMs: 30_000,
  approvalPolicyRef: 'policy-deny-by-default', expiresAt: '2026-10-07T01:00:00Z',
  originRef: `work-${id}`,
});

const runEvent = (tenantId: string, id = 'foreign') => ({
  schema: 'hummer.run-event', version: 1, eventId: `event-${id}`,
  tenantId, workOrderId: `work-${id}`, nodeId: NODE, seq: 1,
  occurredAt: NOW, actorRef: 'employee:worker', idempotencyKey: `event-key-${id}`,
  type: 'started', payload: { runId: `run-${id}` },
});

const approvalRequest = (tenantId: string, id = 'foreign') => ({
  schema: 'hummer.approval-request', version: 1, requestId: `request-${id}`,
  tenantId, workOrderId: `work-${id}`, nodeId: NODE, runId: `run-${id}`,
  riskClass: 'write', action: 'task.execute', target: `task-${id}`,
  redactedPreview: 'Execute the approved synthetic task',
  requestedScope: { capabilities: ['task.execute'], paths: ['outputs/report.md'], maxUses: 1 },
  expiresAt: '2026-10-07T01:00:00Z', requestedBy: `system:${NODE}`,
});

const approvalDecision = (tenantId: string, id = 'foreign') => ({
  schema: 'hummer.approval-decision', version: 1, decisionId: `decision-${id}`,
  requestId: `request-${id}`, tenantId, deciderActorRef: 'human:operator',
  decidedAt: NOW, decision: 'approved',
  grantedScope: {
    capabilities: ['task.execute'], paths: ['outputs/report.md'], maxUses: 1,
    expiresAt: '2026-10-07T00:30:00Z',
  },
});

function badge(
  token: string,
  tenantId: string,
  nodeId: string | undefined,
  scopes: readonly BadgeScope[],
) {
  return {
    token,
    tokenId: `badge-${token}`,
    tenantId,
    actorRef: nodeId ? `system:${nodeId}` : 'human:operator',
    nodeId,
    scopes,
    expiresAt: '2099-01-01T00:00:00.000Z',
  };
}

const authorization = (token: string) => ({ authorization: `Bearer ${token}` });

const openStores: FleetStore[] = [];
const openApps: Array<{ app: FastifyInstance; events: FleetSseBroker }> = [];

afterEach(async () => {
  for (const entry of openApps.splice(0)) {
    entry.events.close();
    await entry.app.close();
  }
  openStores.splice(0).forEach((store) => store.close());
});

function serviceHarness(store: FleetStore) {
  openStores.push(store);
  return {
    store,
    service: new FleetService(store, createSharedFleetValidators(), { now: () => new Date(NOW) }),
  };
}

async function rejected(operation: () => Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await operation();
    throw new Error('expected operation to be rejected');
  } catch (error) {
    expect(error).toBeInstanceOf(FleetRejectedError);
    const rejection = error as FleetRejectedError;
    return { code: rejection.code, message: rejection.message };
  }
}

function httpHarness() {
  const { store, service } = serviceHarness(new MemoryFleetStore());
  const authenticator = createStaticBadgeTokenAuthenticator([
    badge('node-a-token', TENANT_A, NODE, ALL_NODE_SCOPES),
    badge('node-b-token', TENANT_B, NODE, ALL_NODE_SCOPES),
    badge('node-b-other-token', TENANT_B, 'node-other', ALL_NODE_SCOPES),
    badge('control-a-token', TENANT_A, undefined, ['task.enqueue', 'task.stop', 'approval.decide']),
    badge('control-b-token', TENANT_B, undefined, ['task.enqueue', 'task.stop', 'approval.decide']),
  ]);
  const entry = createFleetRelayServer(service, { authenticator, now: () => new Date(NOW) });
  openApps.push(entry);
  return { ...entry, store, service };
}

async function register(app: FastifyInstance, tenantId: string, token: string) {
  return app.inject({
    method: 'POST', url: '/v1/nodes/register', headers: authorization(token), payload: manifest(tenantId),
  });
}

async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  marker: string,
): Promise<string> {
  const decoder = new TextDecoder();
  let output = '';
  for (let reads = 0; reads < 8 && !output.includes(marker); reads += 1) {
    const result = await reader.read();
    if (result.done) break;
    output += decoder.decode(result.value, { stream: true });
  }
  return output;
}

describe('[TEN-P0D-RELAY-SURFACES] Relay tenant surface isolation', () => {
  for (const [name, factory] of [
    ['memory', () => new MemoryFleetStore()],
    ['sqlite', () => new SqliteFleetStore(':memory:')],
  ] as const) {
    it(`${name} keeps queue, event, approval, retry and audit references tenant-opaque`, async () => {
      const { store, service } = serviceHarness(factory());
      await service.register(session(TENANT_A), manifest(TENANT_A));
      await service.register(session(TENANT_B), manifest(TENANT_B));
      await service.enqueue(session(TENANT_A), envelope(TENANT_A));
      await service.claim(session(TENANT_A), NODE);
      await service.event(session(TENANT_A), runEvent(TENANT_A));
      await service.requestApproval(session(TENANT_A), 'task-foreign', approvalRequest(TENANT_A));

      expect(await store.listEvents(TENANT_B, 'work-foreign')).toEqual([]);
      expect(await store.listEvents(TENANT_B, 'work-missing')).toEqual([]);
      expect(await store.getApprovalRequest(TENANT_B, 'request-foreign')).toBeNull();
      expect(await store.getApprovalRequest(TENANT_B, 'request-missing')).toBeNull();
      expect(await store.getApprovalDecision(TENANT_B, 'request-foreign')).toBeNull();
      expect(await store.listAudit(TENANT_B)).toEqual([]);

      expect(await rejected(() => service.stop(session(TENANT_B), 'task-foreign')))
        .toEqual(await rejected(() => service.stop(session(TENANT_B), 'task-missing')));
      expect(await rejected(() => service.retry(session(TENANT_B), 'task-foreign', envelope(TENANT_B, 'retry'))))
        .toEqual(await rejected(() => service.retry(session(TENANT_B), 'task-missing', envelope(TENANT_B, 'retry'))));

      const tenantBTask = await service.enqueue(session(TENANT_B), envelope(TENANT_B));
      expect(tenantBTask).toMatchObject({ inserted: true, task: { tenantId: TENANT_B, taskId: 'task-foreign' } });
      expect(await service.claim(session(TENANT_B), NODE)).toMatchObject({ tenantId: TENANT_B });
      await service.event(session(TENANT_B), runEvent(TENANT_B));
      await service.requestApproval(session(TENANT_B), 'task-foreign', approvalRequest(TENANT_B));
      expect(await store.listEvents(TENANT_A, 'work-foreign')).toEqual([
        expect.objectContaining({ tenantId: TENANT_A, eventId: 'event-foreign' }),
      ]);
      expect(await store.listEvents(TENANT_B, 'work-foreign')).toEqual([
        expect.objectContaining({ tenantId: TENANT_B, eventId: 'event-foreign' }),
      ]);
      expect(await store.getApprovalRequest(TENANT_A, 'request-foreign')).toMatchObject({ tenantId: TENANT_A });
      expect(await store.getApprovalRequest(TENANT_B, 'request-foreign')).toMatchObject({ tenantId: TENANT_B });
    });
  }

  it('returns the same HTTP result for a foreign reference and an unknown local reference', async () => {
    const { app, store } = httpHarness();
    expect((await register(app, TENANT_A, 'node-a-token')).statusCode).toBe(200);
    expect((await register(app, TENANT_B, 'node-b-token')).statusCode).toBe(200);
    expect((await app.inject({
      method: 'POST', url: '/v1/tasks/enqueue', headers: authorization('control-a-token'),
      payload: envelope(TENANT_A),
    })).statusCode).toBe(200);
    expect((await app.inject({
      method: 'POST', url: `/v1/nodes/${NODE}/tasks/claim`, headers: authorization('node-a-token'),
    })).statusCode).toBe(200);
    expect((await app.inject({
      method: 'POST', url: `/v1/nodes/${NODE}/tasks/task-foreign/approval-requests`,
      headers: authorization('node-a-token'), payload: approvalRequest(TENANT_A),
    })).statusCode).toBe(200);

    const compare = async (
      foreign: InjectOptions,
      missing: InjectOptions,
    ) => {
      const foreignResponse = await app.inject(foreign);
      const missingResponse = await app.inject(missing);
      expect({ status: foreignResponse.statusCode, body: foreignResponse.json() })
        .toEqual({ status: missingResponse.statusCode, body: missingResponse.json() });
    };

    await compare(
      { method: 'POST', url: '/v1/tasks/task-foreign/stop', headers: authorization('control-b-token') },
      { method: 'POST', url: '/v1/tasks/task-missing/stop', headers: authorization('control-b-token') },
    );
    await compare(
      { method: 'POST', url: '/v1/tasks/events', headers: authorization('node-b-token'), payload: runEvent(TENANT_B) },
      { method: 'POST', url: '/v1/tasks/events', headers: authorization('node-b-token'), payload: runEvent(TENANT_B, 'missing') },
    );
    await compare(
      {
        method: 'POST', url: `/v1/nodes/${NODE}/tasks/task-foreign/approval-requests`,
        headers: authorization('node-b-token'), payload: approvalRequest(TENANT_B),
      },
      {
        method: 'POST', url: `/v1/nodes/${NODE}/tasks/task-missing/approval-requests`,
        headers: authorization('node-b-token'), payload: approvalRequest(TENANT_B, 'missing'),
      },
    );
    await compare(
      {
        method: 'POST', url: '/v1/approval-requests/request-foreign/decision',
        headers: authorization('control-b-token'), payload: approvalDecision(TENANT_B),
      },
      {
        method: 'POST', url: '/v1/approval-requests/request-missing/decision',
        headers: authorization('control-b-token'), payload: approvalDecision(TENANT_B, 'missing'),
      },
    );
    await compare(
      {
        method: 'POST', url: `/v1/nodes/${NODE}/tasks/task-foreign/approval-requests/request-foreign/consume`,
        headers: authorization('node-b-token'),
      },
      {
        method: 'POST', url: `/v1/nodes/${NODE}/tasks/task-missing/approval-requests/request-missing/consume`,
        headers: authorization('node-b-token'),
      },
    );
    await compare(
      { method: 'POST', url: `/v1/nodes/${NODE}/tasks/claim`, headers: authorization('node-b-other-token') },
      { method: 'POST', url: '/v1/nodes/node-missing/tasks/claim', headers: authorization('node-b-other-token') },
    );

    const emptyClaim = await app.inject({
      method: 'POST', url: `/v1/nodes/${NODE}/tasks/claim`, headers: authorization('node-b-token'),
    });
    expect(emptyClaim.statusCode).toBe(204);
    expect(await store.getTask(TENANT_A, 'task-foreign', NOW)).toMatchObject({ status: 'leased' });
    expect(await store.getApprovalRequest(TENANT_A, 'request-foreign')).not.toBeNull();
    expect(await store.getApprovalDecision(TENANT_A, 'request-foreign')).toBeNull();
    expect(await store.listEvents(TENANT_A, 'work-foreign')).toEqual([]);
    expect(await store.listAudit(TENANT_A)).toEqual([]);
    expect(await store.listAudit(TENANT_B)).toEqual([]);
  });

  it('keeps SSE payloads and event ids inside each tenant-node stream', async () => {
    const { app, events } = httpHarness();
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const controllerA = new AbortController();
    const controllerB = new AbortController();
    const responseA = await fetch(`${address}/v1/nodes/${NODE}/events`, {
      headers: authorization('node-a-token'), signal: controllerA.signal,
    });
    const responseB = await fetch(`${address}/v1/nodes/${NODE}/events`, {
      headers: authorization('node-b-token'), signal: controllerB.signal,
    });
    expect(responseA.status).toBe(200);
    expect(responseB.status).toBe(200);
    const readerA = responseA.body!.getReader();
    const readerB = responseB.body!.getReader();
    expect(await readUntil(readerA, 'connected')).toContain('connected');
    expect(await readUntil(readerB, 'connected')).toContain('connected');

    events.publish(TENANT_A, NODE, 'task.stop', { taskId: 'a-1' });
    events.publish(TENANT_B, NODE, 'task.stop', { taskId: 'b-1' });
    events.publish(TENANT_A, NODE, 'task.stop', { taskId: 'a-2' });
    const streamedA = await readUntil(readerA, 'a-2');
    const streamedB = await readUntil(readerB, 'b-1');
    expect([...streamedA.matchAll(/^id: (\d+)$/gm)].map((match) => match[1])).toEqual(['1', '2']);
    expect([...streamedB.matchAll(/^id: (\d+)$/gm)].map((match) => match[1])).toEqual(['1']);
    expect(streamedA).toContain('a-1');
    expect(streamedA).toContain('a-2');
    expect(streamedA).not.toContain('b-1');
    expect(streamedB).toContain('b-1');
    expect(streamedB).not.toContain('a-1');

    controllerA.abort();
    controllerB.abort();
    await readerA.cancel().catch(() => undefined);
    await readerB.cancel().catch(() => undefined);
    await new Promise<void>((resolve) => setImmediate(resolve));

    const reconnectController = new AbortController();
    const reconnect = await fetch(`${address}/v1/nodes/${NODE}/events`, {
      headers: { ...authorization('node-a-token'), 'last-event-id': '999999' },
      signal: reconnectController.signal,
    });
    expect(reconnect.status).toBe(200);
    const reconnectReader = reconnect.body!.getReader();
    expect(await readUntil(reconnectReader, 'connected')).toContain('connected');
    events.publish(TENANT_B, NODE, 'task.stop', { taskId: 'b-after-disconnect' });
    events.publish(TENANT_A, NODE, 'task.stop', { taskId: 'a-reconnected' });
    const reconnectedFrame = await readUntil(reconnectReader, 'a-reconnected');
    expect([...reconnectedFrame.matchAll(/^id: (\d+)$/gm)].map((match) => match[1])).toEqual(['1']);
    expect(reconnectedFrame).not.toContain('999999');
    expect(reconnectedFrame).not.toContain('b-after-disconnect');
    reconnectController.abort();
    await reconnectReader.cancel().catch(() => undefined);
  });
});
