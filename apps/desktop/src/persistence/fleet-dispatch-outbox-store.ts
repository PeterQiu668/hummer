import { canonicalJson, sha256Hex } from './canonical-json.js';
import type { SqliteDatabase } from './sqlite.js';

const MAX_ENVELOPE_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 128 * 1024;
const TASK_ENVELOPE_FIELDS = new Set([
  'schema', 'version', 'workOrderTask', 'tenantId', 'targetNodeId', 'targetRuntime',
  'idempotencyKey', 'leaseMs', 'approvalPolicyRef', 'grantRef', 'expiresAt',
  'originRef', 'capabilityRef', 'executionPlan',
]);
const SAFE_READ_ATTESTATION_PATH = /^(?![A-Za-z]:)(?!\/)(?!.*:)(?!.*[\x00-\x1F\x7F])(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*\/\/)(?!.*\\)(?!.*\/$).+$/u;
const WINDOWS_DEVICE_SEGMENT = /^(?:con|prn|aux|nul|clock\$|com[1-9]|lpt[1-9])(?:\..*)?$/iu;

export interface FleetDispatchOutboxRecord {
  outboxId: string;
  tenantId: string;
  actorRef: string;
  idempotencyKey: string;
  envelopeSha256: string;
  envelope: Record<string, unknown>;
  status: 'pending' | 'delivered' | 'rejected';
  attemptCount: number;
  lastAttemptAt: string | null;
  lastErrorCode: string | null;
  deliveredAt: string | null;
  rejectedAt: string | null;
  relayTaskId: string | null;
  relayInserted: boolean | null;
  response: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface StageFleetDispatchInput {
  tenantId: string;
  actorRef: string;
  envelope: unknown;
  occurredAt: string;
}

interface OutboxRow {
  outbox_id: string;
  tenant_id: string;
  actor_ref: string;
  idempotency_key: string;
  envelope_sha256: string;
  envelope_json: string;
  status: 'pending' | 'delivered' | 'rejected';
  attempt_count: number;
  last_attempt_at: string | null;
  last_error_code: string | null;
  delivered_at: string | null;
  rejected_at: string | null;
  relay_task_id: string | null;
  relay_inserted: 0 | 1 | null;
  response_json: string | null;
  created_at: string;
  updated_at: string;
}

export class FleetDispatchOutboxStore {
  constructor(private readonly database: SqliteDatabase) {}

  stage(input: StageFleetDispatchInput): FleetDispatchOutboxRecord {
    const prepared = prepare(input);
    const write = this.database.transaction(() => {
      const existing = this.byKey(prepared.tenantId, prepared.idempotencyKey);
      if (existing) {
        if (existing.envelopeSha256 !== prepared.envelopeSha256 || existing.actorRef !== prepared.actorRef) {
          throw new Error('Fleet outbox idempotency key was reused with a different task or actor');
        }
        return existing;
      }
      this.database.prepare(`
        INSERT INTO fleet_dispatch_outbox
          (outbox_id, tenant_id, actor_ref, idempotency_key, envelope_sha256, envelope_json,
           status, attempt_count, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)
      `).run(
        prepared.outboxId,
        prepared.tenantId,
        prepared.actorRef,
        prepared.idempotencyKey,
        prepared.envelopeSha256,
        prepared.envelopeJson,
        prepared.occurredAt,
        prepared.occurredAt,
      );
      return this.require(prepared.outboxId);
    });
    return write();
  }

  recordAttempt(outboxId: string, occurredAt: string): FleetDispatchOutboxRecord {
    requireTimestamp(occurredAt, 'attempt time');
    const result = this.database.prepare(`
      UPDATE fleet_dispatch_outbox
      SET attempt_count = attempt_count + 1, last_attempt_at = ?, last_error_code = NULL, updated_at = ?
      WHERE outbox_id = ? AND status = 'pending'
    `).run(occurredAt, occurredAt, requireIdentifier(outboxId, 'outbox id'));
    if (result.changes !== 1) throw new Error('Fleet outbox item is not pending');
    return this.require(outboxId);
  }

  recordFailure(outboxId: string, errorCode: string, occurredAt: string): FleetDispatchOutboxRecord {
    requireTimestamp(occurredAt, 'failure time');
    const safeCode = requireErrorCode(errorCode);
    const result = this.database.prepare(`
      UPDATE fleet_dispatch_outbox
      SET last_error_code = ?, updated_at = ?
      WHERE outbox_id = ? AND status = 'pending'
    `).run(safeCode, occurredAt, requireIdentifier(outboxId, 'outbox id'));
    if (result.changes !== 1) throw new Error('Fleet outbox item is not pending');
    return this.require(outboxId);
  }

  recordRejected(outboxId: string, errorCode: string, occurredAt: string): FleetDispatchOutboxRecord {
    requireTimestamp(occurredAt, 'rejection time');
    const safeCode = requireErrorCode(errorCode);
    const result = this.database.prepare(`
      UPDATE fleet_dispatch_outbox
      SET status = 'rejected', rejected_at = ?, last_error_code = ?, updated_at = ?
      WHERE outbox_id = ? AND status = 'pending'
    `).run(occurredAt, safeCode, occurredAt, requireIdentifier(outboxId, 'outbox id'));
    if (result.changes !== 1) throw new Error('Fleet outbox item is not pending');
    return this.require(outboxId);
  }

  recordDelivered(outboxId: string, response: unknown, occurredAt: string): FleetDispatchOutboxRecord {
    requireTimestamp(occurredAt, 'delivery time');
    const pending = this.require(outboxId);
    if (pending.status === 'rejected') throw new Error('Fleet outbox item is rejected');
    const payload = requireRecord(response, 'Relay enqueue response');
    const task = requireRecord(payload.task, 'Relay enqueue task');
    const taskId = requireIdentifier(task.taskId, 'Relay task id');
    if (typeof payload.inserted !== 'boolean') throw new Error('Relay enqueue response inserted flag is invalid');
    if (task.tenantId !== pending.tenantId || taskId !== pending.idempotencyKey) {
      throw new Error('Relay enqueue response does not match the pending outbox binding');
    }
    const returnedEnvelope = requireRecord(task.envelope, 'Relay enqueue task envelope');
    if (sha256Hex(canonicalJson(returnedEnvelope)) !== pending.envelopeSha256) {
      throw new Error('Relay enqueue response envelope does not match the pending outbox bytes');
    }
    if (pending.status === 'delivered') return pending;
    const responseJson = canonicalJson(payload);
    if (Buffer.byteLength(responseJson, 'utf8') > MAX_RESPONSE_BYTES) throw new Error('Relay enqueue response exceeds the persistence limit');
    const result = this.database.prepare(`
      UPDATE fleet_dispatch_outbox
      SET status = 'delivered', delivered_at = ?, relay_task_id = ?, relay_inserted = ?,
          response_json = ?, last_error_code = NULL, updated_at = ?
      WHERE outbox_id = ? AND status = 'pending'
    `).run(occurredAt, taskId, payload.inserted ? 1 : 0, responseJson, occurredAt, requireIdentifier(outboxId, 'outbox id'));
    if (result.changes !== 1) throw new Error('Fleet outbox item is not pending');
    return this.require(outboxId);
  }

  get(outboxId: string): FleetDispatchOutboxRecord | null {
    const row = this.database.prepare('SELECT * FROM fleet_dispatch_outbox WHERE outbox_id = ?')
      .get<OutboxRow>(requireIdentifier(outboxId, 'outbox id'));
    return row ? mapRow(row) : null;
  }

  listPending(tenantId: string, actorRef: string): FleetDispatchOutboxRecord[] {
    return this.database.prepare(`
      SELECT * FROM fleet_dispatch_outbox
      WHERE tenant_id = ? AND actor_ref = ? AND status = 'pending'
        AND EXISTS (
          SELECT 1 FROM memberships
          WHERE memberships.tenant_id = fleet_dispatch_outbox.tenant_id
            AND memberships.status = 'active'
            AND (
              (fleet_dispatch_outbox.actor_ref GLOB 'account:*' AND memberships.account_id = substr(fleet_dispatch_outbox.actor_ref, 9))
              OR (fleet_dispatch_outbox.actor_ref GLOB 'human:*' AND memberships.human_user_id = substr(fleet_dispatch_outbox.actor_ref, 7))
            )
        )
      ORDER BY created_at, outbox_id
    `).all<OutboxRow>(requireIdentifier(tenantId, 'tenant id'), requireActor(actorRef)).map(mapRow);
  }

  private byKey(tenantId: string, idempotencyKey: string): FleetDispatchOutboxRecord | null {
    const row = this.database.prepare(`
      SELECT * FROM fleet_dispatch_outbox WHERE tenant_id = ? AND idempotency_key = ?
    `).get<OutboxRow>(tenantId, idempotencyKey);
    return row ? mapRow(row) : null;
  }

  private require(outboxId: string): FleetDispatchOutboxRecord {
    const record = this.get(outboxId);
    if (!record) throw new Error('Fleet outbox item was not found');
    return record;
  }
}

function prepare(input: StageFleetDispatchInput) {
  const tenantId = requireIdentifier(input.tenantId, 'tenant id');
  const actorRef = requireActor(input.actorRef);
  const occurredAt = requireTimestamp(input.occurredAt, 'created time');
  const envelope = requireRecord(input.envelope, 'TaskEnvelope');
  const unknown = Object.keys(envelope).find((field) => !TASK_ENVELOPE_FIELDS.has(field));
  if (unknown) throw new Error(`TaskEnvelope contains unknown field ${unknown}`);
  if (envelope.schema !== 'hummer.task-envelope' || envelope.version !== 1) throw new Error('TaskEnvelope schema or version is invalid');
  if (envelope.tenantId !== tenantId) throw new Error('TaskEnvelope tenant does not match the authenticated outbox tenant');
  const idempotencyKey = requireBoundedText(envelope.idempotencyKey, 'TaskEnvelope idempotency key', 8, 128);
  requireIdentifier(envelope.targetNodeId, 'TaskEnvelope target node');
  if (!['codex', 'claude', 'deepseek', 'cli-other', 'gui-exec'].includes(String(envelope.targetRuntime))) {
    throw new Error('TaskEnvelope target runtime is invalid');
  }
  if (!Number.isInteger(envelope.leaseMs) || Number(envelope.leaseMs) < 1_000 || Number(envelope.leaseMs) > 86_400_000) {
    throw new Error('TaskEnvelope lease is invalid');
  }
  requireIdentifier(envelope.approvalPolicyRef, 'TaskEnvelope approval policy');
  requireIdentifier(envelope.originRef, 'TaskEnvelope origin');
  if (envelope.grantRef !== undefined) requireIdentifier(envelope.grantRef, 'TaskEnvelope grant');
  if (envelope.capabilityRef !== undefined) requireIdentifier(envelope.capabilityRef, 'TaskEnvelope capability');
  if (envelope.executionPlan !== undefined) {
    if (envelope.grantRef === undefined) throw new Error('TaskEnvelope execution plan requires a one-use grant');
    validateExecutionPlan(envelope.executionPlan);
  }
  const expiresAt = requireUtcTimestamp(envelope.expiresAt, 'TaskEnvelope expiry');
  if (Date.parse(expiresAt) <= Date.parse(occurredAt)) throw new Error('TaskEnvelope is already expired');
  validateWorkOrderTask(envelope.workOrderTask);
  const envelopeJson = canonicalJson(envelope);
  if (Buffer.byteLength(envelopeJson, 'utf8') > MAX_ENVELOPE_BYTES) throw new Error('TaskEnvelope exceeds the persistence limit');
  const envelopeSha256 = sha256Hex(envelopeJson);
  return {
    tenantId, actorRef, occurredAt, idempotencyKey, envelopeJson, envelopeSha256,
    outboxId: `outbox-${sha256Hex(`${tenantId}\0${idempotencyKey}`).slice(0, 32)}`,
  };
}

function validateExecutionPlan(value: unknown): void {
  const plan = requireRecord(value, 'TaskEnvelope execution plan');
  const fields = ['kind', 'path', 'maxBytes'];
  const unknown = Object.keys(plan).find((field) => !fields.includes(field));
  if (unknown) throw new Error(`TaskEnvelope execution plan contains unknown field ${unknown}`);
  if (Object.keys(plan).length !== fields.length || plan.kind !== 'fs.read.attest.v1') {
    throw new Error('TaskEnvelope execution plan is unsupported');
  }
  const path = requireBoundedText(plan.path, 'TaskEnvelope execution path', 1, 1024);
  if (!SAFE_READ_ATTESTATION_PATH.test(path)
    || path.split('/').some((segment) => /[. ]$/u.test(segment) || WINDOWS_DEVICE_SEGMENT.test(segment))) {
    throw new Error('TaskEnvelope execution path must be a strict portable relative path');
  }
  if (!Number.isInteger(plan.maxBytes) || Number(plan.maxBytes) < 1 || Number(plan.maxBytes) > 1_048_576) {
    throw new Error('TaskEnvelope execution maxBytes is invalid');
  }
}

function mapRow(row: OutboxRow): FleetDispatchOutboxRecord {
  return {
    outboxId: row.outbox_id,
    tenantId: row.tenant_id,
    actorRef: row.actor_ref,
    idempotencyKey: row.idempotency_key,
    envelopeSha256: row.envelope_sha256,
    envelope: JSON.parse(row.envelope_json) as Record<string, unknown>,
    status: row.status,
    attemptCount: row.attempt_count,
    lastAttemptAt: row.last_attempt_at,
    lastErrorCode: row.last_error_code,
    deliveredAt: row.delivered_at,
    rejectedAt: row.rejected_at,
    relayTaskId: row.relay_task_id,
    relayInserted: row.relay_inserted === null ? null : row.relay_inserted === 1,
    response: row.response_json ? JSON.parse(row.response_json) as Record<string, unknown> : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function validateWorkOrderTask(value: unknown): void {
  const task = requireRecord(value, 'WorkOrderTask');
  const fields = new Set(['schema', 'version', 'title', 'target', 'expectedDeliverable', 'assignee', 'dueAt', 'attachmentNames', 'prompt', 'origin']);
  const unknown = Object.keys(task).find((field) => !fields.has(field));
  if (unknown) throw new Error(`WorkOrderTask contains unknown field ${unknown}`);
  if (task.schema !== 'hummer.work-order-task' || task.version !== 1) throw new Error('WorkOrderTask schema or version is invalid');
  requireBoundedText(task.title, 'WorkOrderTask title', 1, 512);
  requireBoundedText(task.target, 'WorkOrderTask target', 1, 32_768);
  requireBoundedText(task.expectedDeliverable, 'WorkOrderTask expected deliverable', 1, 32_768);
  if (task.assignee !== undefined) requireBoundedText(task.assignee, 'WorkOrderTask assignee', 1, 512);
  if (task.dueAt !== undefined) requireUtcTimestamp(task.dueAt, 'WorkOrderTask due time');
  if (task.prompt !== undefined) requireBoundedText(task.prompt, 'WorkOrderTask prompt', 0, 32_768);
  if (task.attachmentNames !== undefined) {
    if (!Array.isArray(task.attachmentNames) || task.attachmentNames.length > 128 || new Set(task.attachmentNames).size !== task.attachmentNames.length) {
      throw new Error('WorkOrderTask attachment names are invalid');
    }
    for (const path of task.attachmentNames) {
      const text = requireBoundedText(path, 'WorkOrderTask attachment name', 1, 1024);
      if (/^[A-Za-z]:/u.test(text) || text.startsWith('/') || text.includes('\\') || /(?:^|\/)\.\.(?:\/|$)/u.test(text)) {
        throw new Error('WorkOrderTask attachment name must be a safe relative path');
      }
    }
  }
  if (task.origin !== undefined) {
    const origin = requireRecord(task.origin, 'WorkOrderTask origin');
    const originFields = ['system', 'device', 'agent', 'taskId'];
    if (Object.keys(origin).length === 0 || Object.keys(origin).some((field) => !originFields.includes(field))) {
      throw new Error('WorkOrderTask origin is invalid');
    }
    for (const field of originFields) {
      if (origin[field] !== undefined) requireBoundedText(origin[field], `WorkOrderTask origin ${field}`, 1, 512);
    }
  }
}

function requireIdentifier(value: unknown, label: string): string {
  return requireBoundedText(value, label, 1, 128);
}

function requireActor(value: unknown): string {
  if (typeof value !== 'string' || !/^(?:human|account):[A-Za-z0-9_-]+$/u.test(value)) throw new Error('Fleet outbox actor is invalid');
  return value;
}

function requireTimestamp(value: unknown, label: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error(`${label} is invalid`);
  return new Date(value).toISOString();
}

function requireUtcTimestamp(value: unknown, label: string): string {
  const timestamp = requireBoundedText(value, label, 1, 24);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(timestamp) || !Number.isFinite(Date.parse(timestamp))) {
    throw new Error(`${label} is invalid`);
  }
  return new Date(timestamp).toISOString();
}

function requireBoundedText(value: unknown, label: string, minimum: number, maximum: number): string {
  if (typeof value !== 'string' || value.length < minimum || value.length > maximum) throw new Error(`${label} is invalid`);
  return value;
}

function requireErrorCode(value: string): string {
  if (!/^[a-z][a-z0-9_]{0,63}$/u.test(value)) return 'relay_error';
  return value;
}
