import { createRequire } from 'node:module';
import { canonicalJson } from './canonical-json.js';
import { assertEventWithinLease, canonicalUtcTimestamp } from './relay-time.js';
import { assertNodeTenantAuthorization } from './tenant-boundary.js';
import {
  FleetRejectedError,
  type ApprovalBundle,
  type ApprovalDecisionClaims,
  type ApprovalDecisionRecord,
  type ApprovalRequestClaims,
  type ApprovalRequestRecord,
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

interface RunResult { changes: number; lastInsertRowid: number | bigint }
interface Statement {
  run(...params: unknown[]): RunResult;
  get<T = unknown>(...params: unknown[]): T | undefined;
  all<T = unknown>(...params: unknown[]): T[];
}
interface SqliteDatabase {
  close(): void;
  exec(sql: string): void;
  pragma(source: string): unknown;
  prepare(sql: string): Statement;
  transaction<T>(fn: () => T): () => T;
}
interface SqliteConstructor { new(path: string): SqliteDatabase }

interface NodeRow {
  tenant_id: string;
  node_id: string;
  tenant_ids_json: string;
  agent_version: string;
  manifest_json: string;
  status: 'online' | 'offline';
  last_seen_at: string;
  offline_after_ms: number;
}

interface TaskRow {
  tenant_id: string;
  task_id: string;
  work_order_id: string;
  envelope_json: string;
  target_node_id: string;
  target_runtime: string;
  idempotency_key: string;
  lease_ms: number;
  expires_at: string;
  origin_ref: string;
  status: FleetTaskRecord['status'];
  attempt: number;
  retry_of_task_id: string | null;
  lease_owner_node_id: string | null;
  lease_expires_at: string | null;
}

interface EventRow {
  event_id: string;
  tenant_id: string;
  work_order_id: string;
  node_id: string;
  seq: number;
  occurred_at: string;
  type: RunEventClaims['type'];
  idempotency_key: string;
  event_json: string;
}

interface ApprovalRequestRow {
  tenant_id: string;
  request_id: string;
  task_id: string;
  work_order_id: string;
  node_id: string;
  run_id: string;
  risk_class: string;
  action: string;
  target: string;
  requested_scope_json: string;
  expires_at: string;
  requested_by: string;
  request_json: string;
  created_at: string;
}

interface ApprovalDecisionRow {
  tenant_id: string;
  decision_id: string;
  request_id: string;
  decider_actor_ref: string;
  decided_at: string;
  decision: ApprovalDecisionClaims['decision'];
  granted_scope_json: string | null;
  decision_json: string;
  created_at: string;
}

export const RELAY_SCHEMA_VERSION = 13;

function openDatabase(path: string): SqliteDatabase {
  const require = createRequire(import.meta.url);
  const loaded = require('better-sqlite3') as SqliteConstructor | { default: SqliteConstructor };
  const Constructor = typeof loaded === 'function' ? loaded : loaded.default;
  const database = new Constructor(path);
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  database.pragma('busy_timeout = 5000');
  return database;
}

function jsonObject(serialized: string): FleetObject {
  return JSON.parse(serialized) as FleetObject;
}

function toNode(row: NodeRow): FleetNodeRecord {
  return {
    tenantId: row.tenant_id,
    nodeId: row.node_id,
    tenantIds: JSON.parse(row.tenant_ids_json) as string[],
    agentVersion: row.agent_version,
    manifest: jsonObject(row.manifest_json),
    status: row.status,
    lastSeenAt: row.last_seen_at,
    offlineAfterMs: row.offline_after_ms,
  };
}

function toTask(row: TaskRow): FleetTaskRecord {
  return {
    tenantId: row.tenant_id,
    taskId: row.task_id,
    workOrderId: row.work_order_id,
    envelope: jsonObject(row.envelope_json),
    targetNodeId: row.target_node_id,
    targetRuntime: row.target_runtime,
    idempotencyKey: row.idempotency_key,
    leaseMs: row.lease_ms,
    expiresAt: row.expires_at,
    originRef: row.origin_ref,
    status: row.status,
    attempt: row.attempt,
    retryOfTaskId: row.retry_of_task_id,
    leaseOwnerNodeId: row.lease_owner_node_id,
    leaseExpiresAt: row.lease_expires_at,
  };
}

function toApprovalRequest(row: ApprovalRequestRow): ApprovalRequestRecord {
  return {
    requestId: row.request_id,
    tenantId: row.tenant_id,
    taskId: row.task_id,
    workOrderId: row.work_order_id,
    nodeId: row.node_id,
    runId: row.run_id,
    riskClass: row.risk_class,
    action: row.action,
    target: row.target,
    requestedScope: JSON.parse(row.requested_scope_json) as ApprovalRequestClaims['requestedScope'],
    expiresAt: row.expires_at,
    requestedBy: row.requested_by,
    request: jsonObject(row.request_json),
    createdAt: row.created_at,
  };
}

function toApprovalDecision(row: ApprovalDecisionRow): ApprovalDecisionRecord {
  return {
    decisionId: row.decision_id,
    requestId: row.request_id,
    tenantId: row.tenant_id,
    deciderActorRef: row.decider_actor_ref,
    decidedAt: row.decided_at,
    decision: row.decision,
    ...(row.granted_scope_json
      ? { grantedScope: JSON.parse(row.granted_scope_json) as NonNullable<ApprovalDecisionClaims['grantedScope']> }
      : {}),
    decisionRecord: jsonObject(row.decision_json),
    createdAt: row.created_at,
  };
}

function isSubset(granted: readonly string[] | undefined, requested: readonly string[] | undefined): boolean {
  if (!granted) return true;
  if (!requested) return false;
  const allowed = new Set(requested);
  return granted.every((value) => allowed.has(value));
}

function assertDecisionWithinRequest(
  request: ApprovalRequestRecord,
  decision: ApprovalDecisionClaims,
  now: string,
): void {
  if (Date.parse(request.expiresAt) <= Date.parse(now)) {
    throw new FleetRejectedError('approval_expired', 'approval request has expired');
  }
  const decidedAt = Date.parse(decision.decidedAt);
  if (!Number.isFinite(decidedAt) || decidedAt > Date.parse(now) || decidedAt < Date.parse(request.createdAt)) {
    throw new FleetRejectedError('invalid_contract', 'approval decision time is outside the request lifetime');
  }
  if (decision.decision !== 'approved') return;
  const granted = decision.grantedScope;
  if (!granted || !isSubset(granted.capabilities, request.requestedScope.capabilities)
    || !isSubset(granted.paths, request.requestedScope.paths)
    || (request.requestedScope.maxUses !== undefined && (granted.maxUses ?? 1) > request.requestedScope.maxUses)) {
    throw new FleetRejectedError('approval_scope_exceeded', 'approval grant exceeds the requested scope');
  }
  const grantedExpiry = Date.parse(granted.expiresAt);
  if (!Number.isFinite(grantedExpiry) || grantedExpiry <= Date.parse(now) || grantedExpiry > Date.parse(request.expiresAt)) {
    throw new FleetRejectedError('approval_expired', 'approval grant expiry is outside the request lifetime');
  }
}

export class SqliteFleetStore implements FleetStore {
  readonly #db: SqliteDatabase;

  constructor(path = ':memory:') {
    this.#db = openDatabase(path);
    this.migrate();
  }

  async registerNode(
    tenantId: string,
    manifest: FleetObject,
    claims: NodeClaims,
    authorizedTenantIds: readonly string[],
    tenantGrantRef: string | undefined,
    now: string,
    offlineAfterMs: number,
  ): Promise<FleetNodeRecord> {
    this.advanceClock(now);
    assertNodeTenantAuthorization(tenantId, claims.tenantIds, authorizedTenantIds, tenantGrantRef);
    this.#db.prepare(`
      INSERT INTO fleet_nodes (tenant_id, node_id, tenant_ids_json, agent_version, manifest_json, last_seen_at, status, offline_after_ms)
      VALUES (?, ?, ?, ?, ?, ?, 'online', ?)
      ON CONFLICT (tenant_id, node_id) DO UPDATE SET
        tenant_ids_json = excluded.tenant_ids_json,
        agent_version = excluded.agent_version,
        manifest_json = excluded.manifest_json,
        last_seen_at = excluded.last_seen_at,
        status = 'online',
        offline_after_ms = excluded.offline_after_ms
    `).run(tenantId, claims.nodeId, JSON.stringify(claims.tenantIds), claims.agentVersion, JSON.stringify(manifest), now, offlineAfterMs);
    return this.requireNode(tenantId, claims.nodeId);
  }

  async heartbeat(tenantId: string, claims: HeartbeatClaims, now: string): Promise<FleetNodeRecord> {
    this.advanceClock(now);
    return this.#db.transaction(() => {
      const node = this.#db.prepare('SELECT 1 AS present FROM fleet_nodes WHERE tenant_id = ? AND node_id = ?')
        .get<{ present: number }>(tenantId, claims.nodeId);
      if (!node) throw new FleetRejectedError('node_unknown', 'heartbeat node is not registered for this tenant');
      this.recoverExpiredLeases(tenantId, now);
      const active = this.#db.prepare(`
        SELECT COUNT(*) AS count FROM fleet_tasks
        WHERE tenant_id = ? AND lease_owner_node_id = ? AND status = 'leased'
          AND julianday(lease_expires_at) > julianday(?)
      `).get<{ count: number }>(tenantId, claims.nodeId, now);
      const activeLeases = active?.count ?? 0;
      if (claims.running !== activeLeases) {
        throw new FleetRejectedError(
          'heartbeat_load_mismatch',
          `heartbeat reports ${claims.running} running tasks but Relay has ${activeLeases} active leases`,
        );
      }
      this.#db.prepare(`UPDATE fleet_nodes SET last_seen_at = ?, status = 'online' WHERE tenant_id = ? AND node_id = ?`)
        .run(now, tenantId, claims.nodeId);
      return this.requireNode(tenantId, claims.nodeId);
    })();
  }

  async getNode(tenantId: string, nodeId: string, now: string): Promise<FleetNodeRecord | null> {
    this.advanceClock(now);
    this.refreshNode(tenantId, nodeId, now);
    const row = this.#db.prepare('SELECT * FROM fleet_nodes WHERE tenant_id = ? AND node_id = ?').get<NodeRow>(tenantId, nodeId);
    return row ? toNode(row) : null;
  }

  async enqueueTask(tenantId: string, envelope: FleetObject, claims: TaskClaims, retryOfTaskId: string | null, now: string): Promise<EnqueueResult> {
    this.advanceClock(now);
    const expiresAt = canonicalUtcTimestamp(claims.expiresAt, 'task expiresAt');
    if (Date.parse(expiresAt) <= Date.parse(now)) throw new FleetRejectedError('task_expired', 'expired task cannot be queued');
    const duplicate = this.#db.prepare('SELECT * FROM fleet_tasks WHERE tenant_id = ? AND idempotency_key = ?')
      .get<TaskRow>(tenantId, claims.idempotencyKey);
    if (duplicate) {
      if (canonicalJson(jsonObject(duplicate.envelope_json)) !== canonicalJson(envelope)) {
        throw new FleetRejectedError('duplicate_delivery', 'idempotency key was reused with a different task envelope');
      }
      return { task: toTask(duplicate), inserted: false };
    }
    try {
      this.#db.transaction(() => {
        this.#db.prepare(`
          INSERT INTO fleet_tasks (
            tenant_id, task_id, work_order_id, envelope_json, target_node_id, target_runtime,
            idempotency_key, lease_ms, expires_at, origin_ref, status, attempt, retry_of_task_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?)
        `).run(
          tenantId, claims.taskId, claims.workOrderId, JSON.stringify(envelope), claims.targetNodeId,
          claims.targetRuntime, claims.idempotencyKey, claims.leaseMs, expiresAt, claims.originRef, retryOfTaskId,
        );
        this.#db.prepare(`
          INSERT INTO fleet_task_leases (
            tenant_id, task_id, node_id, delivery_id, idempotency_key, envelope_json,
            state, lease_expires_at, attempt, result_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'queued', NULL, 0, NULL, ?, ?)
        `).run(
          tenantId, claims.taskId, claims.targetNodeId, claims.taskId, claims.idempotencyKey,
          JSON.stringify(envelope), now, now,
        );
        if (retryOfTaskId) {
          this.insertAudit({ tenantId, action: 'retry', taskId: claims.taskId, actorRef: 'system:relay', at: now, detail: `retry-of:${retryOfTaskId}` });
        }
      })();
    } catch (error) {
      const raced = this.#db.prepare('SELECT * FROM fleet_tasks WHERE tenant_id = ? AND idempotency_key = ?')
        .get<TaskRow>(tenantId, claims.idempotencyKey);
      if (raced) {
        if (canonicalJson(jsonObject(raced.envelope_json)) !== canonicalJson(envelope)) {
          throw new FleetRejectedError('duplicate_delivery', 'idempotency key was reused with a different task envelope');
        }
        return { task: toTask(raced), inserted: false };
      }
      throw new FleetRejectedError('duplicate_delivery', error instanceof Error ? error.message : 'task id already exists');
    }
    return { task: this.requireTask(tenantId, claims.taskId), inserted: true };
  }

  async claimTask(tenantId: string, nodeId: string, now: string): Promise<FleetTaskRecord | null> {
    this.advanceClock(now);
    return this.#db.transaction(() => {
      this.refreshNode(tenantId, nodeId, now);
      const node = this.#db.prepare('SELECT * FROM fleet_nodes WHERE tenant_id = ? AND node_id = ?').get<NodeRow>(tenantId, nodeId);
      if (!node) throw new FleetRejectedError('node_unknown', 'claiming node is not registered');
      if (node.status !== 'online') throw new FleetRejectedError('node_offline', 'offline node cannot claim tasks');
      this.recoverExpiredLeases(tenantId, now);
      const candidate = this.#db.prepare(`
        SELECT * FROM fleet_tasks
        WHERE tenant_id = ? AND target_node_id = ? AND status = 'queued'
          AND julianday(expires_at) > julianday(?)
        ORDER BY rowid ASC LIMIT 1
      `).get<TaskRow>(tenantId, nodeId, now);
      if (!candidate) return null;
      const leaseExpiresAt = new Date(Date.parse(now) + candidate.lease_ms).toISOString();
      const claimed = this.#db.prepare(`
        UPDATE fleet_tasks SET status = 'leased', attempt = attempt + 1,
          lease_owner_node_id = ?, lease_expires_at = ?
        WHERE tenant_id = ? AND task_id = ? AND status = 'queued'
      `).run(nodeId, leaseExpiresAt, tenantId, candidate.task_id);
      if (claimed.changes !== 1) return null;
      const leased = this.requireTask(tenantId, candidate.task_id);
      this.#db.prepare(`
        UPDATE fleet_task_leases
        SET node_id = ?, state = 'leased', lease_expires_at = ?, attempt = ?, updated_at = ?
        WHERE tenant_id = ? AND task_id = ?
      `).run(nodeId, leaseExpiresAt, leased.attempt, now, tenantId, leased.taskId);
      return leased;
    })();
  }

  async putEvent(tenantId: string, event: FleetObject, claims: RunEventClaims, now: string): Promise<EventResult> {
    this.advanceClock(now);
    return this.#db.transaction(() => {
      const duplicate = this.#db.prepare('SELECT * FROM fleet_run_events WHERE tenant_id = ? AND idempotency_key = ?')
        .get<EventRow>(tenantId, claims.idempotencyKey);
      if (duplicate) {
        if (canonicalJson(jsonObject(duplicate.event_json)) !== canonicalJson(event)) {
          throw new FleetRejectedError('duplicate_delivery', 'idempotency key was reused with a different run event');
        }
        return { inserted: false, task: this.requireTaskByWorkOrder(tenantId, duplicate.work_order_id) };
      }
      this.refreshNode(tenantId, claims.nodeId, now);
      const node = this.#db.prepare('SELECT * FROM fleet_nodes WHERE tenant_id = ? AND node_id = ?').get<NodeRow>(tenantId, claims.nodeId);
      if (!node) throw new FleetRejectedError('node_unknown', 'event node is not registered');
      if (node.status !== 'online') throw new FleetRejectedError('node_offline', 'offline node cannot append run events');
      const task = this.requireTaskByWorkOrder(tenantId, claims.workOrderId);
      this.assertActiveLease(task, claims.nodeId, now);
      assertEventWithinLease(claims.occurredAt, now, task.leaseExpiresAt!, task.leaseMs);
      const last = this.#db.prepare('SELECT MAX(seq) AS seq FROM fleet_run_events WHERE tenant_id = ? AND work_order_id = ?')
        .get<{ seq: number | null }>(tenantId, claims.workOrderId);
      const expectedSeq = (last?.seq ?? 0) + 1;
      if (claims.seq !== expectedSeq) throw new FleetRejectedError('sequence_gap', `expected event sequence ${expectedSeq}`);
      if (claims.type === 'completed') {
        const artifact = this.#db.prepare(`SELECT 1 AS present FROM fleet_run_events WHERE tenant_id = ? AND work_order_id = ? AND type = 'artifact' LIMIT 1`)
          .get<{ present: number }>(tenantId, claims.workOrderId);
        if (!artifact) throw new FleetRejectedError('invalid_transition', 'completed requires at least one artifact event');
      }
      this.#db.prepare(`
        INSERT INTO fleet_run_events (tenant_id, event_id, work_order_id, node_id, seq, occurred_at, type, idempotency_key, event_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(tenantId, claims.eventId, claims.workOrderId, claims.nodeId, claims.seq, claims.occurredAt, claims.type, claims.idempotencyKey, JSON.stringify(event));
      const status = claims.type === 'completed' ? 'completed'
        : claims.type === 'failed' ? 'failed'
          : claims.type === 'cancelled' || claims.type === 'needs_approval' ? 'blocked'
            : 'leased';
      if (status === 'leased') {
        this.#db.prepare('UPDATE fleet_tasks SET status = ? WHERE tenant_id = ? AND task_id = ?').run(status, tenantId, task.taskId);
        this.#db.prepare('UPDATE fleet_task_leases SET state = ?, updated_at = ? WHERE tenant_id = ? AND task_id = ?')
          .run(status, now, tenantId, task.taskId);
      } else {
        this.#db.prepare(`UPDATE fleet_tasks SET status = ?, lease_owner_node_id = NULL, lease_expires_at = NULL WHERE tenant_id = ? AND task_id = ?`)
          .run(status, tenantId, task.taskId);
        this.#db.prepare(`
          UPDATE fleet_task_leases
          SET state = ?, lease_expires_at = NULL, result_json = ?, updated_at = ?
          WHERE tenant_id = ? AND task_id = ?
        `).run(status, JSON.stringify(event), now, tenantId, task.taskId);
      }
      return { inserted: true, task: this.requireTask(tenantId, task.taskId) };
    })();
  }

  async stopTask(tenantId: string, taskId: string, actorRef: string, now: string): Promise<FleetTaskRecord> {
    this.advanceClock(now);
    return this.#db.transaction(() => {
      const task = this.requireTask(tenantId, taskId);
      if (task.status === 'completed' || task.status === 'failed') throw new FleetRejectedError('invalid_transition', 'terminal task cannot be stopped');
      this.#db.prepare(`UPDATE fleet_tasks SET status = 'blocked', lease_owner_node_id = NULL, lease_expires_at = NULL WHERE tenant_id = ? AND task_id = ?`)
        .run(tenantId, taskId);
      this.#db.prepare(`UPDATE fleet_task_leases SET state = 'blocked', lease_expires_at = NULL, updated_at = ? WHERE tenant_id = ? AND task_id = ?`)
        .run(now, tenantId, taskId);
      this.insertAudit({ tenantId, action: 'stop', taskId, actorRef, at: now, detail: 'task-blocked' });
      return this.requireTask(tenantId, taskId);
    })();
  }

  async getTask(tenantId: string, taskId: string, now: string): Promise<FleetTaskRecord | null> {
    this.advanceClock(now);
    const recovered = this.#db.prepare(`UPDATE fleet_tasks SET status = 'queued', lease_owner_node_id = NULL, lease_expires_at = NULL
      WHERE tenant_id = ? AND task_id = ? AND status = 'leased'
        AND julianday(lease_expires_at) <= julianday(?)`).run(tenantId, taskId, now);
    if (recovered.changes > 0) {
      this.#db.prepare(`UPDATE fleet_task_leases SET state = 'queued', lease_expires_at = NULL, updated_at = ? WHERE tenant_id = ? AND task_id = ?`)
        .run(now, tenantId, taskId);
    }
    const row = this.#db.prepare('SELECT * FROM fleet_tasks WHERE tenant_id = ? AND task_id = ?').get<TaskRow>(tenantId, taskId);
    return row ? toTask(row) : null;
  }

  async putApprovalRequest(
    tenantId: string,
    taskId: string,
    request: FleetObject,
    claims: ApprovalRequestClaims,
    now: string,
  ): Promise<ApprovalRequestRecord> {
    this.advanceClock(now);
    return this.#db.transaction(() => {
      if (Date.parse(claims.expiresAt) <= Date.parse(now)) {
        throw new FleetRejectedError('approval_expired', 'expired approval request cannot be recorded');
      }
      const task = this.requireTask(tenantId, taskId);
      this.assertActiveLease(task, claims.nodeId, now);
      if (task.workOrderId !== claims.workOrderId || task.leaseOwnerNodeId !== claims.nodeId) {
        throw new FleetRejectedError('lease_owner_mismatch', 'approval request does not match the pending claim');
      }
      const existing = this.#db.prepare(`
        SELECT request_id FROM fleet_approval_requests
        WHERE tenant_id = ? AND (request_id = ? OR task_id = ?) LIMIT 1
      `).get<{ request_id: string }>(tenantId, claims.requestId, taskId);
      if (existing) throw new FleetRejectedError('approval_replayed', 'pending claim already has an approval request');
      this.#db.prepare(`
        INSERT INTO fleet_approval_requests (
          tenant_id, request_id, task_id, work_order_id, node_id, run_id, risk_class,
          action, target, requested_scope_json, expires_at, requested_by, request_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        tenantId, claims.requestId, taskId, claims.workOrderId, claims.nodeId, claims.runId,
        claims.riskClass, claims.action, claims.target, JSON.stringify(claims.requestedScope),
        claims.expiresAt, claims.requestedBy, JSON.stringify(request), now,
      );
      return this.requireApprovalRequest(tenantId, claims.requestId);
    })();
  }

  async putApprovalDecision(
    tenantId: string,
    decision: FleetObject,
    claims: ApprovalDecisionClaims,
    now: string,
  ): Promise<ApprovalDecisionRecord> {
    this.advanceClock(now);
    return this.#db.transaction(() => {
      const request = this.findApprovalRequest(tenantId, claims.requestId);
      if (!request) throw new FleetRejectedError('approval_not_found', 'approval request was not found');
      const existing = this.#db.prepare(`
        SELECT decision_id FROM fleet_approval_decisions
        WHERE tenant_id = ? AND (request_id = ? OR decision_id = ?) LIMIT 1
      `).get<{ decision_id: string }>(tenantId, claims.requestId, claims.decisionId);
      if (existing) throw new FleetRejectedError('approval_replayed', 'approval request already has an immutable decision');
      assertDecisionWithinRequest(request, claims, now);
      this.#db.prepare(`
        INSERT INTO fleet_approval_decisions (
          tenant_id, decision_id, request_id, decider_actor_ref, decided_at, decision,
          granted_scope_json, decision_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        tenantId, claims.decisionId, claims.requestId, claims.deciderActorRef, claims.decidedAt,
        claims.decision, claims.grantedScope ? JSON.stringify(claims.grantedScope) : null,
        JSON.stringify(decision), now,
      );
      return this.requireApprovalDecision(tenantId, claims.requestId);
    })();
  }

  async consumeApprovalDecision(
    tenantId: string,
    nodeId: string,
    taskId: string,
    requestId: string,
    now: string,
  ): Promise<ApprovalBundle> {
    this.advanceClock(now);
    return this.#db.transaction(() => {
      const request = this.findApprovalRequest(tenantId, requestId);
      if (!request || request.taskId !== taskId) {
        throw new FleetRejectedError('approval_not_found', 'approval request is not bound to this claim');
      }
      if (request.nodeId !== nodeId) {
        throw new FleetRejectedError('lease_owner_mismatch', 'approval request is not bound to this node');
      }
      const task = this.requireTask(tenantId, taskId);
      this.assertActiveLease(task, nodeId, now);
      const decision = this.findApprovalDecision(tenantId, requestId);
      if (!decision) throw new FleetRejectedError('approval_not_found', 'approval decision is not available');
      if (decision.decision !== 'approved') {
        throw new FleetRejectedError('invalid_transition', 'approval decision does not authorize execution');
      }
      assertDecisionWithinRequest(request, decision, now);
      const consumed = this.#db.prepare(`
        SELECT 1 AS present FROM fleet_approval_consumptions WHERE tenant_id = ? AND request_id = ?
      `).get<{ present: number }>(tenantId, requestId);
      if (consumed) throw new FleetRejectedError('approval_replayed', 'approval decision was already consumed');
      this.#db.prepare(`
        INSERT INTO fleet_approval_consumptions (
          tenant_id, request_id, decision_id, task_id, node_id, run_id, consumed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(tenantId, requestId, decision.decisionId, taskId, nodeId, request.runId, now);
      return { request: request.request, decision: decision.decisionRecord };
    })();
  }

  async getApprovalRequest(tenantId: string, requestId: string): Promise<ApprovalRequestRecord | null> {
    return this.findApprovalRequest(tenantId, requestId);
  }

  async getApprovalDecision(tenantId: string, requestId: string): Promise<ApprovalDecisionRecord | null> {
    return this.findApprovalDecision(tenantId, requestId);
  }

  async listEvents(tenantId: string, workOrderId: string): Promise<readonly RunEventClaims[]> {
    return this.#db.prepare(`SELECT event_id, tenant_id, work_order_id, node_id, seq, occurred_at, type, idempotency_key, event_json
      FROM fleet_run_events WHERE tenant_id = ? AND work_order_id = ? ORDER BY seq`)
      .all<EventRow>(tenantId, workOrderId)
      .map((row) => ({
        eventId: row.event_id,
        tenantId: row.tenant_id,
        workOrderId: row.work_order_id,
        nodeId: row.node_id,
        seq: row.seq,
        occurredAt: row.occurred_at,
        type: row.type,
        idempotencyKey: row.idempotency_key,
      }));
  }

  async listAudit(tenantId: string): Promise<readonly RelayAuditEntry[]> {
    return this.#db.prepare(`SELECT tenant_id, action, task_id, actor_ref, at, detail FROM relay_audit WHERE tenant_id = ? ORDER BY rowid`)
      .all<{ tenant_id: string; action: RelayAuditEntry['action']; task_id: string; actor_ref: string; at: string; detail: string }>(tenantId)
      .map((row) => ({ tenantId: row.tenant_id, action: row.action, taskId: row.task_id, actorRef: row.actor_ref, at: row.at, detail: row.detail }));
  }

  close(): void {
    this.#db.close();
  }

  private migrate(): void {
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS relay_schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS relay_clock (
        singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
        high_water_at TEXT NOT NULL
      );
      INSERT OR IGNORE INTO relay_clock (singleton_id, high_water_at) VALUES (1, '1970-01-01T00:00:00.000Z');
      CREATE TABLE IF NOT EXISTS fleet_nodes (
        tenant_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        tenant_ids_json TEXT NOT NULL,
        agent_version TEXT NOT NULL,
        manifest_json TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('online', 'offline')),
        offline_after_ms INTEGER NOT NULL,
        PRIMARY KEY (tenant_id, node_id)
      );
      CREATE INDEX IF NOT EXISTS fleet_nodes_status ON fleet_nodes (tenant_id, status, last_seen_at);
      CREATE TABLE IF NOT EXISTS fleet_tasks (
        tenant_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        work_order_id TEXT NOT NULL,
        envelope_json TEXT NOT NULL,
        target_node_id TEXT NOT NULL,
        target_runtime TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        lease_ms INTEGER NOT NULL,
        expires_at TEXT NOT NULL,
        origin_ref TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('queued', 'leased', 'blocked', 'completed', 'failed')),
        attempt INTEGER NOT NULL,
        retry_of_task_id TEXT,
        lease_owner_node_id TEXT,
        lease_expires_at TEXT,
        PRIMARY KEY (tenant_id, task_id),
        UNIQUE (tenant_id, idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS fleet_tasks_claim ON fleet_tasks (tenant_id, target_node_id, status, expires_at);
      CREATE TABLE IF NOT EXISTS fleet_task_leases (
        tenant_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        delivery_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        envelope_json TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('queued', 'leased', 'blocked', 'completed', 'failed')),
        lease_expires_at TEXT,
        attempt INTEGER NOT NULL,
        result_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, task_id),
        UNIQUE (tenant_id, idempotency_key),
        UNIQUE (tenant_id, delivery_id),
        FOREIGN KEY (tenant_id, task_id) REFERENCES fleet_tasks (tenant_id, task_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS fleet_task_leases_claim ON fleet_task_leases (tenant_id, node_id, state, lease_expires_at);
      CREATE TABLE IF NOT EXISTS fleet_run_events (
        tenant_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        work_order_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        occurred_at TEXT NOT NULL,
        type TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        event_json TEXT NOT NULL,
        PRIMARY KEY (tenant_id, event_id),
        UNIQUE (tenant_id, idempotency_key),
        UNIQUE (tenant_id, work_order_id, seq)
      );
      CREATE TABLE IF NOT EXISTS fleet_approval_requests (
        tenant_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        work_order_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        risk_class TEXT NOT NULL,
        action TEXT NOT NULL,
        target TEXT NOT NULL,
        requested_scope_json TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        requested_by TEXT NOT NULL,
        request_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, request_id),
        UNIQUE (tenant_id, task_id),
        FOREIGN KEY (tenant_id, task_id) REFERENCES fleet_tasks (tenant_id, task_id)
      );
      CREATE INDEX IF NOT EXISTS fleet_approval_requests_binding
        ON fleet_approval_requests (tenant_id, task_id, node_id, run_id, expires_at);
      CREATE TABLE IF NOT EXISTS fleet_approval_decisions (
        tenant_id TEXT NOT NULL,
        decision_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        decider_actor_ref TEXT NOT NULL,
        decided_at TEXT NOT NULL,
        decision TEXT NOT NULL CHECK (decision IN ('approved', 'denied', 'expired', 'revoked')),
        granted_scope_json TEXT,
        decision_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, decision_id),
        UNIQUE (tenant_id, request_id),
        FOREIGN KEY (tenant_id, request_id) REFERENCES fleet_approval_requests (tenant_id, request_id)
      );
      CREATE TABLE IF NOT EXISTS fleet_approval_consumptions (
        tenant_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        decision_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        consumed_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, request_id),
        UNIQUE (tenant_id, decision_id),
        FOREIGN KEY (tenant_id, request_id) REFERENCES fleet_approval_requests (tenant_id, request_id),
        FOREIGN KEY (tenant_id, decision_id) REFERENCES fleet_approval_decisions (tenant_id, decision_id)
      );
      CREATE TRIGGER IF NOT EXISTS fleet_approval_requests_no_update
        BEFORE UPDATE ON fleet_approval_requests BEGIN SELECT RAISE(ABORT, 'approval requests are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS fleet_approval_requests_no_delete
        BEFORE DELETE ON fleet_approval_requests BEGIN SELECT RAISE(ABORT, 'approval requests are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS fleet_approval_decisions_no_update
        BEFORE UPDATE ON fleet_approval_decisions BEGIN SELECT RAISE(ABORT, 'approval decisions are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS fleet_approval_decisions_no_delete
        BEFORE DELETE ON fleet_approval_decisions BEGIN SELECT RAISE(ABORT, 'approval decisions are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS fleet_approval_consumptions_no_update
        BEFORE UPDATE ON fleet_approval_consumptions BEGIN SELECT RAISE(ABORT, 'approval consumptions are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS fleet_approval_consumptions_no_delete
        BEFORE DELETE ON fleet_approval_consumptions BEGIN SELECT RAISE(ABORT, 'approval consumptions are append-only'); END;
      CREATE TABLE IF NOT EXISTS relay_audit (
        tenant_id TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('stop', 'retry')),
        task_id TEXT NOT NULL,
        actor_ref TEXT NOT NULL,
        at TEXT NOT NULL,
        detail TEXT NOT NULL
      );
    `);
    const migration = this.#db.prepare('INSERT OR IGNORE INTO relay_schema_migrations (version, name, applied_at) VALUES (?, ?, ?)');
    migration.run(11, 'fleet_relay_nodes_tasks_leases', new Date(0).toISOString());
    migration.run(12, 'relay_monotonic_clock', new Date(0).toISOString());
    migration.run(RELAY_SCHEMA_VERSION, 'relay_append_only_approval_binding', new Date(0).toISOString());
  }

  private advanceClock(now: string): void {
    const observedMs = Date.parse(now);
    if (!Number.isFinite(observedMs)) throw new FleetRejectedError('clock_regression', 'Relay clock produced an invalid timestamp');
    this.#db.transaction(() => {
      const clock = this.#db.prepare('SELECT high_water_at FROM relay_clock WHERE singleton_id = 1')
        .get<{ high_water_at: string }>();
      if (!clock) throw new FleetRejectedError('clock_regression', 'Relay clock high-water mark is unavailable');
      const highWaterMs = Date.parse(clock.high_water_at);
      if (observedMs < highWaterMs) {
        throw new FleetRejectedError('clock_regression', 'Relay clock moved behind its last accepted timestamp');
      }
      if (observedMs > highWaterMs) {
        this.#db.prepare('UPDATE relay_clock SET high_water_at = ? WHERE singleton_id = 1')
          .run(new Date(observedMs).toISOString());
      }
    })();
  }

  private refreshNode(tenantId: string, nodeId: string, now: string): void {
    const row = this.#db.prepare('SELECT * FROM fleet_nodes WHERE tenant_id = ? AND node_id = ?').get<NodeRow>(tenantId, nodeId);
    if (row && Date.parse(now) - Date.parse(row.last_seen_at) >= row.offline_after_ms) {
      this.#db.prepare(`UPDATE fleet_nodes SET status = 'offline' WHERE tenant_id = ? AND node_id = ?`).run(tenantId, nodeId);
    }
  }

  private recoverExpiredLeases(tenantId: string, now: string): void {
    this.#db.prepare(`
      UPDATE fleet_tasks
      SET status = 'queued', lease_owner_node_id = NULL, lease_expires_at = NULL
      WHERE tenant_id = ? AND status = 'leased'
        AND julianday(lease_expires_at) <= julianday(?)
    `).run(tenantId, now);
    this.#db.prepare(`
      UPDATE fleet_task_leases SET state = 'queued', lease_expires_at = NULL, updated_at = ?
      WHERE tenant_id = ? AND state = 'leased'
        AND julianday(lease_expires_at) <= julianday(?)
    `).run(now, tenantId, now);
  }

  private requireNode(tenantId: string, nodeId: string): FleetNodeRecord {
    const row = this.#db.prepare('SELECT * FROM fleet_nodes WHERE tenant_id = ? AND node_id = ?').get<NodeRow>(tenantId, nodeId);
    if (!row) throw new FleetRejectedError('node_unknown', 'node was not found');
    return toNode(row);
  }

  private requireTask(tenantId: string, taskId: string): FleetTaskRecord {
    const row = this.#db.prepare('SELECT * FROM fleet_tasks WHERE tenant_id = ? AND task_id = ?').get<TaskRow>(tenantId, taskId);
    if (!row) throw new FleetRejectedError('invalid_transition', 'task was not found');
    return toTask(row);
  }

  private requireTaskByWorkOrder(tenantId: string, workOrderId: string): FleetTaskRecord {
    const row = this.#db.prepare('SELECT * FROM fleet_tasks WHERE tenant_id = ? AND work_order_id = ? ORDER BY rowid DESC LIMIT 1')
      .get<TaskRow>(tenantId, workOrderId);
    if (!row) throw new FleetRejectedError('invalid_transition', 'event work order is not queued');
    return toTask(row);
  }

  private findApprovalRequest(tenantId: string, requestId: string): ApprovalRequestRecord | null {
    const row = this.#db.prepare(`SELECT * FROM fleet_approval_requests WHERE tenant_id = ? AND request_id = ?`)
      .get<ApprovalRequestRow>(tenantId, requestId);
    return row ? toApprovalRequest(row) : null;
  }

  private requireApprovalRequest(tenantId: string, requestId: string): ApprovalRequestRecord {
    const request = this.findApprovalRequest(tenantId, requestId);
    if (!request) throw new FleetRejectedError('approval_not_found', 'approval request was not found');
    return request;
  }

  private findApprovalDecision(tenantId: string, requestId: string): ApprovalDecisionRecord | null {
    const row = this.#db.prepare(`SELECT * FROM fleet_approval_decisions WHERE tenant_id = ? AND request_id = ?`)
      .get<ApprovalDecisionRow>(tenantId, requestId);
    return row ? toApprovalDecision(row) : null;
  }

  private requireApprovalDecision(tenantId: string, requestId: string): ApprovalDecisionRecord {
    const decision = this.findApprovalDecision(tenantId, requestId);
    if (!decision) throw new FleetRejectedError('approval_not_found', 'approval decision was not found');
    return decision;
  }

  private assertActiveLease(task: FleetTaskRecord, nodeId: string, now: string): void {
    if (task.status !== 'leased' || !task.leaseExpiresAt) throw new FleetRejectedError('invalid_transition', 'task has no active lease');
    if (task.leaseOwnerNodeId !== nodeId) throw new FleetRejectedError('lease_owner_mismatch', 'event node does not own the task lease');
    if (Date.parse(task.leaseExpiresAt) <= Date.parse(now)) {
      this.#db.prepare(`UPDATE fleet_tasks SET status = 'queued', lease_owner_node_id = NULL, lease_expires_at = NULL WHERE tenant_id = ? AND task_id = ?`)
        .run(task.tenantId, task.taskId);
      this.#db.prepare(`UPDATE fleet_task_leases SET state = 'queued', lease_expires_at = NULL, updated_at = ? WHERE tenant_id = ? AND task_id = ?`)
        .run(now, task.tenantId, task.taskId);
      throw new FleetRejectedError('lease_expired', 'task lease has expired');
    }
  }

  private insertAudit(entry: RelayAuditEntry): void {
    this.#db.prepare('INSERT INTO relay_audit (tenant_id, action, task_id, actor_ref, at, detail) VALUES (?, ?, ?, ?, ?, ?)')
      .run(entry.tenantId, entry.action, entry.taskId, entry.actorRef, entry.at, entry.detail);
  }
}
