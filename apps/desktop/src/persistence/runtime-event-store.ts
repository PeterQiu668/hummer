import { canonicalJson, sha256Hex, type JsonValue } from './canonical-json.js';
import type { DomainEventStore } from './domain-event-store.js';
import type { SqliteDatabase } from './sqlite.js';

export interface PersistableRuntimeEvent {
  [key: string]: JsonValue | undefined;
  sessionId: string;
  sequence: number;
  occurredAt: string;
  actorRef: string;
  type: string;
  durationMs?: number | null;
  costCny?: number | null;
  evidenceRefs: string[];
}

export interface SaveRuntimeEventOptions {
  tenantId: string;
  runtimeId: string;
  correlationId: string;
  workOrderId?: string;
}

export interface RuntimeEventQuery {
  afterSequence?: number;
  limit?: number;
}

export interface PersistedSessionDescriptor {
  sessionId: string;
  tenantId: string;
  runtimeId: string;
  workOrderId?: string;
  startedAt: string;
  plan: JsonValue;
  handle: JsonValue;
}

interface StepRow {
  event_json: string;
}

interface SessionDescriptorRow {
  id: string;
  tenant_id: string;
  work_order_id: string | null;
  runtime_id: string;
  started_at: string;
  payload_json: string;
}
interface StaleSessionRow {
  id: string;
  tenant_id: string;
  work_order_id: string | null;
  runtime_id: string;
  last_sequence: number;
}

export class RuntimeEventStore {
  constructor(
    private readonly database: SqliteDatabase,
    private readonly domainEvents: DomainEventStore,
  ) {}

  saveSession(descriptor: PersistedSessionDescriptor): void {
    const payload = canonicalJson({ plan: descriptor.plan, handle: descriptor.handle });
    const workOrderId = descriptor.workOrderId ?? null;
    const saveTransaction = this.database.transaction(() => {
      if (workOrderId) {
        const title = isJsonObject(descriptor.plan) && typeof descriptor.plan.prompt === 'string' ? descriptor.plan.prompt : null;
        this.database.prepare(`
          INSERT INTO work_orders (id, tenant_id, status, title, payload_json, created_at, updated_at)
          VALUES (?, ?, 'running', ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at
        `).run(workOrderId, descriptor.tenantId, title, canonicalJson(descriptor.plan), descriptor.startedAt, descriptor.startedAt);
      }
      this.database.prepare(`
        INSERT INTO sessions (id, tenant_id, work_order_id, runtime_id, status, started_at, ended_at, last_sequence, payload_json)
        VALUES (?, ?, ?, ?, 'running', ?, NULL, 0, ?)
        ON CONFLICT(id) DO UPDATE SET payload_json = excluded.payload_json
      `).run(descriptor.sessionId, descriptor.tenantId, workOrderId, descriptor.runtimeId, descriptor.startedAt, payload);
    });
    saveTransaction();
  }

  listSessions(): PersistedSessionDescriptor[] {
    return this.database.prepare(`
      SELECT id, tenant_id, work_order_id, runtime_id, started_at, payload_json
      FROM sessions ORDER BY started_at DESC, id DESC
    `).all<SessionDescriptorRow>().flatMap((row) => {
      const payload = JSON.parse(row.payload_json) as unknown;
      if (!isJsonObject(payload) || !('plan' in payload) || !('handle' in payload)) return [];
      return [{
        sessionId: row.id,
        tenantId: row.tenant_id,
        runtimeId: row.runtime_id,
        workOrderId: row.work_order_id ?? undefined,
        startedAt: row.started_at,
        plan: payload.plan as JsonValue,
        handle: payload.handle as JsonValue,
      }];
    });
  }

  interruptStaleRealSessions(occurredAt: string): number {
    const rows = this.database.prepare(`
      SELECT id, tenant_id, work_order_id, runtime_id, last_sequence
      FROM sessions
      WHERE status IN ('running', 'awaiting_approval', 'paused') AND runtime_id NOT LIKE 'mock%'
    `).all<StaleSessionRow>();
    for (const row of rows) {
      this.save({
        sessionId: row.id,
        sequence: row.last_sequence + 1,
        occurredAt,
        actorRef: 'system:desktop-host',
        type: 'status', status: 'interrupted',
        reason: '桌面宿主已重启，原执行进程和 RuntimeHandle 均已失效；历史步骤、审批与证据保持可回放。',
        evidenceRefs: [],
      }, { tenantId: row.tenant_id, runtimeId: row.runtime_id, correlationId: `corr_${row.id}`, workOrderId: row.work_order_id ?? undefined });
    }
    return rows.length;
  }
  save(event: PersistableRuntimeEvent, options: SaveRuntimeEventOptions): void {
    validateRuntimeEvent(event, options);
    const eventJson = canonicalJson(event);
    const eventId = `evt_runtime_${sha256Hex(`${event.sessionId}:${event.sequence}`).slice(0, 32)}`;
    const stepId = `step_${sha256Hex(`${event.sessionId}:${event.sequence}`).slice(0, 32)}`;
    const saveTransaction = this.database.transaction(() => {
      const existing = this.database.prepare('SELECT event_json FROM steps WHERE session_id = ? AND sequence = ?')
        .get<StepRow>(event.sessionId, event.sequence);
      if (existing) {
        if (existing.event_json !== eventJson) {
          throw new Error(`Conflicting runtime event for ${event.sessionId} sequence ${event.sequence}`);
        }
        return;
      }

      this.upsertSession(event, options, eventJson);
      this.domainEvents.append({
        id: eventId,
        tenantId: options.tenantId,
        aggregateType: 'session',
        aggregateId: event.sessionId,
        type: `runtime.${event.type}`,
        occurredAt: event.occurredAt,
        actorRef: event.actorRef,
        correlationId: options.correlationId,
        payload: event as JsonValue,
      });
      this.database.prepare(`
        INSERT INTO steps (id, session_id, sequence, event_type, actor_ref, occurred_at, duration_ms, cost_cny, event_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        stepId, event.sessionId, event.sequence, event.type, event.actorRef, event.occurredAt,
        event.durationMs ?? null, event.costCny ?? null, eventJson,
      );
      this.projectApproval(event);
      this.projectResult(event, options, eventJson);
    });
    saveTransaction();
  }

  listBySession(sessionId: string, query: RuntimeEventQuery = {}): PersistableRuntimeEvent[] {
    const afterSequence = query.afterSequence ?? 0;
    const limit = Math.max(1, Math.min(query.limit ?? 10_000, 10_000));
    return this.database.prepare(`
      SELECT event_json FROM steps WHERE session_id = ? AND sequence > ? ORDER BY sequence LIMIT ?
    `).all<StepRow>(sessionId, afterSequence, limit).map((row) => JSON.parse(row.event_json) as PersistableRuntimeEvent);
  }

  private upsertSession(event: PersistableRuntimeEvent, options: SaveRuntimeEventOptions, eventJson: string): void {
    const status = sessionStatus(event);
    const endedAt = status === 'delivered' || status === 'blocked' || status === 'cancelled' ? event.occurredAt : null;
    this.database.prepare(`
      INSERT INTO sessions (
        id, tenant_id, work_order_id, runtime_id, status, started_at, ended_at, last_sequence, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        ended_at = COALESCE(excluded.ended_at, sessions.ended_at),
        last_sequence = excluded.last_sequence
      WHERE excluded.last_sequence > sessions.last_sequence
    `).run(
      event.sessionId, options.tenantId, options.workOrderId ?? null, options.runtimeId, status,
      event.occurredAt, endedAt, event.sequence, eventJson,
    );
  }

  private projectApproval(event: PersistableRuntimeEvent): void {
    const approvalId = stringField(event, 'approvalId');
    if (!approvalId) return;
    if (event.type === 'approval_required') {
      this.database.prepare(`
        INSERT INTO approvals (id, session_id, sequence, status, requested_at, resolved_at, payload_json)
        VALUES (?, ?, ?, 'pending', ?, NULL, ?)
        ON CONFLICT(id) DO NOTHING
      `).run(approvalId, event.sessionId, event.sequence, event.occurredAt, canonicalJson(event));
      return;
    }
    if (event.type === 'approval_resolved') {
      const approved = event.approved === true;
      const changed = this.database.prepare(`
        UPDATE approvals SET status = ?, resolved_at = ?, payload_json = ? WHERE id = ? AND session_id = ?
      `).run(approved ? 'approved' : 'declined', event.occurredAt, canonicalJson(event), approvalId, event.sessionId);
      if (changed.changes === 0) {
        this.database.prepare(`
          INSERT INTO approvals (id, session_id, sequence, status, requested_at, resolved_at, payload_json)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          approvalId, event.sessionId, event.sequence, approved ? 'approved' : 'declined',
          event.occurredAt, event.occurredAt, canonicalJson(event),
        );
      }
    }
  }

  private projectResult(event: PersistableRuntimeEvent, options: SaveRuntimeEventOptions, eventJson: string): void {
    if (event.type !== 'result') return;
    const id = `res_${sha256Hex(`${event.sessionId}:${event.sequence}`).slice(0, 32)}`;
    this.database.prepare(`
      INSERT INTO result_packages (id, tenant_id, session_id, work_order_id, status, payload_json, created_at)
      VALUES (?, ?, ?, ?, 'delivered', ?, ?)
      ON CONFLICT(id) DO NOTHING
    `).run(id, options.tenantId, event.sessionId, options.workOrderId ?? null, eventJson, event.occurredAt);
  }
}

function isJsonObject(value: unknown): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sessionStatus(event: PersistableRuntimeEvent): string {
  if (event.type === 'result') return 'delivered';
  if (event.type === 'approval_required') return 'awaiting_approval';
  if (event.type === 'approval_resolved') return event.approved === false ? 'blocked' : 'running';
  if (event.type === 'status' && typeof event.status === 'string') return event.status;
  return 'running';
}

function stringField(event: PersistableRuntimeEvent, key: string): string | undefined {
  const value = event[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function validateRuntimeEvent(event: PersistableRuntimeEvent, options: SaveRuntimeEventOptions): void {
  if (!event.sessionId || !Number.isSafeInteger(event.sequence) || event.sequence < 1 || !event.occurredAt || !event.actorRef || !event.type) {
    throw new TypeError('RuntimeEvent requires sessionId, positive sequence, occurredAt, actorRef and type');
  }
  if (!Array.isArray(event.evidenceRefs) || !event.evidenceRefs.every((ref) => typeof ref === 'string')) {
    throw new TypeError('RuntimeEvent evidenceRefs must be an array of strings');
  }
  if (!options.tenantId || !options.runtimeId || !options.correlationId) {
    throw new TypeError('RuntimeEvent persistence requires tenantId, runtimeId and correlationId');
  }
  canonicalJson(event);
}
