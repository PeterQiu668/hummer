import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  CapabilityGrantRegistry,
  createStaticBadgeTokenAuthenticator,
  type BadgeScope,
} from '../src/badge-auth.js';
import { createSharedFleetValidators } from '../src/contract-adapter.js';
import { FleetService } from '../src/fleet-service.js';
import { createFleetRelayServer, type FleetSseBroker } from '../src/fastify-transport.js';
import { MemoryFleetStore } from '../src/memory-store.js';

const NOW = '2026-10-07T00:00:00.000Z';
const TENANT = 'tenant-a';
const NODE = 'node-main';
const NODE_SCOPES = [
  'node.register', 'node.heartbeat', 'task.claim', 'task.event', 'stream.connect',
  'approval.request', 'approval.consume',
] as const;

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

const approvalRequest = (index = 1, overrides: Record<string, unknown> = {}) => ({
  schema: 'hummer.approval-request', version: 1, requestId: `request-${index}`,
  tenantId: TENANT, workOrderId: `work-${index}`, nodeId: NODE, runId: `run-${index}`,
  riskClass: 'write', action: 'task.execute', target: `delivery-${index}`,
  redactedPreview: 'Execute the approved synthetic task',
  requestedScope: { capabilities: ['task.execute'], paths: ['outputs/report.md'], maxUses: 1 },
  expiresAt: '2026-10-07T01:00:00Z', requestedBy: `system:${NODE}`,
  ...overrides,
});

const approvalDecision = (index = 1, overrides: Record<string, unknown> = {}) => ({
  schema: 'hummer.approval-decision', version: 1, decisionId: `decision-${index}`,
  requestId: `request-${index}`, tenantId: TENANT, deciderActorRef: 'human:operator',
  decidedAt: NOW, decision: 'approved',
  grantedScope: { capabilities: ['task.execute'], paths: ['outputs/report.md'], maxUses: 1, expiresAt: '2026-10-07T00:30:00Z' },
  ...overrides,
});

const nonApprovedDecision = (index: number, decision: 'denied' | 'expired' | 'revoked') => {
  const { grantedScope: _grantedScope, ...record } = approvalDecision(index);
  return { ...record, decision };
};

// SSE expiry is enforced against the wall clock after authorization. Keep the
// ordinary fixture badges unambiguously live; expiry-specific cases pass an
// explicit timestamp relative to the service's injected NOW value below.
function badge(token: string, tenantId: string, nodeId: string | undefined, scopes: readonly BadgeScope[], expiresAt = '2099-01-01T00:00:00Z') {
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
    badge('control-token', TENANT, undefined, ['node.read', 'task.enqueue', 'task.stop', 'approval.read', 'approval.decide']),
    badge('tenant-b-token', 'tenant-b', undefined, ['task.enqueue', 'task.stop']),
    badge('claim-only-token', TENANT, NODE, ['task.claim']),
    badge('expired-token', TENANT, NODE, NODE_SCOPES, '2026-10-06T23:59:59Z'),
    {
      token: 'system-control-token', tokenId: 'badge-system-control', tenantId: TENANT,
      actorRef: 'system:auto', scopes: ['approval.decide'], expiresAt: '2099-01-01T00:00:00Z',
    },
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

  it('projects the authenticated human/account control identity without exposing badge material', async () => {
    const { app, events } = harness();
    openApps.push({ app, events });

    const response = await app.inject({
      method: 'GET', url: '/v1/control/session', headers: authorization('control-token'),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ session: { tenantId: TENANT, actorRef: 'human:operator' } });
    expect(response.body).not.toContain('control-token');

    expect((await app.inject({
      method: 'GET', url: '/v1/control/session?tenantId=other', headers: authorization('control-token'),
    })).statusCode).toBe(400);
    expect((await app.inject({
      method: 'GET', url: '/v1/control/session', headers: authorization('node-token'),
    })).statusCode).toBe(403);
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

  it('binds approval request, human decision and one-time node consumption over authenticated HTTP', async () => {
    const { app, events } = harness();
    openApps.push({ app, events });
    await register(app);
    await enqueue(app);
    await app.inject({ method: 'POST', url: `/v1/nodes/${NODE}/tasks/claim`, headers: authorization('node-token') });

    const requested = await app.inject({
      method: 'POST', url: `/v1/nodes/${NODE}/tasks/delivery-1/approval-requests`,
      headers: authorization('node-token'), payload: approvalRequest(),
    });
    expect(requested.statusCode).toBe(200);
    expect(requested.json()).toMatchObject({ request: { requestId: 'request-1', taskId: 'delivery-1', runId: 'run-1' } });

    const decided = await app.inject({
      method: 'POST', url: '/v1/approval-requests/request-1/decision',
      headers: authorization('control-token'), payload: approvalDecision(),
    });
    expect(decided.statusCode).toBe(200);
    expect(decided.json()).toMatchObject({ decision: { decisionId: 'decision-1', decision: 'approved' } });

    const approvalList = await app.inject({
      method: 'GET', url: '/v1/control/approval-requests', headers: authorization('control-token'),
    });
    expect(approvalList.statusCode).toBe(200);
    expect(approvalList.json()).toMatchObject({
      approvalRequests: [{ requestId: 'request-1', decision: { decisionId: 'decision-1', decision: 'approved' } }],
    });

    const consumed = await app.inject({
      method: 'POST', url: `/v1/nodes/${NODE}/tasks/delivery-1/approval-requests/request-1/consume`,
      headers: authorization('node-token'),
    });
    expect(consumed.statusCode).toBe(200);
    expect(consumed.json()).toMatchObject({ request: { requestId: 'request-1' }, decision: { decisionId: 'decision-1' } });
    expect((await app.inject({
      method: 'POST', url: `/v1/nodes/${NODE}/tasks/delivery-1/approval-requests/request-1/consume`,
      headers: authorization('node-token'),
    })).json()).toMatchObject({ error: { code: 'approval_replayed' } });
  });

  it('binds an HTTP denial to a terminal task and permits exactly one node consumption', async () => {
    const { app, events, store } = harness();
    openApps.push({ app, events });
    await register(app);
    await enqueue(app);
    await app.inject({ method: 'POST', url: `/v1/nodes/${NODE}/tasks/claim`, headers: authorization('node-token') });
    await app.inject({
      method: 'POST', url: `/v1/nodes/${NODE}/tasks/delivery-1/approval-requests`,
      headers: authorization('node-token'), payload: approvalRequest(),
    });

    const decided = await app.inject({
      method: 'POST', url: '/v1/approval-requests/request-1/decision',
      headers: authorization('control-token'), payload: nonApprovedDecision(1, 'denied'),
    });
    expect(decided.statusCode).toBe(200);
    expect(await store.getTask(TENANT, 'delivery-1', NOW)).toMatchObject({
      status: 'failed', leaseOwnerNodeId: null, leaseExpiresAt: null,
    });
    expect((await app.inject({
      method: 'POST', url: `/v1/nodes/${NODE}/tasks/claim`, headers: authorization('node-token'),
    })).statusCode).toBe(204);
    const executionAttempt = await app.inject({
      method: 'POST', url: '/v1/tasks/ack', headers: authorization('node-token'), payload: runEvent(1, 1, 'started'),
    });
    expect(executionAttempt.statusCode).toBe(409);
    expect(executionAttempt.json()).toMatchObject({ error: { code: 'invalid_transition' } });

    const consumed = await app.inject({
      method: 'POST', url: `/v1/nodes/${NODE}/tasks/delivery-1/approval-requests/request-1/consume`,
      headers: authorization('node-token'),
    });
    expect(consumed.statusCode).toBe(200);
    expect(consumed.json()).toMatchObject({ decision: { decision: 'denied', decisionId: 'decision-1' } });
    const replayed = await app.inject({
      method: 'POST', url: `/v1/nodes/${NODE}/tasks/delivery-1/approval-requests/request-1/consume`,
      headers: authorization('node-token'),
    });
    expect(replayed.statusCode).toBe(409);
    expect(replayed.json()).toMatchObject({ error: { code: 'approval_replayed' } });
    expect((await app.inject({
      method: 'POST', url: '/v1/approval-requests/request-1/decision',
      headers: authorization('control-token'), payload: approvalDecision(1, { decisionId: 'late-approved' }),
    })).json()).toMatchObject({ error: { code: 'approval_replayed' } });
    expect((await app.inject({
      method: 'POST', url: '/v1/tasks/delivery-1/stop', headers: authorization('control-token'),
    })).json()).toMatchObject({ error: { code: 'invalid_transition' } });
  });

  it('rejects unknown approval fields and system-authored decisions before persistence', async () => {
    const { app, events, store } = harness();
    openApps.push({ app, events });
    await register(app);
    await enqueue(app);
    await app.inject({ method: 'POST', url: `/v1/nodes/${NODE}/tasks/claim`, headers: authorization('node-token') });
    const unknown = await app.inject({
      method: 'POST', url: `/v1/nodes/${NODE}/tasks/delivery-1/approval-requests`,
      headers: authorization('node-token'), payload: approvalRequest(1, { autoApprove: true }),
    });
    expect(unknown.statusCode).toBe(400);
    expect(await store.getApprovalRequest(TENANT, 'request-1')).toBeNull();

    await app.inject({
      method: 'POST', url: `/v1/nodes/${NODE}/tasks/delivery-1/approval-requests`,
      headers: authorization('node-token'), payload: approvalRequest(),
    });
    const unknownDecision = await app.inject({
      method: 'POST', url: '/v1/approval-requests/request-1/decision',
      headers: authorization('control-token'),
      payload: approvalDecision(1, { autoExecute: true }),
    });
    expect(unknownDecision.statusCode).toBe(400);
    expect(await store.getApprovalDecision(TENANT, 'request-1')).toBeNull();
    const systemDecision = await app.inject({
      method: 'POST', url: '/v1/approval-requests/request-1/decision',
      headers: authorization('system-control-token'),
      payload: approvalDecision(1, { deciderActorRef: 'system:auto' }),
    });
    expect(systemDecision.statusCode).toBe(403);
    expect(systemDecision.json()).toMatchObject({ error: { code: 'control_badge_required' } });
    expect(await store.getApprovalDecision(TENANT, 'request-1')).toBeNull();
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

  it('enforces capability-grant scope, revocation, and maxUses at the Fastify boundary', async () => {
    const token = `hgr_${'g'.repeat(43)}`;
    const registry = new CapabilityGrantRegistry({ now: () => new Date(NOW), tokenFactory: () => token });
    registry.issue({
      authorityRef: 'authority:operator', tenantId: TENANT, nodeId: NODE,
      workOrderId: 'work-bootstrap', issuedToRunId: 'run-bootstrap',
      capabilities: ['node.register', 'node.heartbeat'], paths: [],
      expiresAt: '2026-10-07T01:00:00.000Z', maxUses: 2,
    }, {
      grantId: 'grant-bootstrap', tenantId: TENANT, nodeId: NODE,
      workOrderId: 'work-bootstrap', issuedToRunId: 'run-bootstrap',
      capabilities: ['node.register'], paths: [],
      expiresAt: '2026-10-07T00:30:00.000Z', maxUses: 1,
    });
    const store = new MemoryFleetStore();
    const service = new FleetService(store, createSharedFleetValidators(), { now: () => new Date(NOW) });
    const entry = createFleetRelayServer(service, { authenticator: registry, now: () => new Date(NOW) });
    openApps.push(entry);

    const denied = await entry.app.inject({
      method: 'POST', url: `/v1/nodes/${NODE}/heartbeat`, headers: authorization(token), payload: manifest(),
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toEqual({ error: { code: 'scope_denied', message: 'badge does not grant node.heartbeat' } });
    expect(registry.get('tenant-a', 'grant-bootstrap')).toMatchObject({ usedCount: 0, status: 'active' });

    const accepted = await entry.app.inject({
      method: 'POST', url: '/v1/nodes/register', headers: authorization(token), payload: manifest(),
    });
    expect(accepted.statusCode).toBe(200);
    expect(JSON.stringify(accepted.json())).not.toContain(token);
    expect(registry.get('tenant-a', 'grant-bootstrap')).toMatchObject({ usedCount: 1, status: 'exhausted' });

    const replay = await entry.app.inject({
      method: 'POST', url: '/v1/nodes/register', headers: authorization(token), payload: manifest(),
    });
    expect(replay.statusCode).toBe(401);
    expect(JSON.stringify(replay.json())).not.toContain(token);
  });

  it('requires both the node badge and the bound one-time task grant after human approval', async () => {
    const taskToken = `hgr_${'t'.repeat(43)}`;
    const taskGrants = new CapabilityGrantRegistry({ now: () => new Date(NOW), tokenFactory: () => taskToken });
    taskGrants.issue({
      authorityRef: 'authority:operator', tenantId: TENANT, nodeId: NODE,
      workOrderId: 'work-1', issuedToRunId: 'run-1',
      capabilities: ['task.execute'], paths: ['outputs/report.md'],
      expiresAt: '2026-10-07T01:00:00.000Z', maxUses: 1,
    }, {
      grantId: 'task-grant-1', tenantId: TENANT, nodeId: NODE,
      workOrderId: 'work-1', issuedToRunId: 'run-1',
      capabilities: ['task.execute'], paths: ['outputs/report.md'],
      expiresAt: '2026-10-07T00:30:00.000Z', maxUses: 1,
    });
    const store = new MemoryFleetStore();
    const service = new FleetService(store, createSharedFleetValidators(), { now: () => new Date(NOW) });
    const authenticator = createStaticBadgeTokenAuthenticator([
      badge('node-token', TENANT, NODE, NODE_SCOPES),
      badge('control-token', TENANT, undefined, ['task.enqueue', 'approval.decide']),
    ]);
    const entry = createFleetRelayServer(service, {
      authenticator, taskGrantAuthenticator: taskGrants, now: () => new Date(NOW),
    });
    openApps.push(entry);

    expect((await entry.app.inject({
      method: 'POST', url: '/v1/nodes/register', headers: authorization('node-token'), payload: manifest(),
    })).statusCode).toBe(200);
    expect((await entry.app.inject({
      method: 'POST', url: '/v1/tasks/enqueue', headers: authorization('control-token'),
      payload: envelope(1, { grantRef: 'grant:task-grant-1' }),
    })).statusCode).toBe(200);
    expect((await entry.app.inject({
      method: 'POST', url: `/v1/nodes/${NODE}/tasks/claim`, headers: authorization('node-token'),
    })).statusCode).toBe(200);
    expect((await entry.app.inject({
      method: 'POST', url: `/v1/nodes/${NODE}/tasks/delivery-1/approval-requests`,
      headers: authorization('node-token'), payload: approvalRequest(),
    })).statusCode).toBe(200);
    expect((await entry.app.inject({
      method: 'POST', url: '/v1/approval-requests/request-1/decision',
      headers: authorization('control-token'), payload: approvalDecision(),
    })).statusCode).toBe(200);

    const grantHeaders = { ...authorization('node-token'), 'x-hummer-task-grant': taskToken };
    const route = `/v1/nodes/${NODE}/tasks/delivery-1/task-grant`;
    expect((await entry.app.inject({
      method: 'POST', url: `${route}/consume`, headers: authorization('node-token'), payload: { requestId: 'request-1' },
    })).statusCode).toBe(401);
    expect((await entry.app.inject({
      method: 'POST', url: `${route}/consume`,
      headers: { ...authorization('wrong-node-badge'), 'x-hummer-task-grant': taskToken },
      payload: { requestId: 'request-1' },
    })).statusCode).toBe(401);
    const wrongGrant = await entry.app.inject({
      method: 'POST', url: `${route}/consume`,
      headers: { ...authorization('node-token'), 'x-hummer-task-grant': 'wrong-task-grant' },
      payload: { requestId: 'request-1' },
    });
    expect(wrongGrant.statusCode).toBe(401);
    expect(wrongGrant.body).not.toContain('wrong-task-grant');
    const beforeConsume = await entry.app.inject({
      method: 'POST', url: `${route}/checkpoint`, headers: grantHeaders, payload: { requestId: 'request-1' },
    });
    expect(beforeConsume.statusCode).toBe(401);
    expect(beforeConsume.body).not.toContain(taskToken);

    const consumed = await entry.app.inject({
      method: 'POST', url: `${route}/consume`, headers: grantHeaders, payload: { requestId: 'request-1' },
    });
    expect(consumed.statusCode).toBe(200);
    expect(consumed.json()).toMatchObject({ authorization: {
      grantRef: 'grant:task-grant-1', tenantId: TENANT, nodeId: NODE,
      workOrderId: 'work-1', issuedToRunId: 'run-1', usedCount: 1, maxUses: 1,
    } });
    expect(consumed.body).not.toContain(taskToken);
    for (let index = 0; index < 2; index += 1) {
      expect((await entry.app.inject({
        method: 'POST', url: `${route}/checkpoint`, headers: grantHeaders, payload: { requestId: 'request-1' },
      })).statusCode).toBe(200);
    }
    expect(taskGrants.get(TENANT, 'task-grant-1')).toMatchObject({ usedCount: 1, status: 'exhausted' });
    expect((await entry.app.inject({
      method: 'POST', url: `${route}/consume`, headers: grantHeaders, payload: { requestId: 'request-1' },
    })).statusCode).toBe(401);

    taskGrants.revoke(TENANT, 'task-grant-1');
    expect((await entry.app.inject({
      method: 'POST', url: `${route}/checkpoint`, headers: grantHeaders, payload: { requestId: 'request-1' },
    })).statusCode).toBe(401);
  });

  it('makes grant revocation effective on the next Fastify authorization checkpoint', async () => {
    const token = `hgr_${'r'.repeat(43)}`;
    const registry = new CapabilityGrantRegistry({ now: () => new Date(NOW), tokenFactory: () => token });
    registry.issue({
      authorityRef: 'authority:operator', tenantId: TENANT, nodeId: NODE,
      workOrderId: 'work-bootstrap', issuedToRunId: 'run-bootstrap',
      capabilities: ['node.register'], paths: [], expiresAt: '2026-10-07T01:00:00.000Z', maxUses: 2,
    }, {
      grantId: 'grant-revoked', tenantId: TENANT, nodeId: NODE,
      workOrderId: 'work-bootstrap', issuedToRunId: 'run-bootstrap',
      capabilities: ['node.register'], paths: [], expiresAt: '2026-10-07T00:30:00.000Z', maxUses: 2,
    });
    registry.revoke('tenant-a', 'grant-revoked');
    const store = new MemoryFleetStore();
    const service = new FleetService(store, createSharedFleetValidators(), { now: () => new Date(NOW) });
    const entry = createFleetRelayServer(service, { authenticator: registry, now: () => new Date(NOW) });
    openApps.push(entry);

    const response = await entry.app.inject({
      method: 'POST', url: '/v1/nodes/register', headers: authorization(token), payload: manifest(),
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: { code: 'invalid_token', message: 'Bearer badge token is invalid or expired' },
    });
    expect(JSON.stringify(response.json())).not.toContain(token);
  });
});
