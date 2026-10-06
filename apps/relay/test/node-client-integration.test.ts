import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
// @ts-expect-error node-agent is strict checkJs ESM and does not publish declarations in this alpha slice.
import { HummerNodeAgent } from '../../node-agent/src/node-agent.mjs';
// @ts-expect-error node-agent is strict checkJs ESM and does not publish declarations in this alpha slice.
import { createSharedFleetContractValidator } from '../../node-agent/src/contract-validator.mjs';
// @ts-expect-error node-agent is strict checkJs ESM and does not publish declarations in this alpha slice.
import { RelayClientError, RelayHttpClient } from '../../node-agent/src/relay-http-client.mjs';
import { createStaticBadgeTokenAuthenticator, type BadgeScope } from '../src/badge-auth.js';
import { createSharedFleetValidators } from '../src/contract-adapter.js';
import { FleetService } from '../src/fleet-service.js';
import { createFleetRelayServer, type FleetSseBroker } from '../src/fastify-transport.js';
import { MemoryFleetStore } from '../src/memory-store.js';

const NOW = '2026-10-07T00:00:00.000Z';
const FUTURE = '2099-01-01T00:00:00.000Z';
const TENANT = 'tenant-a';
const NODE = 'node-main';
const NODE_TOKEN = 'integration-node-badge';
const CONTROL_TOKEN = 'integration-control-badge';
const NODE_SCOPES = ['node.register', 'node.heartbeat', 'task.claim', 'task.event', 'stream.connect'] as const;

const manifest = {
  schema: 'hummer.node-manifest', version: 1, nodeId: NODE, tenantIds: [TENANT],
  platform: 'win32', agentVersion: '0.1.0',
  runtimes: [{ kind: 'codex', available: true, pinnedVersion: '0.153.4' }],
  capabilities: ['workspace.exec'],
  mcp: { endpoint: 'stdio://hummer-local', tools: ['workspace_exec'] },
  load: { running: 0, queued: 0 },
} as const;

function envelope(index: number) {
  return {
    schema: 'hummer.task-envelope', version: 1,
    workOrderTask: {
      schema: 'hummer.work-order-task', version: 1,
      title: `Task ${index}`, target: 'Prepare a report', expectedDeliverable: 'outputs/report.md',
    },
    tenantId: TENANT, targetNodeId: NODE, targetRuntime: 'codex',
    idempotencyKey: `delivery-${index}`, leaseMs: 30_000,
    approvalPolicyRef: 'policy-deny-by-default', expiresAt: FUTURE,
    originRef: `work-${index}`,
  } as const;
}

function approval(index: number, overrides: Record<string, unknown> = {}) {
  return {
    schema: 'hummer.approval-decision', version: 1,
    decisionId: `decision-${index}`, requestId: `delivery-${index}`, tenantId: TENANT,
    deciderActorRef: 'human:owner', decidedAt: NOW, decision: 'approved',
    grantedScope: { capabilities: ['task.execute'], expiresAt: FUTURE },
    ...overrides,
  };
}

function runEvents(index: number) {
  const common = (seq: number) => ({
    schema: 'hummer.run-event', version: 1, eventId: `event-${index}-${seq}`,
    tenantId: TENANT, workOrderId: `work-${index}`, nodeId: NODE, seq,
    occurredAt: NOW, actorRef: 'employee:worker', idempotencyKey: `event-key-${index}-${seq}`,
  });
  return [
    { ...common(1), type: 'started', payload: { runId: `run-${index}` } },
    { ...common(2), type: 'artifact', payload: { artifactId: `artifact-${index}`, sha256: 'a'.repeat(64), bytes: 12, relPath: 'outputs/report.md' } },
    { ...common(3), type: 'completed', payload: { summary: 'done' } },
  ];
}

function badge(token: string, tenantId: string, nodeId: string | undefined, scopes: readonly BadgeScope[]) {
  return { token, tokenId: `badge-${token}`, tenantId, actorRef: nodeId ? `system:${nodeId}` : 'human:operator', nodeId, scopes, expiresAt: FUTURE };
}

interface Harness {
  app: FastifyInstance;
  events: FleetSseBroker;
  store: MemoryFleetStore;
  baseUrl: string;
  client: RelayHttpClient;
}

const openHarnesses: Harness[] = [];
afterEach(async () => {
  for (const entry of openHarnesses.splice(0)) {
    entry.events.close();
    await entry.app.close();
  }
});

async function createHarness(): Promise<Harness> {
  const store = new MemoryFleetStore();
  const service = new FleetService(store, createSharedFleetValidators(), { now: () => new Date(NOW) });
  const authenticator = createStaticBadgeTokenAuthenticator([
    badge(NODE_TOKEN, TENANT, NODE, NODE_SCOPES),
    badge(CONTROL_TOKEN, TENANT, undefined, ['task.enqueue', 'task.stop']),
    badge('tenant-b-node-badge', 'tenant-b', NODE, NODE_SCOPES),
  ]);
  const { app, events } = createFleetRelayServer(service, { authenticator, now: () => new Date(NOW) });
  const baseUrl = await app.listen({ host: '127.0.0.1', port: 0 });
  const client = new RelayHttpClient({ baseUrl, badgeToken: NODE_TOKEN, reconnect: { initialDelayMs: 5, maxDelayMs: 20 } });
  const harness = { app, events, store, baseUrl, client };
  openHarnesses.push(harness);
  return harness;
}

function createAgent(client: RelayHttpClient, executions: unknown[], index: number) {
  return new HummerNodeAgent({
    nodeId: NODE,
    tenantId: TENANT,
    heartbeatIntervalMs: 20_000,
    grant: {
      token: 'local-capability-grant-not-a-relay-badge', nodeId: NODE, tenantId: TENANT,
      expiresAt: FUTURE, scopes: ['node.heartbeat', 'task.claim', 'task.execute'],
    },
    transport: client,
    contractValidator: createSharedFleetContractValidator({
      validateOutcomeReceipt: (value: unknown) => ({ ok: true as const, value }),
    }),
    executor: {
      execute: async (input: unknown) => {
        executions.push(input);
        return { events: runEvents(index), receipt: { id: `receipt-${index}` } };
      },
    },
    clock: () => new Date(NOW),
  });
}

async function enqueue(baseUrl: string, index: number) {
  const response = await fetch(`${baseUrl}/v1/tasks/enqueue`, {
    method: 'POST',
    headers: { authorization: `Bearer ${CONTROL_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(envelope(index)),
  });
  expect(response.status).toBe(200);
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for integration state');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('real Fastify Relay and node HTTP/SSE client', () => {
  it('claims into the pending gate, then executes exactly once after a matching contract-valid human decision', async () => {
    const { baseUrl, client, store } = await createHarness();
    const executions: unknown[] = [];
    const states: Array<{ state: string; claimId?: string }> = [];
    const agent = createAgent(client, executions, 1);
    await client.registerNode(manifest, { nodeId: NODE, tenantId: TENANT });
    await client.sendHeartbeat(manifest, { nodeId: NODE, tenantId: TENANT });
    const stream = client.connectAgent(agent, { onState: (state: unknown) => states.push(state as { state: string; claimId?: string }) });
    await stream.ready;

    await enqueue(baseUrl, 1);
    await waitFor(() => states.some((state) => state.state === 'pending_confirmation'));
    expect(executions).toHaveLength(0);

    expect(await agent.confirmAndExecute('delivery-1', approval(1))).toEqual({ state: 'completed', claimId: 'delivery-1' });
    expect(await agent.confirmAndExecute('delivery-1', approval(1))).toEqual({ state: 'duplicate', claimId: 'delivery-1' });
    expect(executions).toHaveLength(1);
    expect((await store.listEvents(TENANT, 'work-1')).map((event) => event.type)).toEqual(['started', 'artifact', 'completed']);
    expect(await store.getTask(TENANT, 'delivery-1', NOW)).toMatchObject({ status: 'completed' });

    stream.close();
    await stream.done;
  });

  it('keeps cross-tenant decisions, wrong badges and expired approval scopes at zero execution', async () => {
    const { baseUrl, client } = await createHarness();
    const executions: unknown[] = [];
    const states: Array<{ state: string }> = [];
    const agent = createAgent(client, executions, 2);
    await client.registerNode(manifest, { nodeId: NODE, tenantId: TENANT });
    const stream = client.connectAgent(agent, { onState: (state: unknown) => states.push(state as { state: string }) });
    await stream.ready;
    await enqueue(baseUrl, 2);
    await waitFor(() => states.some((state) => state.state === 'pending_confirmation'));

    await expect(agent.confirmAndExecute('delivery-2', approval(2, { tenantId: 'tenant-b' }))).rejects.toMatchObject({ code: 'approval_not_authorized' });
    await expect(agent.confirmAndExecute('delivery-2', approval(2, {
      grantedScope: { capabilities: ['task.execute'], expiresAt: '2026-10-06T23:59:59.000Z' },
    }))).rejects.toMatchObject({ code: 'approval_expired' });
    expect(executions).toHaveLength(0);

    const wrongClient = new RelayHttpClient({ baseUrl, badgeToken: 'wrong-badge' });
    await expect(wrongClient.claimTask({ nodeId: NODE, tenantId: TENANT })).rejects.toBeInstanceOf(RelayClientError);
    await expect(wrongClient.claimTask({ nodeId: NODE, tenantId: TENANT })).rejects.toMatchObject({ statusCode: 401, retryable: false });
    expect(executions).toHaveLength(0);

    stream.close();
    await stream.done;
  });

  it('turns task.stop into a terminal local state that a later approval cannot execute', async () => {
    const { baseUrl, client } = await createHarness();
    const executions: unknown[] = [];
    const states: Array<{ state: string }> = [];
    const agent = createAgent(client, executions, 3);
    await client.registerNode(manifest, { nodeId: NODE, tenantId: TENANT });
    const stream = client.connectAgent(agent, { onState: (state: unknown) => states.push(state as { state: string }) });
    await stream.ready;
    await enqueue(baseUrl, 3);
    await waitFor(() => states.some((state) => state.state === 'pending_confirmation'));
    const controlClient = new RelayHttpClient({ baseUrl, badgeToken: CONTROL_TOKEN });
    await controlClient.stopTask('delivery-3');
    await waitFor(() => states.some((state) => state.state === 'stopped'));

    expect(await agent.confirmAndExecute('delivery-3', approval(3))).toEqual({ state: 'stopped', claimId: 'delivery-3' });
    expect(executions).toHaveLength(0);

    stream.close();
    await stream.done;
  });
});
