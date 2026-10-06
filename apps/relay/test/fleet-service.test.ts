import { afterEach, describe, expect, it } from 'vitest';
import {
  FleetRejectedError,
  FleetService,
  MemoryFleetStore,
  SqliteFleetStore,
  type FleetObject,
  type FleetStore,
  type FleetValidators,
  type HeartbeatClaims,
  type NodeClaims,
  type RunEventClaims,
  type TaskClaims,
  type ValidationResult,
} from '../src/index.js';

const TENANT = 'tenant-a';
const OTHER_TENANT = 'tenant-b';
const NODE = 'node-a';
const SESSION = { tenantId: TENANT, actorRef: 'human:owner' };

let currentTime = Date.parse('2026-10-07T00:00:00.000Z');
const openStores: FleetStore[] = [];

function strict<T>(schema: string, keys: readonly string[], project: (value: Record<string, unknown>) => T) {
  return {
    validate(input: unknown): ValidationResult<T> {
      if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, reason: `${schema} must be an object` };
      const value = input as Record<string, unknown>;
      if (value.schema !== schema) return { ok: false, reason: `expected ${schema}` };
      const unknown = Object.keys(value).find((field) => !keys.includes(field));
      if (unknown) return { ok: false, reason: `unknown field: ${unknown}` };
      try {
        return { ok: true, value: value as FleetObject, meta: project(value) };
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : 'invalid claims' };
      }
    },
  };
}

const validators: FleetValidators = {
  nodeManifest: strict<NodeClaims>('test.node', ['schema', 'nodeId', 'tenantIds', 'agentVersion'], (value) => ({
    nodeId: String(value.nodeId),
    tenantIds: value.tenantIds as string[],
    agentVersion: String(value.agentVersion),
  })),
  heartbeat: strict<HeartbeatClaims>('test.heartbeat', ['schema', 'nodeId', 'sentAt', 'running'], (value) => ({
    nodeId: String(value.nodeId),
    sentAt: String(value.sentAt),
    running: Number(value.running),
  })),
  taskEnvelope: strict<TaskClaims>('test.task', [
    'schema', 'taskId', 'workOrderId', 'tenantId', 'targetNodeId', 'targetRuntime', 'idempotencyKey', 'leaseMs', 'expiresAt', 'originRef',
  ], (value) => ({
    taskId: String(value.taskId),
    workOrderId: String(value.workOrderId),
    tenantId: String(value.tenantId),
    targetNodeId: String(value.targetNodeId),
    targetRuntime: String(value.targetRuntime),
    idempotencyKey: String(value.idempotencyKey),
    leaseMs: Number(value.leaseMs),
    expiresAt: String(value.expiresAt),
    originRef: String(value.originRef),
  })),
  runEvent: strict<RunEventClaims>('test.event', [
    'schema', 'eventId', 'tenantId', 'workOrderId', 'nodeId', 'seq', 'occurredAt', 'type', 'idempotencyKey',
  ], (value) => ({
    eventId: String(value.eventId),
    tenantId: String(value.tenantId),
    workOrderId: String(value.workOrderId),
    nodeId: String(value.nodeId),
    seq: Number(value.seq),
    occurredAt: String(value.occurredAt),
    type: value.type as RunEventClaims['type'],
    idempotencyKey: String(value.idempotencyKey),
  })),
};

function node(tenantIds = [TENANT]) {
  return { schema: 'test.node', nodeId: NODE, tenantIds, agentVersion: '0.1.0' };
}

function heartbeat() {
  return { schema: 'test.heartbeat', nodeId: NODE, sentAt: new Date(currentTime).toISOString(), running: 0 };
}

function task(index = 1, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    schema: 'test.task',
    taskId: `task-${index}`,
    workOrderId: `work-${index}`,
    tenantId: TENANT,
    targetNodeId: NODE,
    targetRuntime: 'codex',
    idempotencyKey: `delivery-${index}`,
    leaseMs: 30_000,
    expiresAt: new Date(currentTime + 3_600_000).toISOString(),
    originRef: `origin-${index}`,
    ...overrides,
  };
}

function event(index: number, seq: number, type: RunEventClaims['type'], overrides: Partial<Record<string, unknown>> = {}) {
  return {
    schema: 'test.event',
    eventId: `event-${index}-${seq}`,
    tenantId: TENANT,
    workOrderId: `work-${index}`,
    nodeId: NODE,
    seq,
    occurredAt: new Date(currentTime).toISOString(),
    type,
    idempotencyKey: `event-delivery-${index}-${seq}`,
    ...overrides,
  };
}

function harness(factory: () => FleetStore) {
  currentTime = Date.parse('2026-10-07T00:00:00.000Z');
  const store = factory();
  openStores.push(store);
  const service = new FleetService(store, validators, { offlineAfterMs: 60_000, now: () => new Date(currentTime) });
  return { store, service };
}

afterEach(() => {
  openStores.splice(0).forEach((store) => store.close());
});

for (const [name, factory] of [
  ['memory', () => new MemoryFleetStore()],
  ['sqlite', () => new SqliteFleetStore(':memory:')],
] as const) {
  describe(`${name} FleetStore contract`, () => {
    it('registers, heartbeats, enqueues, and claims for an online node', async () => {
      const { service } = harness(factory);
      await service.register(SESSION, node());
      await service.heartbeat(SESSION, heartbeat());
      expect((await service.enqueue(SESSION, task())).inserted).toBe(true);
      expect(await service.claim(SESSION, NODE)).toMatchObject({ taskId: 'task-1', status: 'leased', attempt: 1 });
    });

    it('rejects unknown input fields through the injected contract validator', async () => {
      const { service } = harness(factory);
      await expect(service.register(SESSION, { ...node(), secret: 'must-not-pass' })).rejects.toMatchObject({ code: 'invalid_contract' });
    });

    it('rejects a node manifest that is not authorized for the session tenant', async () => {
      const { service } = harness(factory);
      await expect(service.register(SESSION, node([OTHER_TENANT]))).rejects.toMatchObject({ code: 'tenant_mismatch' });
    });

    it('rejects a task whose tenant claim conflicts with the authenticated session', async () => {
      const { service } = harness(factory);
      await expect(service.enqueue(SESSION, task(1, { tenantId: OTHER_TENANT }))).rejects.toMatchObject({ code: 'tenant_mismatch' });
    });

    it('returns the original enqueue result for duplicate delivery', async () => {
      const { service } = harness(factory);
      await service.register(SESSION, node());
      const first = await service.enqueue(SESSION, task());
      const second = await service.enqueue(SESSION, { ...task(), targetRuntime: 'codex' });
      expect(first.inserted).toBe(true);
      expect(second).toMatchObject({ inserted: false, task: { taskId: 'task-1' } });
    });

    it('rejects a reused task idempotency key when the canonical envelope differs', async () => {
      const { service } = harness(factory);
      await service.register(SESSION, node());
      await service.enqueue(SESSION, task());
      await expect(service.enqueue(SESSION, task(99, { idempotencyKey: 'delivery-1' }))).rejects.toMatchObject({ code: 'duplicate_delivery' });
    });

    it('marks a stale node offline and refuses its claim', async () => {
      const { service } = harness(factory);
      await service.register(SESSION, node());
      await service.enqueue(SESSION, task());
      currentTime += 60_000;
      await expect(service.claim(SESSION, NODE)).rejects.toMatchObject({ code: 'node_offline' });
    });

    it('recovers an expired lease without duplicating the task', async () => {
      const { service } = harness(factory);
      await service.register(SESSION, node());
      await service.enqueue(SESSION, task(1, { leaseMs: 1_000 }));
      expect(await service.claim(SESSION, NODE)).toMatchObject({ attempt: 1 });
      currentTime += 1_001;
      await service.heartbeat(SESSION, heartbeat());
      expect(await service.claim(SESSION, NODE)).toMatchObject({ taskId: 'task-1', attempt: 2 });
    });

    it('rejects an event from a node that does not own the lease', async () => {
      const { service } = harness(factory);
      await service.register(SESSION, node());
      await service.enqueue(SESSION, task());
      await service.claim(SESSION, NODE);
      await expect(service.event(SESSION, event(1, 1, 'started', { nodeId: 'node-other' }))).rejects.toBeInstanceOf(FleetRejectedError);
    });

    it('rejects event sequence gaps', async () => {
      const { service } = harness(factory);
      await service.register(SESSION, node());
      await service.enqueue(SESSION, task());
      await service.claim(SESSION, NODE);
      await expect(service.event(SESSION, event(1, 2, 'started'))).rejects.toMatchObject({ code: 'sequence_gap' });
    });

    it('exposes fail-closed ack, completed, and failed event routes', async () => {
      const { service } = harness(factory);
      await service.register(SESSION, node());
      await service.enqueue(SESSION, task());
      await service.claim(SESSION, NODE);
      await expect(service.ack(SESSION, event(1, 1, 'progress'))).rejects.toMatchObject({ code: 'invalid_transition' });
      expect((await service.ack(SESSION, event(1, 1, 'started'))).inserted).toBe(true);
      expect((await service.fail(SESSION, event(1, 2, 'failed'))).task.status).toBe('failed');
      await expect(service.complete(SESSION, event(1, 3, 'completed'))).rejects.toMatchObject({ code: 'invalid_transition' });
    });

    it('rejects completed before an artifact exists', async () => {
      const { service } = harness(factory);
      await service.register(SESSION, node());
      await service.enqueue(SESSION, task());
      await service.claim(SESSION, NODE);
      await expect(service.event(SESSION, event(1, 1, 'completed'))).rejects.toMatchObject({ code: 'invalid_transition' });
    });

    it('deduplicates event delivery without increasing the event count', async () => {
      const { service, store } = harness(factory);
      await service.register(SESSION, node());
      await service.enqueue(SESSION, task());
      await service.claim(SESSION, NODE);
      const first = await service.event(SESSION, event(1, 1, 'started'));
      const second = await service.event(SESSION, { ...event(1, 1, 'started') });
      expect(first.inserted).toBe(true);
      expect(second.inserted).toBe(false);
      expect(await store.listEvents(TENANT, 'work-1')).toHaveLength(1);
    });

    it('rejects a reused event idempotency key when the canonical event differs', async () => {
      const { service } = harness(factory);
      await service.register(SESSION, node());
      await service.enqueue(SESSION, task());
      await service.claim(SESSION, NODE);
      await service.event(SESSION, event(1, 1, 'started'));
      await expect(service.event(SESSION, event(1, 2, 'progress', { idempotencyKey: 'event-delivery-1-1' })))
        .rejects.toMatchObject({ code: 'duplicate_delivery' });
    });

    it('stops a task, records the control, and refuses subsequent events', async () => {
      const { service, store } = harness(factory);
      await service.register(SESSION, node());
      await service.enqueue(SESSION, task());
      await service.claim(SESSION, NODE);
      expect(await service.stop(SESSION, 'task-1')).toMatchObject({ status: 'blocked' });
      expect(await store.listAudit(TENANT)).toMatchObject([{ action: 'stop', actorRef: 'human:owner' }]);
      await expect(service.event(SESSION, event(1, 1, 'artifact'))).rejects.toMatchObject({ code: 'invalid_transition' });
    });

    it('requires a fresh idempotency key when retrying', async () => {
      const { service } = harness(factory);
      await service.register(SESSION, node());
      await service.enqueue(SESSION, task());
      await service.stop(SESSION, 'task-1');
      await expect(service.retry(SESSION, 'task-1', task(2, { workOrderId: 'work-1', originRef: 'origin-1', idempotencyKey: 'delivery-1' }))).rejects.toMatchObject({ code: 'retry_key_reused' });
    });

    it('queues a retry as a distinct attempt lineage', async () => {
      const { service, store } = harness(factory);
      await service.register(SESSION, node());
      await service.enqueue(SESSION, task());
      await service.stop(SESSION, 'task-1');
      expect(await service.retry(SESSION, 'task-1', task(2, { workOrderId: 'work-1', originRef: 'origin-1' }))).toMatchObject({ inserted: true, task: { taskId: 'task-2', retryOfTaskId: 'task-1' } });
      expect(await store.listAudit(TENANT)).toContainEqual(expect.objectContaining({ action: 'retry', taskId: 'task-2' }));
    });

    it('rejects a retry that escapes the original work-order lineage', async () => {
      const { service } = harness(factory);
      await service.register(SESSION, node());
      await service.enqueue(SESSION, task());
      await service.stop(SESSION, 'task-1');
      await expect(service.retry(SESSION, 'task-1', task(2))).rejects.toMatchObject({ code: 'invalid_transition' });
    });

    it('rejects already expired tasks', async () => {
      const { service } = harness(factory);
      await expect(service.enqueue(SESSION, task(1, { expiresAt: new Date(currentTime).toISOString() }))).rejects.toMatchObject({ code: 'task_expired' });
    });

    it('delivers and completes ten tasks exactly once under duplicate ingress', async () => {
      const { service, store } = harness(factory);
      await service.register(SESSION, node());
      for (let index = 1; index <= 10; index += 1) {
        expect((await service.enqueue(SESSION, task(index))).inserted).toBe(true);
        expect((await service.enqueue(SESSION, task(index))).inserted).toBe(false);
      }
      for (let index = 1; index <= 10; index += 1) {
        const claimed = await service.claim(SESSION, NODE);
        expect(claimed?.taskId).toBe(`task-${index}`);
        await service.ack(SESSION, event(index, 1, 'started'));
        await service.event(SESSION, event(index, 2, 'artifact'));
        const completed = await service.complete(SESSION, event(index, 3, 'completed'));
        expect(completed.task.status).toBe('completed');
        expect((await service.complete(SESSION, event(index, 3, 'completed'))).inserted).toBe(false);
      }
      expect(await service.claim(SESSION, NODE)).toBeNull();
      let completedCount = 0;
      for (let index = 1; index <= 10; index += 1) {
        const events = await store.listEvents(TENANT, `work-${index}`);
        completedCount += events.filter((entry) => entry.type === 'completed').length;
      }
      expect(completedCount).toBe(10);
    });
  });
}
