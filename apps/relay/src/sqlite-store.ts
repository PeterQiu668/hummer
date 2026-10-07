import { createRequire } from 'node:module';
import type { CapabilityInstallGateDecision, CapabilityInstallGateInput, CapabilityShareInvitation, SkillTrialSystemRecordInput, TeamReadOnlyShare } from '@hummer/contracts';
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
  type TenantAuditAction,
  type TenantAuditEvent,
  type TenantAuditExport,
  type TenantChainHead,
  type TenantQuotaCounter,
  type TenantQuotaLimits,
  type TenantQuotaMetric,
  type TenantQuotaUsage,
  type CapabilityCatalogItem,
  type CapabilityRegistryRecord,
  type CapabilityShareCreateInput,
  type CapabilityTrialRecordInput,
  type CapabilityVersionCreateInput,
} from './ports.js';
import {
  assertCapabilityHistory,
  assertCapabilityDraftSource,
  capabilityRecordFromShare,
  buildCapabilityShare,
  createTrialAggregate,
  rebindCapabilityInstallDecision,
} from './capability-registry.js';
import {
  TENANT_QUOTA_METRICS,
  assertQuotaDay,
  buildAuditExport,
  buildTenantAuditEvent,
  utcDay,
  validateQuotaLimits,
  validateQuotaUsage,
} from './governance.js';

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

interface TenantAuditRow {
  tenant_id: string;
  position: number;
  action: TenantAuditAction;
  subject_ref: string;
  node_id: string | null;
  actor_ref: string;
  at: string;
  metadata_json: string;
  previous_hash: string | null;
  hash: string;
}

interface TenantChainHeadRow {
  tenant_id: string;
  position: number;
  hash: string;
  updated_at: string;
}

interface TenantQuotaRow {
  tenant_id: string;
  node_id: string;
  day: string;
  metric: TenantQuotaMetric;
  used: number;
  limit_value: number | null;
  warning_emitted: number;
  updated_at: string;
}

interface TenantAuditExportRow {
  export_id: string;
  tenant_id: string;
  range_from: number;
  range_to: number;
  sha256: string;
  manifest_json: string;
  created_at: string;
}

interface CapabilityPackageRow {
  tenant_id: string;
  package_id: string;
  package_version: number;
  package_digest: string;
  author_json: string;
  trial_record_json: string | null;
  status: CapabilityRegistryRecord['status'];
  source_task_id: string;
  artifact_event_id: string;
  completed_event_id: string;
  created_at: string;
}

interface CapabilityTrialRow { trial_json: string }
interface CapabilityShareRow { share_json: string }

export const RELAY_SCHEMA_VERSION = 15;

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

function toCapabilityPackage(row: CapabilityPackageRow): CapabilityRegistryRecord {
  return {
    tenantId: row.tenant_id,
    packageId: row.package_id,
    packageVersion: row.package_version,
    packageDigest: row.package_digest,
    author: JSON.parse(row.author_json) as CapabilityRegistryRecord['author'],
    trialRecord: row.trial_record_json ? JSON.parse(row.trial_record_json) as CapabilityRegistryRecord['trialRecord'] : null,
    status: row.status,
    sourceTaskId: row.source_task_id,
    artifactEventId: row.artifact_event_id,
    completedEventId: row.completed_event_id,
    createdAt: row.created_at,
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

function toTenantAudit(row: TenantAuditRow): TenantAuditEvent {
  return {
    tenantId: row.tenant_id,
    position: row.position,
    action: row.action,
    subjectRef: row.subject_ref,
    nodeId: row.node_id,
    actorRef: row.actor_ref,
    at: row.at,
    metadata: jsonObject(row.metadata_json),
    previousHash: row.previous_hash,
    hash: row.hash,
  };
}

function toQuotaCounter(row: TenantQuotaRow): TenantQuotaCounter {
  return {
    tenantId: row.tenant_id,
    nodeId: row.node_id,
    day: row.day,
    metric: row.metric,
    used: row.used,
    limit: row.limit_value,
    warningEmitted: row.warning_emitted === 1,
    updatedAt: row.updated_at,
  };
}

function toAuditExport(row: TenantAuditExportRow): TenantAuditExport {
  return {
    exportId: row.export_id,
    tenantId: row.tenant_id,
    rangeFrom: row.range_from,
    rangeTo: row.range_to,
    sha256: row.sha256,
    createdAt: row.created_at,
    manifest: JSON.parse(row.manifest_json) as TenantAuditExport['manifest'],
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
    return this.#db.transaction(() => {
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
      this.appendTenantAudit(tenantId, 'node.registered', claims.nodeId, claims.nodeId, 'system:relay', now, { agentVersion: claims.agentVersion });
      return this.requireNode(tenantId, claims.nodeId);
    })();
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

  async listNodes(tenantId: string, now: string): Promise<readonly FleetNodeRecord[]> {
    this.advanceClock(now);
    const nodeIds = this.#db.prepare('SELECT node_id FROM fleet_nodes WHERE tenant_id = ?')
      .all<{ node_id: string }>(tenantId);
    for (const { node_id } of nodeIds) this.refreshNode(tenantId, node_id, now);
    return this.#db.prepare('SELECT * FROM fleet_nodes WHERE tenant_id = ? ORDER BY node_id')
      .all<NodeRow>(tenantId)
      .map(toNode);
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
    const exceeded = this.exceededQuotaMetrics(tenantId, claims.targetNodeId, utcDay(now));
    if (exceeded.length > 0) {
      this.#db.transaction(() => {
        this.appendTenantAudit(tenantId, 'quota.exceeded', `${claims.targetNodeId}:${utcDay(now)}`, claims.targetNodeId, 'system:relay', now, { metrics: exceeded });
      })();
      throw new FleetRejectedError('quota_exceeded', 'tenant node daily quota is exhausted');
    }
    const taskCounter = this.#db.prepare(`
      SELECT used FROM quota_counters WHERE tenant_id = ? AND node_id = ? AND day = ? AND metric = 'tasks'
    `).get<{ used: number }>(tenantId, claims.targetNodeId, utcDay(now));
    if (!Number.isSafeInteger((taskCounter?.used ?? 0) + 1)) {
      throw new FleetRejectedError('invalid_contract', 'quota usage exceeds the supported range');
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
        this.appendTenantAudit(tenantId, 'task.enqueued', claims.taskId, claims.targetNodeId, 'system:relay', now, { workOrderId: claims.workOrderId });
        if (retryOfTaskId) {
          this.insertAudit({ tenantId, action: 'retry', taskId: claims.taskId, actorRef: 'system:relay', at: now, detail: `retry-of:${retryOfTaskId}` });
          this.appendTenantAudit(tenantId, 'task.retried', claims.taskId, claims.targetNodeId, 'system:relay', now, { retryOfTaskId });
        }
        this.incrementQuota(tenantId, claims.targetNodeId, utcDay(now), 'tasks', 1, 'system:relay', now);
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
      this.appendTenantAudit(tenantId, 'task.claimed', leased.taskId, nodeId, `system:${nodeId}`, now, { attempt: leased.attempt });
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
      this.appendTenantAudit(tenantId, 'run.event', claims.eventId, claims.nodeId, `system:${claims.nodeId}`, now, {
        workOrderId: claims.workOrderId, seq: claims.seq, type: claims.type,
      });
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
      this.appendTenantAudit(tenantId, 'task.stopped', taskId, task.targetNodeId, actorRef, now, {});
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

  async listTasks(tenantId: string, now: string): Promise<readonly FleetTaskRecord[]> {
    this.advanceClock(now);
    this.recoverExpiredLeases(tenantId, now);
    return this.#db.prepare('SELECT * FROM fleet_tasks WHERE tenant_id = ? ORDER BY task_id')
      .all<TaskRow>(tenantId)
      .map(toTask);
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
      this.appendTenantAudit(tenantId, 'approval.requested', claims.requestId, claims.nodeId, claims.requestedBy, now, {
        taskId, workOrderId: claims.workOrderId,
      });
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
      const task = this.requireTask(tenantId, request.taskId);
      if (claims.decision !== 'approved' && task.status !== 'queued' && task.status !== 'leased') {
        throw new FleetRejectedError('invalid_transition', 'non-approved decision cannot replace a terminal or stopped task state');
      }
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
      if (claims.decision !== 'approved') {
        this.#db.prepare(`
          UPDATE fleet_tasks
          SET status = 'failed', lease_owner_node_id = NULL, lease_expires_at = NULL
          WHERE tenant_id = ? AND task_id = ?
        `).run(tenantId, request.taskId);
        this.#db.prepare(`
          UPDATE fleet_task_leases
          SET state = 'failed', lease_expires_at = NULL, updated_at = ?
          WHERE tenant_id = ? AND task_id = ?
        `).run(now, tenantId, request.taskId);
      }
      this.appendTenantAudit(tenantId, 'approval.decided', claims.decisionId, request.nodeId, claims.deciderActorRef, now, {
        requestId: claims.requestId, taskId: request.taskId, decision: claims.decision,
        taskStatus: claims.decision === 'approved' ? task.status : 'failed',
      });
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
      const decision = this.findApprovalDecision(tenantId, requestId);
      if (!decision) throw new FleetRejectedError('approval_not_found', 'approval decision is not available');
      const consumed = this.#db.prepare(`
        SELECT 1 AS present FROM fleet_approval_consumptions WHERE tenant_id = ? AND request_id = ?
      `).get<{ present: number }>(tenantId, requestId);
      if (consumed) throw new FleetRejectedError('approval_replayed', 'approval decision was already consumed');
      if (decision.decision === 'approved') {
        this.assertActiveLease(task, nodeId, now);
        assertDecisionWithinRequest(request, decision, now);
      } else if (task.status !== 'failed' || task.leaseOwnerNodeId !== null || task.leaseExpiresAt !== null) {
        throw new FleetRejectedError('invalid_transition', 'non-approved decision is not bound to a terminal task state');
      }
      this.#db.prepare(`
        INSERT INTO fleet_approval_consumptions (
          tenant_id, request_id, decision_id, task_id, node_id, run_id, consumed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(tenantId, requestId, decision.decisionId, taskId, nodeId, request.runId, now);
      this.appendTenantAudit(tenantId, 'approval.consumed', requestId, nodeId, `system:${nodeId}`, now, {
        taskId, decisionId: decision.decisionId, decision: decision.decision,
      });
      return { request: request.request, decision: decision.decisionRecord };
    })();
  }

  async getApprovalRequest(tenantId: string, requestId: string): Promise<ApprovalRequestRecord | null> {
    return this.findApprovalRequest(tenantId, requestId);
  }

  async listApprovalRequests(tenantId: string): Promise<readonly ApprovalRequestRecord[]> {
    return this.#db.prepare(`
      SELECT * FROM fleet_approval_requests WHERE tenant_id = ? ORDER BY request_id
    `).all<ApprovalRequestRow>(tenantId).map(toApprovalRequest);
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

  async configureQuota(
    tenantId: string,
    nodeId: string,
    day: string,
    limits: TenantQuotaLimits,
    actorRef: string,
    now: string,
  ): Promise<readonly TenantQuotaCounter[]> {
    this.advanceClock(now);
    assertQuotaDay(day);
    const validated = validateQuotaLimits(limits);
    return this.#db.transaction(() => {
      this.requireNode(tenantId, nodeId);
      const warnings: TenantQuotaCounter[] = [];
      for (const metric of TENANT_QUOTA_METRICS) {
        const limit = validated[metric];
        if (limit === undefined) continue;
        this.#db.prepare(`
          INSERT INTO quota_counters (tenant_id, node_id, day, metric, used, limit_value, warning_emitted, updated_at)
          VALUES (?, ?, ?, ?, 0, ?, 0, ?)
          ON CONFLICT (tenant_id, node_id, day, metric) DO UPDATE SET
            limit_value = excluded.limit_value,
            warning_emitted = CASE WHEN quota_counters.used < excluded.limit_value * 0.8 THEN 0 ELSE quota_counters.warning_emitted END,
            updated_at = excluded.updated_at
        `).run(tenantId, nodeId, day, metric, limit, now);
        const counter = this.requireQuotaCounter(tenantId, nodeId, day, metric);
        if (counter.used >= limit * 0.8 && !counter.warningEmitted) {
          this.#db.prepare(`UPDATE quota_counters SET warning_emitted = 1 WHERE tenant_id = ? AND node_id = ? AND day = ? AND metric = ?`)
            .run(tenantId, nodeId, day, metric);
          warnings.push({ ...counter, warningEmitted: true });
        }
      }
      this.appendTenantAudit(tenantId, 'quota.configured', `${nodeId}:${day}`, nodeId, actorRef, now, { limits: validated });
      for (const counter of warnings) this.appendQuotaWarning(counter, actorRef, now);
      return this.readQuotaCounters(tenantId, nodeId, day);
    })();
  }

  async recordQuotaUsage(
    tenantId: string,
    nodeId: string,
    usage: TenantQuotaUsage,
    actorRef: string,
    now: string,
  ): Promise<readonly TenantQuotaCounter[]> {
    this.advanceClock(now);
    const validated = validateQuotaUsage(usage);
    const day = utcDay(now);
    return this.#db.transaction(() => {
      this.requireNode(tenantId, nodeId);
      const warnings: TenantQuotaCounter[] = [];
      for (const metric of ['tokens', 'costCny'] as const) {
        const amount = validated[metric];
        if (amount === undefined) continue;
        const warning = this.incrementQuota(tenantId, nodeId, day, metric, amount, actorRef, now, false);
        if (warning) warnings.push(warning);
      }
      this.appendTenantAudit(tenantId, 'quota.usage', `${nodeId}:${day}`, nodeId, actorRef, now, { usage: validated });
      for (const counter of warnings) this.appendQuotaWarning(counter, actorRef, now);
      return this.readQuotaCounters(tenantId, nodeId, day);
    })();
  }

  async listQuotaCounters(tenantId: string, nodeId: string, day: string): Promise<readonly TenantQuotaCounter[]> {
    assertQuotaDay(day);
    return this.readQuotaCounters(tenantId, nodeId, day);
  }

  async getTenantChainHead(tenantId: string): Promise<TenantChainHead | null> {
    const row = this.#db.prepare(`SELECT tenant_id, position, hash, updated_at FROM tenant_chain_heads WHERE tenant_id = ?`)
      .get<TenantChainHeadRow>(tenantId);
    return row ? { tenantId: row.tenant_id, position: row.position, hash: row.hash, updatedAt: row.updated_at } : null;
  }

  async listTenantAudit(tenantId: string, rangeFrom?: number, rangeTo?: number): Promise<readonly TenantAuditEvent[]> {
    const from = rangeFrom ?? 1;
    const to = rangeTo ?? Number.MAX_SAFE_INTEGER;
    if (!Number.isInteger(from) || from < 1 || !Number.isInteger(to) || to < from) {
      throw new FleetRejectedError('invalid_contract', 'audit range is invalid');
    }
    return this.#db.prepare(`
      SELECT tenant_id, position, action, subject_ref, node_id, actor_ref, at, metadata_json, previous_hash, hash
      FROM tenant_audit_events WHERE tenant_id = ? AND position >= ? AND position <= ? ORDER BY position
    `).all<TenantAuditRow>(tenantId, from, to).map(toTenantAudit);
  }

  async createAuditExport(
    tenantId: string,
    rangeFrom: number | undefined,
    rangeTo: number | undefined,
    actorRef: string,
    now: string,
  ): Promise<TenantAuditExport> {
    this.advanceClock(now);
    return this.#db.transaction(() => {
      const rows = this.#db.prepare(`
        SELECT tenant_id, position, action, subject_ref, node_id, actor_ref, at, metadata_json, previous_hash, hash
        FROM tenant_audit_events
        WHERE tenant_id = ? AND position >= ? AND position <= ? ORDER BY position
      `).all<TenantAuditRow>(tenantId, rangeFrom ?? 1, rangeTo ?? Number.MAX_SAFE_INTEGER);
      if ((rangeFrom !== undefined && rows[0]?.position !== rangeFrom)
        || (rangeTo !== undefined && rows.at(-1)?.position !== rangeTo)) {
        throw new FleetRejectedError('audit_export_not_found', 'audit range was not found');
      }
      const auditExport = buildAuditExport(tenantId, rows.map(toTenantAudit), now);
      const inserted = this.#db.prepare(`
        INSERT OR IGNORE INTO audit_exports (export_id, tenant_id, range_from, range_to, sha256, manifest_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        auditExport.exportId, tenantId, auditExport.rangeFrom, auditExport.rangeTo,
        auditExport.sha256, JSON.stringify(auditExport.manifest), now,
      );
      if (inserted.changes === 1) {
        this.appendTenantAudit(tenantId, 'audit.exported', auditExport.exportId, null, actorRef, now, {
          rangeFrom: auditExport.rangeFrom, rangeTo: auditExport.rangeTo, sha256: auditExport.sha256,
        });
      }
      return this.requireAuditExport(tenantId, auditExport.exportId);
    })();
  }

  async getAuditExport(tenantId: string, exportId: string): Promise<TenantAuditExport | null> {
    const row = this.#db.prepare(`SELECT * FROM audit_exports WHERE tenant_id = ? AND export_id = ?`)
      .get<TenantAuditExportRow>(tenantId, exportId);
    return row ? toAuditExport(row) : null;
  }

  async createCapabilityVersion(
    tenantId: string,
    input: CapabilityVersionCreateInput,
    actorRef: string,
    now: string,
  ): Promise<CapabilityRegistryRecord> {
    this.advanceClock(now);
    if (input.author.tenantId !== tenantId || input.author.status !== 'draft') {
      throw new FleetRejectedError('tenant_mismatch', 'capability author tenant does not match the authenticated session');
    }
    return this.#db.transaction(() => {
      const task = this.#db.prepare(`SELECT * FROM fleet_tasks WHERE tenant_id = ? AND task_id = ? AND status = 'completed'`)
        .get<TaskRow>(tenantId, input.sourceTaskId);
      if (!task) throw new FleetRejectedError('capability_not_found', 'completed source task was not found');
      const artifact = this.#db.prepare(`SELECT * FROM fleet_run_events WHERE tenant_id = ? AND work_order_id = ? AND event_id = ? AND type = 'artifact'`)
        .get<EventRow>(tenantId, task.work_order_id, input.artifactEventId);
      const completed = this.#db.prepare(`SELECT * FROM fleet_run_events WHERE tenant_id = ? AND work_order_id = ? AND event_id = ? AND type = 'completed'`)
        .get<EventRow>(tenantId, task.work_order_id, input.completedEventId);
      if (!artifact || !completed) {
        throw new FleetRejectedError('capability_not_found', 'completed task evidence was not found');
      }
      const eventRows = this.#db.prepare(`
        SELECT * FROM fleet_run_events WHERE tenant_id = ? AND work_order_id = ? ORDER BY seq
      `).all<EventRow>(tenantId, task.work_order_id);
      assertCapabilityDraftSource({
        tenantId,
        input,
        task: toTask(task),
        events: eventRows.map((row) => ({
          claims: {
            eventId: row.event_id,
            tenantId: row.tenant_id,
            workOrderId: row.work_order_id,
            nodeId: row.node_id,
            seq: row.seq,
            occurredAt: row.occurred_at,
            type: row.type,
            idempotencyKey: row.idempotency_key,
          },
          event: jsonObject(row.event_json),
        })),
      });
      const history = this.#db.prepare(`SELECT * FROM capability_packages WHERE tenant_id = ? AND package_id = ? ORDER BY package_version`)
        .all<CapabilityPackageRow>(tenantId, input.author.packageId).map(toCapabilityPackage);
      const packageDigest = assertCapabilityHistory(history, input.author);
      try {
        this.#db.prepare(`
          INSERT INTO capability_packages (
            tenant_id, package_id, package_version, package_digest, author_json, trial_record_json, status,
            source_task_id, artifact_event_id, completed_event_id, created_at
          ) VALUES (?, ?, ?, ?, ?, NULL, 'draft', ?, ?, ?, ?)
        `).run(tenantId, input.author.packageId, input.author.packageVersion, packageDigest, JSON.stringify(input.author),
          input.sourceTaskId, input.artifactEventId, input.completedEventId, now);
      } catch {
        throw new FleetRejectedError('capability_conflict', 'capability version already exists or lost the append CAS');
      }
      this.appendTenantAudit(tenantId, 'capability.version_created', `${input.author.packageId}:${input.author.packageVersion}`, null, actorRef, now, {
        packageDigest, sourceTaskId: input.sourceTaskId,
      });
      return this.requireCapabilityPackage(tenantId, input.author.packageId, input.author.packageVersion);
    })();
  }

  async recordCapabilityTrial(
    tenantId: string,
    input: CapabilityTrialRecordInput,
    nodeId: string,
    now: string,
  ): Promise<CapabilityRegistryRecord> {
    this.advanceClock(now);
    const trial = input.trial;
    if (trial.tenantId !== tenantId || trial.environment.nodeId !== nodeId) {
      throw new FleetRejectedError('capability_trust_denied', 'trial identity does not match the trusted node session');
    }
    return this.#db.transaction(() => {
      this.requireNode(tenantId, nodeId);
      const record = this.requireCapabilityPackage(tenantId, trial.packageId, trial.packageVersion);
      if (record.packageDigest !== trial.packageDigest) throw new FleetRejectedError('capability_not_found', 'capability version was not found');
      if (record.status === 'shared') throw new FleetRejectedError('capability_conflict', 'shared capability trial snapshot is immutable');
      const exists = this.#db.prepare(`SELECT 1 AS found FROM capability_trials WHERE tenant_id = ? AND trial_id = ?`)
        .get<{ found: number }>(tenantId, trial.trialId);
      if (exists) throw new FleetRejectedError('capability_conflict', 'SkillTrial trialId already exists');
      const trials = this.#db.prepare(`SELECT trial_json FROM capability_trials WHERE tenant_id = ? AND package_id = ? AND package_version = ? ORDER BY trial_id`)
        .all<CapabilityTrialRow>(tenantId, trial.packageId, trial.packageVersion)
        .map((row) => JSON.parse(row.trial_json) as SkillTrialSystemRecordInput);
      const aggregate = createTrialAggregate([...trials, trial], input.regression);
      try {
        this.#db.prepare(`
          INSERT INTO capability_trials (tenant_id, trial_id, package_id, package_version, package_digest, node_id, trial_json, recorded_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(tenantId, trial.trialId, trial.packageId, trial.packageVersion, trial.packageDigest, nodeId, JSON.stringify(trial), now);
      } catch {
        throw new FleetRejectedError('capability_conflict', 'SkillTrial trialId already exists');
      }
      const status = aggregate.shadowRuns >= 5 && aggregate.failure === 0 && aggregate.regressionPassed ? 'verified' : 'shadow';
      this.#db.prepare(`UPDATE capability_packages SET trial_record_json = ?, status = ? WHERE tenant_id = ? AND package_id = ? AND package_version = ?`)
        .run(JSON.stringify(aggregate), status, tenantId, trial.packageId, trial.packageVersion);
      this.appendTenantAudit(tenantId, 'capability.trial_recorded', trial.trialId, nodeId, 'system:skill-trial', now, {
        packageId: trial.packageId, packageVersion: trial.packageVersion, packageDigest: trial.packageDigest, ok: trial.ok,
      });
      return this.requireCapabilityPackage(tenantId, trial.packageId, trial.packageVersion);
    })();
  }

  async createCapabilityShare(
    sourceTenantId: string,
    input: CapabilityShareCreateInput,
    invitation: CapabilityShareInvitation | undefined,
    actorRef: string,
    now: string,
  ): Promise<TeamReadOnlyShare> {
    this.advanceClock(now);
    return this.#db.transaction(() => {
      const record = this.requireCapabilityPackage(sourceTenantId, input.packageId, input.packageVersion);
      if (record.status !== 'verified' && record.status !== 'shared') {
        throw new FleetRejectedError('capability_trust_denied', 'capability has not passed trusted trials');
      }
      const share = buildCapabilityShare({ shareId: input.shareId, record, targetTenantId: input.targetTenantId, invitation, actorRef, now });
      try {
        this.#db.prepare(`
          INSERT INTO capability_shares (
            target_tenant_id, share_id, source_tenant_id, package_id, package_version, package_digest, share_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(input.targetTenantId, input.shareId, sourceTenantId, input.packageId, input.packageVersion,
          record.packageDigest, JSON.stringify(share), now);
      } catch {
        throw new FleetRejectedError('capability_conflict', 'capability share already exists');
      }
      this.#db.prepare(`UPDATE capability_packages SET status = 'shared' WHERE tenant_id = ? AND package_id = ? AND package_version = ?`)
        .run(sourceTenantId, input.packageId, input.packageVersion);
      this.appendTenantAudit(sourceTenantId, 'capability.shared', input.shareId, null, actorRef, now, {
        targetTenantId: input.targetTenantId, packageId: input.packageId, packageVersion: input.packageVersion, packageDigest: record.packageDigest,
      });
      return share;
    })();
  }

  async listCapabilities(tenantId: string): Promise<readonly CapabilityCatalogItem[]> {
    const owned = this.#db.prepare(`SELECT * FROM capability_packages WHERE tenant_id = ? ORDER BY package_id, package_version`)
      .all<CapabilityPackageRow>(tenantId)
      .map((row): CapabilityCatalogItem => ({ access: 'owner', record: toCapabilityPackage(row), share: null }));
    const shares = this.#db.prepare(`SELECT share_json FROM capability_shares WHERE target_tenant_id = ? ORDER BY package_id, package_version`)
      .all<CapabilityShareRow>(tenantId).map((row) => JSON.parse(row.share_json) as TeamReadOnlyShare);
    const shared = shares.map((share): CapabilityCatalogItem => ({
      access: 'read_only',
      record: capabilityRecordFromShare(
        this.requireCapabilityPackage(share.sourceTenantId, share.packageId, share.packageVersion),
        share,
      ),
      share,
    }));
    return [...owned, ...shared];
  }

  async getCapability(tenantId: string, packageId: string, packageVersion?: number): Promise<CapabilityCatalogItem | null> {
    const candidates = (await this.listCapabilities(tenantId)).filter((item) => item.record.packageId === packageId
      && (packageVersion === undefined || item.record.packageVersion === packageVersion));
    return candidates.sort((left, right) => right.record.packageVersion - left.record.packageVersion)[0] ?? null;
  }

  async getCapabilityShare(targetTenantId: string, shareId: string): Promise<TeamReadOnlyShare | null> {
    const row = this.#db.prepare(`SELECT share_json FROM capability_shares WHERE target_tenant_id = ? AND share_id = ?`)
      .get<CapabilityShareRow>(targetTenantId, shareId);
    return row ? JSON.parse(row.share_json) as TeamReadOnlyShare : null;
  }

  async recordCapabilityInstallDecision(
    targetTenantId: string,
    input: CapabilityInstallGateInput,
    actorRef: string,
    now: string,
  ): Promise<CapabilityInstallGateDecision> {
    this.advanceClock(now);
    return this.#db.transaction(() => {
      const shareId = input.share.shareId;
      const shareRow = this.#db.prepare(`SELECT share_json FROM capability_shares WHERE target_tenant_id = ? AND share_id = ?`)
        .get<CapabilityShareRow>(targetTenantId, shareId);
      if (!shareRow) throw new FleetRejectedError('capability_not_found', 'capability share was not found');
      const share = JSON.parse(shareRow.share_json) as TeamReadOnlyShare;
      const decision = rebindCapabilityInstallDecision({ share, targetTenantId, input, now });
      try {
        this.#db.prepare(`
          INSERT INTO capability_install_decisions (target_tenant_id, gate_id, share_id, package_digest, request_digest, decision_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(targetTenantId, input.gateId, shareId, share.packageDigest, decision.requestDigest, JSON.stringify(decision), now);
      } catch {
        throw new FleetRejectedError('capability_conflict', 'install gate id already exists');
      }
      this.appendTenantAudit(targetTenantId, 'capability.install_evaluated', input.gateId, null, actorRef, now, {
        shareId, packageDigest: share.packageDigest, decision: decision.decision, requestDigest: decision.requestDigest,
      });
      return decision;
    })();
  }

  close(): void {
    this.#db.close();
  }

  private requireCapabilityPackage(tenantId: string, packageId: string, packageVersion: number): CapabilityRegistryRecord {
    const row = this.#db.prepare(`
      SELECT * FROM capability_packages WHERE tenant_id = ? AND package_id = ? AND package_version = ?
    `).get<CapabilityPackageRow>(tenantId, packageId, packageVersion);
    if (!row) throw new FleetRejectedError('capability_not_found', 'capability version was not found');
    return toCapabilityPackage(row);
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
      CREATE TABLE IF NOT EXISTS tenant_audit_events (
        tenant_id TEXT NOT NULL,
        position INTEGER NOT NULL CHECK (position > 0),
        action TEXT NOT NULL,
        subject_ref TEXT NOT NULL,
        node_id TEXT,
        actor_ref TEXT NOT NULL,
        at TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        previous_hash TEXT,
        hash TEXT NOT NULL,
        PRIMARY KEY (tenant_id, position),
        UNIQUE (tenant_id, hash)
      );
      CREATE TABLE IF NOT EXISTS tenant_chain_heads (
        tenant_id TEXT PRIMARY KEY,
        position INTEGER NOT NULL CHECK (position > 0),
        hash TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS quota_counters (
        tenant_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        day TEXT NOT NULL,
        metric TEXT NOT NULL CHECK (metric IN ('tasks', 'tokens', 'costCny')),
        used REAL NOT NULL CHECK (used >= 0),
        limit_value REAL CHECK (limit_value > 0),
        warning_emitted INTEGER NOT NULL CHECK (warning_emitted IN (0, 1)),
        updated_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, node_id, day, metric)
      );
      CREATE INDEX IF NOT EXISTS quota_counters_window ON quota_counters (tenant_id, day, node_id);
      CREATE TABLE IF NOT EXISTS audit_exports (
        export_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        range_from INTEGER NOT NULL,
        range_to INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        manifest_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, export_id)
      );
      CREATE TRIGGER IF NOT EXISTS tenant_audit_events_no_update
        BEFORE UPDATE ON tenant_audit_events BEGIN SELECT RAISE(ABORT, 'tenant audit events are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS tenant_audit_events_no_delete
        BEFORE DELETE ON tenant_audit_events BEGIN SELECT RAISE(ABORT, 'tenant audit events are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS audit_exports_no_update
        BEFORE UPDATE ON audit_exports BEGIN SELECT RAISE(ABORT, 'audit exports are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS audit_exports_no_delete
        BEFORE DELETE ON audit_exports BEGIN SELECT RAISE(ABORT, 'audit exports are append-only'); END;
      CREATE TABLE IF NOT EXISTS capability_packages (
        tenant_id TEXT NOT NULL,
        package_id TEXT NOT NULL,
        package_version INTEGER NOT NULL CHECK (package_version > 0),
        package_digest TEXT NOT NULL,
        author_json TEXT NOT NULL,
        trial_record_json TEXT,
        status TEXT NOT NULL CHECK (status IN ('draft', 'shadow', 'verified', 'shared')),
        source_task_id TEXT NOT NULL,
        artifact_event_id TEXT NOT NULL,
        completed_event_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, package_id, package_version),
        UNIQUE (tenant_id, package_id, package_digest),
        FOREIGN KEY (tenant_id, source_task_id) REFERENCES fleet_tasks (tenant_id, task_id),
        FOREIGN KEY (tenant_id, artifact_event_id) REFERENCES fleet_run_events (tenant_id, event_id),
        FOREIGN KEY (tenant_id, completed_event_id) REFERENCES fleet_run_events (tenant_id, event_id)
      );
      CREATE TABLE IF NOT EXISTS capability_trials (
        tenant_id TEXT NOT NULL,
        trial_id TEXT NOT NULL,
        package_id TEXT NOT NULL,
        package_version INTEGER NOT NULL,
        package_digest TEXT NOT NULL,
        node_id TEXT NOT NULL,
        trial_json TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, trial_id),
        FOREIGN KEY (tenant_id, package_id, package_version)
          REFERENCES capability_packages (tenant_id, package_id, package_version),
        FOREIGN KEY (tenant_id, node_id) REFERENCES fleet_nodes (tenant_id, node_id)
      );
      CREATE INDEX IF NOT EXISTS capability_trials_package
        ON capability_trials (tenant_id, package_id, package_version, trial_id);
      CREATE TABLE IF NOT EXISTS capability_shares (
        target_tenant_id TEXT NOT NULL,
        share_id TEXT NOT NULL,
        source_tenant_id TEXT NOT NULL,
        package_id TEXT NOT NULL,
        package_version INTEGER NOT NULL,
        package_digest TEXT NOT NULL,
        share_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (target_tenant_id, share_id),
        FOREIGN KEY (source_tenant_id, package_id, package_version)
          REFERENCES capability_packages (tenant_id, package_id, package_version)
      );
      CREATE INDEX IF NOT EXISTS capability_shares_source
        ON capability_shares (source_tenant_id, package_id, package_version);
      CREATE TABLE IF NOT EXISTS capability_install_decisions (
        target_tenant_id TEXT NOT NULL,
        gate_id TEXT NOT NULL,
        share_id TEXT NOT NULL,
        package_digest TEXT NOT NULL,
        request_digest TEXT NOT NULL,
        decision_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (target_tenant_id, gate_id),
        FOREIGN KEY (target_tenant_id, share_id) REFERENCES capability_shares (target_tenant_id, share_id)
      );
      CREATE TRIGGER IF NOT EXISTS capability_packages_immutable_content
        BEFORE UPDATE ON capability_packages
        WHEN OLD.tenant_id != NEW.tenant_id OR OLD.package_id != NEW.package_id
          OR OLD.package_version != NEW.package_version OR OLD.package_digest != NEW.package_digest
          OR OLD.author_json != NEW.author_json OR OLD.source_task_id != NEW.source_task_id
          OR OLD.artifact_event_id != NEW.artifact_event_id OR OLD.completed_event_id != NEW.completed_event_id
          OR OLD.created_at != NEW.created_at
        BEGIN SELECT RAISE(ABORT, 'capability package immutable content cannot be changed'); END;
      CREATE TRIGGER IF NOT EXISTS capability_packages_no_delete
        BEFORE DELETE ON capability_packages BEGIN SELECT RAISE(ABORT, 'capability packages are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS capability_trials_no_update
        BEFORE UPDATE ON capability_trials BEGIN SELECT RAISE(ABORT, 'capability trials are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS capability_trials_no_delete
        BEFORE DELETE ON capability_trials BEGIN SELECT RAISE(ABORT, 'capability trials are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS capability_shares_no_update
        BEFORE UPDATE ON capability_shares BEGIN SELECT RAISE(ABORT, 'capability shares are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS capability_shares_no_delete
        BEFORE DELETE ON capability_shares BEGIN SELECT RAISE(ABORT, 'capability shares are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS capability_install_decisions_no_update
        BEFORE UPDATE ON capability_install_decisions BEGIN SELECT RAISE(ABORT, 'capability install decisions are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS capability_install_decisions_no_delete
        BEFORE DELETE ON capability_install_decisions BEGIN SELECT RAISE(ABORT, 'capability install decisions are append-only'); END;
    `);
    const migration = this.#db.prepare('INSERT OR IGNORE INTO relay_schema_migrations (version, name, applied_at) VALUES (?, ?, ?)');
    migration.run(11, 'fleet_relay_nodes_tasks_leases', new Date(0).toISOString());
    migration.run(12, 'relay_monotonic_clock', new Date(0).toISOString());
    migration.run(13, 'relay_append_only_approval_binding', new Date(0).toISOString());
    migration.run(14, 'relay_tenant_governance', new Date(0).toISOString());
    migration.run(RELAY_SCHEMA_VERSION, 'relay_capability_registry', new Date(0).toISOString());
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

  private appendTenantAudit(
    tenantId: string,
    action: TenantAuditAction,
    subjectRef: string,
    nodeId: string | null,
    actorRef: string,
    at: string,
    metadata: FleetObject,
  ): TenantAuditEvent {
    const head = this.#db.prepare(`SELECT tenant_id, position, hash, updated_at FROM tenant_chain_heads WHERE tenant_id = ?`)
      .get<TenantChainHeadRow>(tenantId);
    const event = buildTenantAuditEvent({
      tenantId,
      position: (head?.position ?? 0) + 1,
      action,
      subjectRef,
      nodeId,
      actorRef,
      at,
      metadata,
      previousHash: head?.hash ?? null,
    });
    this.#db.prepare(`
      INSERT INTO tenant_audit_events (
        tenant_id, position, action, subject_ref, node_id, actor_ref, at, metadata_json, previous_hash, hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.tenantId, event.position, event.action, event.subjectRef, event.nodeId, event.actorRef,
      event.at, JSON.stringify(event.metadata), event.previousHash, event.hash,
    );
    this.#db.prepare(`
      INSERT INTO tenant_chain_heads (tenant_id, position, hash, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (tenant_id) DO UPDATE SET position = excluded.position, hash = excluded.hash, updated_at = excluded.updated_at
    `).run(tenantId, event.position, event.hash, at);
    return event;
  }

  private readQuotaCounters(tenantId: string, nodeId: string, day: string): TenantQuotaCounter[] {
    return this.#db.prepare(`
      SELECT tenant_id, node_id, day, metric, used, limit_value, warning_emitted, updated_at
      FROM quota_counters WHERE tenant_id = ? AND node_id = ? AND day = ?
      ORDER BY CASE metric WHEN 'tasks' THEN 1 WHEN 'tokens' THEN 2 ELSE 3 END
    `).all<TenantQuotaRow>(tenantId, nodeId, day).map(toQuotaCounter);
  }

  private requireQuotaCounter(tenantId: string, nodeId: string, day: string, metric: TenantQuotaMetric): TenantQuotaCounter {
    const row = this.#db.prepare(`
      SELECT tenant_id, node_id, day, metric, used, limit_value, warning_emitted, updated_at
      FROM quota_counters WHERE tenant_id = ? AND node_id = ? AND day = ? AND metric = ?
    `).get<TenantQuotaRow>(tenantId, nodeId, day, metric);
    if (!row) throw new FleetRejectedError('invalid_contract', 'quota counter is unavailable');
    return toQuotaCounter(row);
  }

  private incrementQuota(
    tenantId: string,
    nodeId: string,
    day: string,
    metric: TenantQuotaMetric,
    amount: number,
    actorRef: string,
    now: string,
    appendWarning = true,
  ): TenantQuotaCounter | null {
    const existing = this.#db.prepare(`
      SELECT tenant_id, node_id, day, metric, used, limit_value, warning_emitted, updated_at
      FROM quota_counters WHERE tenant_id = ? AND node_id = ? AND day = ? AND metric = ?
    `).get<TenantQuotaRow>(tenantId, nodeId, day, metric);
    const nextUsed = (existing?.used ?? 0) + amount;
    if (!Number.isFinite(nextUsed) || nextUsed > Number.MAX_SAFE_INTEGER) {
      throw new FleetRejectedError('invalid_contract', 'quota usage exceeds the supported range');
    }
    this.#db.prepare(`
      INSERT INTO quota_counters (tenant_id, node_id, day, metric, used, limit_value, warning_emitted, updated_at)
      VALUES (?, ?, ?, ?, ?, NULL, 0, ?)
      ON CONFLICT (tenant_id, node_id, day, metric) DO UPDATE SET
        used = quota_counters.used + excluded.used,
        updated_at = excluded.updated_at
    `).run(tenantId, nodeId, day, metric, amount, now);
    const counter = this.requireQuotaCounter(tenantId, nodeId, day, metric);
    if (counter.limit !== null && counter.used >= counter.limit * 0.8 && !counter.warningEmitted) {
      this.#db.prepare(`UPDATE quota_counters SET warning_emitted = 1 WHERE tenant_id = ? AND node_id = ? AND day = ? AND metric = ?`)
        .run(tenantId, nodeId, day, metric);
      const warned = { ...counter, warningEmitted: true };
      if (appendWarning) this.appendQuotaWarning(warned, actorRef, now);
      return warned;
    }
    return null;
  }

  private appendQuotaWarning(counter: TenantQuotaCounter, actorRef: string, now: string): void {
    this.appendTenantAudit(counter.tenantId, 'quota.warning', `${counter.nodeId}:${counter.day}:${counter.metric}`, counter.nodeId, actorRef, now, {
      metric: counter.metric, used: counter.used, limit: counter.limit,
    });
  }

  private exceededQuotaMetrics(tenantId: string, nodeId: string, day: string): TenantQuotaMetric[] {
    return this.#db.prepare(`
      SELECT metric FROM quota_counters
      WHERE tenant_id = ? AND node_id = ? AND day = ? AND limit_value IS NOT NULL AND used >= limit_value
      ORDER BY metric
    `).all<{ metric: TenantQuotaMetric }>(tenantId, nodeId, day).map((row) => row.metric);
  }

  private requireAuditExport(tenantId: string, exportId: string): TenantAuditExport {
    const row = this.#db.prepare(`SELECT * FROM audit_exports WHERE tenant_id = ? AND export_id = ?`)
      .get<TenantAuditExportRow>(tenantId, exportId);
    if (!row) throw new FleetRejectedError('audit_export_not_found', 'audit export was not found');
    return toAuditExport(row);
  }
}
