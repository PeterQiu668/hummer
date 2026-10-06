import {
  FleetRejectedError,
  type EnqueueResult,
  type EventResult,
  type FleetNodeRecord,
  type FleetObject,
  type FleetStore,
  type FleetTaskRecord,
  type HeartbeatClaims,
  type NodeClaims,
  type RelayAuditEntry,
  type RunEventClaims,
  type TaskClaims,
} from './ports.js';
import { canonicalJson } from './canonical-json.js';

const key = (tenantId: string, id: string) => `${tenantId}\u0000${id}`;
const clone = <T>(value: T): T => structuredClone(value);

interface StoredEvent {
  claims: RunEventClaims;
  event: FleetObject;
}

export class MemoryFleetStore implements FleetStore {
  readonly #nodes = new Map<string, FleetNodeRecord>();
  readonly #tasks = new Map<string, FleetTaskRecord>();
  readonly #taskByIdempotency = new Map<string, string>();
  readonly #events = new Map<string, StoredEvent[]>();
  readonly #eventByIdempotency = new Map<string, EventResult>();
  readonly #audit: RelayAuditEntry[] = [];

  async registerNode(tenantId: string, manifest: FleetObject, claims: NodeClaims, now: string, offlineAfterMs: number): Promise<FleetNodeRecord> {
    const record: FleetNodeRecord = { ...claims, tenantIds: [...claims.tenantIds], tenantId, manifest: clone(manifest), status: 'online', lastSeenAt: now, offlineAfterMs };
    this.#nodes.set(key(tenantId, claims.nodeId), record);
    return clone(record);
  }

  async heartbeat(tenantId: string, claims: HeartbeatClaims, now: string): Promise<FleetNodeRecord> {
    const nodeKey = key(tenantId, claims.nodeId);
    const node = this.#nodes.get(nodeKey);
    if (!node) throw new FleetRejectedError('node_unknown', 'heartbeat node is not registered for this tenant');
    node.lastSeenAt = now;
    node.status = 'online';
    return clone(node);
  }

  async getNode(tenantId: string, nodeId: string, now: string): Promise<FleetNodeRecord | null> {
    const node = this.#nodes.get(key(tenantId, nodeId));
    if (!node) return null;
    this.refreshNode(node, now);
    return clone(node);
  }

  async enqueueTask(tenantId: string, envelope: FleetObject, claims: TaskClaims, retryOfTaskId: string | null, now: string): Promise<EnqueueResult> {
    if (Date.parse(claims.expiresAt) <= Date.parse(now)) throw new FleetRejectedError('task_expired', 'expired task cannot be queued');
    const duplicateTaskId = this.#taskByIdempotency.get(key(tenantId, claims.idempotencyKey));
    if (duplicateTaskId) {
      const duplicate = this.#tasks.get(key(tenantId, duplicateTaskId))!;
      if (canonicalJson(duplicate.envelope) !== canonicalJson(envelope)) {
        throw new FleetRejectedError('duplicate_delivery', 'idempotency key was reused with a different task envelope');
      }
      return { task: clone(duplicate), inserted: false };
    }
    const record: FleetTaskRecord = {
      ...claims,
      tenantId,
      envelope: clone(envelope),
      status: 'queued',
      attempt: 0,
      leaseOwnerNodeId: null,
      leaseExpiresAt: null,
      retryOfTaskId,
    };
    if (this.#tasks.has(key(tenantId, record.taskId))) throw new FleetRejectedError('duplicate_delivery', 'task id already exists');
    this.#tasks.set(key(tenantId, record.taskId), record);
    this.#taskByIdempotency.set(key(tenantId, record.idempotencyKey), record.taskId);
    if (retryOfTaskId) this.#audit.push({ tenantId, action: 'retry', taskId: record.taskId, actorRef: 'system:relay', at: now, detail: `retry-of:${retryOfTaskId}` });
    return { task: clone(record), inserted: true };
  }

  async claimTask(tenantId: string, nodeId: string, now: string): Promise<FleetTaskRecord | null> {
    const node = this.#nodes.get(key(tenantId, nodeId));
    if (!node) throw new FleetRejectedError('node_unknown', 'claiming node is not registered');
    this.refreshNode(node, now);
    if (node.status !== 'online') throw new FleetRejectedError('node_offline', 'offline node cannot claim tasks');
    this.recoverExpiredLeases(tenantId, now);
    const task = [...this.#tasks.values()].find((candidate) =>
      candidate.tenantId === tenantId && candidate.targetNodeId === nodeId && candidate.status === 'queued' && Date.parse(candidate.expiresAt) > Date.parse(now));
    if (!task) return null;
    task.status = 'leased';
    task.attempt += 1;
    task.leaseOwnerNodeId = nodeId;
    task.leaseExpiresAt = new Date(Date.parse(now) + task.leaseMs).toISOString();
    return clone(task);
  }

  async putEvent(tenantId: string, event: FleetObject, claims: RunEventClaims, now: string): Promise<EventResult> {
    const duplicate = this.#eventByIdempotency.get(key(tenantId, claims.idempotencyKey));
    if (duplicate) {
      const stored = (this.#events.get(key(tenantId, claims.workOrderId)) ?? [])
        .find((entry) => entry.claims.idempotencyKey === claims.idempotencyKey);
      if (!stored || canonicalJson(stored.event) !== canonicalJson(event)) {
        throw new FleetRejectedError('duplicate_delivery', 'idempotency key was reused with a different run event');
      }
      return { inserted: false, task: clone(duplicate.task) };
    }
    const node = this.#nodes.get(key(tenantId, claims.nodeId));
    if (!node) throw new FleetRejectedError('node_unknown', 'event node is not registered');
    this.refreshNode(node, now);
    if (node.status !== 'online') throw new FleetRejectedError('node_offline', 'offline node cannot append run events');
    const task = [...this.#tasks.values()].reverse().find((candidate) => candidate.tenantId === tenantId && candidate.workOrderId === claims.workOrderId);
    if (!task) throw new FleetRejectedError('invalid_transition', 'event work order is not queued');
    this.assertActiveLease(task, claims.nodeId, now);
    const events = this.#events.get(key(tenantId, claims.workOrderId)) ?? [];
    const expectedSeq = events.length + 1;
    if (claims.seq !== expectedSeq) throw new FleetRejectedError('sequence_gap', `expected event sequence ${expectedSeq}`);
    if (claims.type === 'completed' && !events.some((entry) => entry.claims.type === 'artifact')) {
      throw new FleetRejectedError('invalid_transition', 'completed requires at least one artifact event');
    }
    events.push({ claims: clone(claims), event: clone(event) });
    this.#events.set(key(tenantId, claims.workOrderId), events);
    if (claims.type === 'completed') task.status = 'completed';
    else if (claims.type === 'failed') task.status = 'failed';
    else if (claims.type === 'cancelled' || claims.type === 'needs_approval') task.status = 'blocked';
    if (task.status !== 'leased') {
      task.leaseOwnerNodeId = null;
      task.leaseExpiresAt = null;
    }
    const result = { inserted: true, task: clone(task) };
    this.#eventByIdempotency.set(key(tenantId, claims.idempotencyKey), result);
    return result;
  }

  async stopTask(tenantId: string, taskId: string, actorRef: string, now: string): Promise<FleetTaskRecord> {
    const task = this.#tasks.get(key(tenantId, taskId));
    if (!task) throw new FleetRejectedError('invalid_transition', 'task was not found');
    if (task.status === 'completed' || task.status === 'failed') throw new FleetRejectedError('invalid_transition', 'terminal task cannot be stopped');
    task.status = 'blocked';
    task.leaseOwnerNodeId = null;
    task.leaseExpiresAt = null;
    this.#audit.push({ tenantId, action: 'stop', taskId, actorRef, at: now, detail: 'task-blocked' });
    return clone(task);
  }

  async getTask(tenantId: string, taskId: string, now: string): Promise<FleetTaskRecord | null> {
    this.recoverExpiredLeases(tenantId, now);
    const task = this.#tasks.get(key(tenantId, taskId));
    return task ? clone(task) : null;
  }

  async listEvents(tenantId: string, workOrderId: string): Promise<readonly RunEventClaims[]> {
    return clone((this.#events.get(key(tenantId, workOrderId)) ?? []).map((entry) => entry.claims));
  }

  async listAudit(tenantId: string): Promise<readonly RelayAuditEntry[]> {
    return clone(this.#audit.filter((entry) => entry.tenantId === tenantId));
  }

  close(): void {}

  private refreshNode(node: FleetNodeRecord, now: string): void {
    if (Date.parse(now) - Date.parse(node.lastSeenAt) > node.offlineAfterMs) node.status = 'offline';
  }

  private recoverExpiredLeases(tenantId: string, now: string): void {
    for (const task of this.#tasks.values()) {
      if (task.tenantId === tenantId && task.status === 'leased' && task.leaseExpiresAt && Date.parse(task.leaseExpiresAt) <= Date.parse(now)) {
        task.status = 'queued';
        task.leaseOwnerNodeId = null;
        task.leaseExpiresAt = null;
      }
    }
  }

  private assertActiveLease(task: FleetTaskRecord, nodeId: string, now: string): void {
    if (task.status !== 'leased' || !task.leaseExpiresAt) throw new FleetRejectedError('invalid_transition', 'task has no active lease');
    if (task.leaseOwnerNodeId !== nodeId) throw new FleetRejectedError('lease_owner_mismatch', 'event node does not own the task lease');
    if (Date.parse(task.leaseExpiresAt) <= Date.parse(now)) {
      task.status = 'queued';
      task.leaseOwnerNodeId = null;
      task.leaseExpiresAt = null;
      throw new FleetRejectedError('lease_expired', 'task lease has expired');
    }
  }
}
