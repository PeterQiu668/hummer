import { afterEach, describe, expect, it } from 'vitest';
import {
  FleetRejectedError,
  FleetService,
  MemoryFleetStore,
  SqliteFleetStore,
  type FleetObject,
  type FleetStore,
  type FleetValidators,
  type ApprovalDecisionClaims,
  type ApprovalRequestClaims,
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
const NODE_SESSION = { tenantId: TENANT, actorRef: `system:${NODE}`, nodeId: NODE };
const CONTROL_SESSION = { tenantId: TENANT, actorRef: 'human:owner' };

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
  approvalRequest: strict<ApprovalRequestClaims>('test.approval-request', [
    'schema', 'requestId', 'tenantId', 'workOrderId', 'nodeId', 'runId', 'riskClass',
    'action', 'target', 'requestedScope', 'expiresAt', 'requestedBy',
  ], (value) => ({
    requestId: String(value.requestId), tenantId: String(value.tenantId), workOrderId: String(value.workOrderId),
    nodeId: String(value.nodeId), runId: String(value.runId), riskClass: String(value.riskClass),
    action: String(value.action), target: String(value.target),
    requestedScope: value.requestedScope as ApprovalRequestClaims['requestedScope'],
    expiresAt: String(value.expiresAt), requestedBy: String(value.requestedBy),
  })),
  approvalDecision: strict<ApprovalDecisionClaims>('test.approval-decision', [
    'schema', 'decisionId', 'requestId', 'tenantId', 'deciderActorRef', 'decidedAt', 'decision', 'grantedScope',
  ], (value) => ({
    decisionId: String(value.decisionId), requestId: String(value.requestId), tenantId: String(value.tenantId),
    deciderActorRef: String(value.deciderActorRef), decidedAt: String(value.decidedAt),
    decision: value.decision as ApprovalDecisionClaims['decision'],
    ...(value.grantedScope ? { grantedScope: value.grantedScope as NonNullable<ApprovalDecisionClaims['grantedScope']> } : {}),
  })),
};

function node(tenantIds = [TENANT]) {
  return { schema: 'test.node', nodeId: NODE, tenantIds, agentVersion: '0.1.0' };
}

function heartbeat(running = 0) {
  return { schema: 'test.heartbeat', nodeId: NODE, sentAt: new Date(currentTime).toISOString(), running };
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

function approvalRequest(index = 1, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    schema: 'test.approval-request', requestId: `request-${index}`, tenantId: TENANT,
    workOrderId: `work-${index}`, nodeId: NODE, runId: `run-${index}`, riskClass: 'write',
    action: 'task.execute', target: `task-${index}`,
    requestedScope: { capabilities: ['task.execute'], paths: ['outputs/report.md'], maxUses: 1 },
    expiresAt: new Date(currentTime + 3_600_000).toISOString(), requestedBy: `system:${NODE}`,
    ...overrides,
  };
}

function approvalDecision(index = 1, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    schema: 'test.approval-decision', decisionId: `decision-${index}`, requestId: `request-${index}`,
    tenantId: TENANT, deciderActorRef: 'human:owner', decidedAt: new Date(currentTime).toISOString(),
    decision: 'approved',
    grantedScope: { capabilities: ['task.execute'], paths: ['outputs/report.md'], maxUses: 1, expiresAt: new Date(currentTime + 1_800_000).toISOString() },
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

    it('persists and atomically consumes one immutable approval bound to the pending claim', async () => {
      const { service, store } = harness(factory);
      await service.register(NODE_SESSION, node());
      await service.enqueue(SESSION, task());
      await service.claim(NODE_SESSION, NODE);
      expect(await service.requestApproval(NODE_SESSION, 'task-1', approvalRequest())).toMatchObject({
        requestId: 'request-1', taskId: 'task-1', workOrderId: 'work-1', nodeId: NODE, runId: 'run-1',
      });
      expect(await service.decideApproval(CONTROL_SESSION, 'request-1', approvalDecision())).toMatchObject({
        decisionId: 'decision-1', decision: 'approved', deciderActorRef: 'human:owner',
      });
      expect(await service.consumeApproval(NODE_SESSION, NODE, 'task-1', 'request-1')).toMatchObject({
        request: { requestId: 'request-1' }, decision: { decisionId: 'decision-1' },
      });
      await expect(service.consumeApproval(NODE_SESSION, NODE, 'task-1', 'request-1'))
        .rejects.toMatchObject({ code: 'approval_replayed' });
      expect(await store.getApprovalRequest(TENANT, 'request-1')).toMatchObject({ action: 'task.execute', target: 'task-1' });
      expect(await store.getApprovalDecision(TENANT, 'request-1')).toMatchObject({ decision: 'approved' });
    });

    it('rejects cross-binding, expanded scope, expiry, and a second immutable decision', async () => {
      const { service } = harness(factory);
      await service.register(NODE_SESSION, node());
      await service.enqueue(SESSION, task());
      await service.claim(NODE_SESSION, NODE);
      await expect(service.requestApproval(NODE_SESSION, 'task-1', approvalRequest(1, { workOrderId: 'work-other' })))
        .rejects.toMatchObject({ code: 'lease_owner_mismatch' });
      await service.requestApproval(NODE_SESSION, 'task-1', approvalRequest());
      await expect(service.decideApproval(CONTROL_SESSION, 'request-1', approvalDecision(1, {
        grantedScope: { capabilities: ['task.execute', 'workspace.admin'], expiresAt: new Date(currentTime + 1_000).toISOString() },
      }))).rejects.toMatchObject({ code: 'approval_scope_exceeded' });
      await expect(service.decideApproval(CONTROL_SESSION, 'request-1', approvalDecision(1, {
        grantedScope: { capabilities: ['task.execute'], expiresAt: new Date(currentTime - 1).toISOString() },
      }))).rejects.toMatchObject({ code: 'approval_expired' });
      await service.decideApproval(CONTROL_SESSION, 'request-1', approvalDecision());
      await expect(service.decideApproval(CONTROL_SESSION, 'request-1', approvalDecision(1, { decisionId: 'decision-second' })))
        .rejects.toMatchObject({ code: 'approval_replayed' });
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

    it('keeps a node online before 60 seconds and marks it offline at exactly 60 seconds', async () => {
      const { service } = harness(factory);
      await service.register(SESSION, node());
      await service.enqueue(SESSION, task(1, { leaseMs: 120_000 }));
      await service.enqueue(SESSION, task(2, { leaseMs: 120_000 }));
      currentTime += 59_999;
      expect(await service.claim(SESSION, NODE)).toMatchObject({ taskId: 'task-1' });
      currentTime += 1;
      await expect(service.claim(SESSION, NODE)).rejects.toMatchObject({ code: 'node_offline' });
    });

    it('rejects a heartbeat whose running count differs from active leases without renewing the node', async () => {
      const { service, store } = harness(factory);
      await service.register(SESSION, node());
      await expect(service.heartbeat(SESSION, heartbeat(1))).rejects.toMatchObject({ code: 'heartbeat_load_mismatch' });
      await service.enqueue(SESSION, task(1, { leaseMs: 120_000 }));
      await service.claim(SESSION, NODE);

      await expect(service.heartbeat(SESSION, heartbeat(0))).rejects.toMatchObject({ code: 'heartbeat_load_mismatch' });
      await expect(service.heartbeat(SESSION, heartbeat(1))).resolves.toMatchObject({ status: 'online' });
      currentTime += 60_000;
      expect(await store.getNode(TENANT, NODE, new Date(currentTime).toISOString())).toMatchObject({ status: 'offline' });
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

    it('recovers a lease at the exact expiry boundary and permits only one concurrent re-claim', async () => {
      const { service } = harness(factory);
      await service.register(SESSION, node());
      await service.enqueue(SESSION, task(1, { leaseMs: 1_000 }));
      expect(await service.claim(SESSION, NODE)).toMatchObject({ attempt: 1 });

      currentTime += 1_000;
      await service.heartbeat(SESSION, heartbeat(0));
      const claims = await Promise.all([
        service.claim(SESSION, NODE),
        service.claim(SESSION, NODE),
      ]);
      expect(claims.filter((claimed) => claimed !== null)).toHaveLength(1);
      expect(claims.filter((claimed) => claimed === null)).toHaveLength(1);
      expect(claims.find((claimed) => claimed !== null)).toMatchObject({ taskId: 'task-1', attempt: 2, status: 'leased' });
    });

    it('rejects relay clock rollback and preserves the last accepted heartbeat time', async () => {
      const { service, store } = harness(factory);
      await service.register(SESSION, node());
      currentTime += 10_000;
      const acceptedAt = new Date(currentTime).toISOString();
      await service.heartbeat(SESSION, heartbeat(0));

      currentTime -= 1;
      await expect(service.heartbeat(SESSION, heartbeat(0))).rejects.toMatchObject({ code: 'clock_regression' });
      expect(await store.getNode(TENANT, NODE, acceptedAt)).toMatchObject({ lastSeenAt: acceptedAt, status: 'online' });
    });

    it('treats a forward clock jump as authoritative for lease expiry', async () => {
      const { service } = harness(factory);
      await service.register(SESSION, node());
      await service.enqueue(SESSION, task(1, { leaseMs: 1_000 }));
      expect(await service.claim(SESSION, NODE)).toMatchObject({ attempt: 1 });

      currentTime += 1_000;
      await service.heartbeat(SESSION, heartbeat(0));
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

    it('executes and completes once after 100 deliveries with the same idempotency keys', async () => {
      const { service, store } = harness(factory);
      await service.register(SESSION, node());

      const enqueues = await Promise.all(Array.from({ length: 100 }, () => service.enqueue(SESSION, task())));
      expect(enqueues.filter((result) => result.inserted)).toHaveLength(1);
      expect(enqueues.every((result) => result.task.taskId === 'task-1')).toBe(true);
      expect(await service.claim(SESSION, NODE)).toMatchObject({ taskId: 'task-1', attempt: 1 });
      expect(await service.claim(SESSION, NODE)).toBeNull();

      const starts = await Promise.all(Array.from({ length: 100 }, () => service.ack(SESSION, event(1, 1, 'started'))));
      const artifacts = await Promise.all(Array.from({ length: 100 }, () => service.event(SESSION, event(1, 2, 'artifact'))));
      const completions = await Promise.all(Array.from({ length: 100 }, () => service.complete(SESSION, event(1, 3, 'completed'))));

      expect(starts.filter((result) => result.inserted)).toHaveLength(1);
      expect(artifacts.filter((result) => result.inserted)).toHaveLength(1);
      expect(completions.filter((result) => result.inserted)).toHaveLength(1);
      expect(completions.every((result) => result.task.status === 'completed')).toBe(true);
      expect(await store.listEvents(TENANT, 'work-1')).toEqual([
        expect.objectContaining({ type: 'started', seq: 1 }),
        expect.objectContaining({ type: 'artifact', seq: 2 }),
        expect.objectContaining({ type: 'completed', seq: 3 }),
      ]);
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

    it('normalizes offset task expiry and refuses a claim at the exact millisecond boundary', async () => {
      const { service } = harness(factory);
      await service.register(SESSION, node());
      const expiresAt = new Date(currentTime + 3_600_500).toISOString().replace('Z', '+01:00');
      const queued = await service.enqueue(SESSION, task(1, { expiresAt }));
      expect(queued.task.expiresAt).toBe(new Date(currentTime + 500).toISOString());

      currentTime += 500;
      await service.heartbeat(SESSION, heartbeat(0));
      expect(await service.claim(SESSION, NODE)).toBeNull();
    });

    it('rejects a late event from a previous attempt after a retry is leased', async () => {
      const { service, store } = harness(factory);
      await service.register(SESSION, node());
      await service.enqueue(SESSION, task());
      await service.claim(SESSION, NODE);
      const previousAttemptAt = new Date(currentTime).toISOString();
      await service.stop(SESSION, 'task-1');

      currentTime += 100;
      await service.retry(SESSION, 'task-1', task(2, { workOrderId: 'work-1', originRef: 'origin-1' }));
      expect(await service.claim(SESSION, NODE)).toMatchObject({ taskId: 'task-2', attempt: 1, status: 'leased' });
      await expect(service.event(SESSION, event(1, 1, 'started', {
        eventId: 'event-late-old-attempt',
        idempotencyKey: 'event-late-old-attempt',
        occurredAt: previousAttemptAt,
      }))).rejects.toMatchObject({ code: 'invalid_transition' });
      expect(await store.listEvents(TENANT, 'work-1')).toHaveLength(0);
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
