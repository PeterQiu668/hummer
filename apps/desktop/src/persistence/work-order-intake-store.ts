import { randomUUID } from 'node:crypto';
import { canonicalJson, sha256Hex, type JsonValue } from './canonical-json.js';
import { DomainEventStore } from './domain-event-store.js';
import type { EvidenceStore } from './evidence-store.js';
import type { SqliteDatabase } from './sqlite.js';

export type WorkOrderIntakeSource = 'folder' | 'form';
export type WorkOrderIntakeStatus = 'pending' | 'confirmed' | 'cancelled';

export interface WorkOrderIntakePayload {
  title: string;
  target: string;
  expectedDeliverable: string;
  assignee: string;
  dueAt: string | null;
  attachmentNames: string[];
  prompt: string;
  [key: string]: JsonValue;
}

export interface WorkOrderIntakeRecord {
  id: string;
  tenantId: string;
  source: WorkOrderIntakeSource;
  externalRef: string;
  receivedAt: string;
  status: WorkOrderIntakeStatus;
  payloadEvidenceRef: string;
  payload: WorkOrderIntakePayload;
  workOrderId: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IntakeWorkOrderInput {
  tenantId: string;
  source: WorkOrderIntakeSource;
  externalRef: string;
  payload: WorkOrderIntakePayload;
  payloadBytes: Uint8Array;
  payloadMediaType: string;
  payloadName: string;
  actorRef: string;
  receivedAt: string;
}

interface IntakeRow {
  id: string; tenant_id: string; source: WorkOrderIntakeSource; external_ref: string; received_at: string;
  status: WorkOrderIntakeStatus; payload_evidence_ref: string; payload_json: string; work_order_id: string | null;
  confirmed_by: string | null; confirmed_at: string | null; created_at: string; updated_at: string;
}

interface InboxRow { tenant_id: string; directory: string; enabled: number; created_at: string; updated_at: string }

export class WorkOrderIntakeStore {
  private readonly events: DomainEventStore;

  constructor(
    private readonly database: SqliteDatabase,
    private readonly evidence: EvidenceStore,
  ) {
    this.events = new DomainEventStore(database);
  }

  intake(input: IntakeWorkOrderInput): WorkOrderIntakeRecord {
    validateInput(input);
    const existing = this.findByExternalRef(input.tenantId, input.source, input.externalRef);
    if (existing) return existing;
    const id = `intake_${sha256Hex(`${input.tenantId}:${input.source}:${input.externalRef}`).slice(0, 32)}`;
    const storedEvidence = this.evidence.put(input.payloadBytes, {
      tenantId: input.tenantId,
      sessionId: id,
      mediaType: input.payloadMediaType,
      name: input.payloadName,
      createdAt: input.receivedAt,
      metadata: { source: 'work-order-intake', intakeSource: input.source, externalRef: input.externalRef },
    });
    const payloadJson = canonicalJson(input.payload);
    const save = this.database.transaction(() => {
      this.database.prepare(`
        INSERT INTO work_order_intake
          (id, tenant_id, source, external_ref, received_at, status, payload_evidence_ref, payload_json,
           work_order_id, confirmed_by, confirmed_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, NULL, NULL, NULL, ?, ?)
      `).run(id, input.tenantId, input.source, input.externalRef, input.receivedAt, storedEvidence.ref, payloadJson, input.receivedAt, input.receivedAt);
      this.events.append({
        id: `evt_${randomUUID()}`, tenantId: input.tenantId, aggregateType: 'work_order_intake', aggregateId: id,
        type: 'work_order_intake.received', occurredAt: input.receivedAt, actorRef: input.actorRef,
        correlationId: `corr_${id}`, payload: {
          source: input.source, externalRef: input.externalRef, payloadEvidenceRef: storedEvidence.ref,
          title: input.payload.title, status: 'pending',
        },
      });
    });
    save();
    return this.require(input.tenantId, id);
  }

  list(tenantId: string, status?: WorkOrderIntakeStatus): WorkOrderIntakeRecord[] {
    const rows = status
      ? this.database.prepare('SELECT * FROM work_order_intake WHERE tenant_id = ? AND status = ? ORDER BY received_at DESC, id DESC').all<IntakeRow>(tenantId, status)
      : this.database.prepare('SELECT * FROM work_order_intake WHERE tenant_id = ? ORDER BY received_at DESC, id DESC').all<IntakeRow>(tenantId);
    return rows.map(mapRow);
  }

  confirm(tenantId: string, id: string, actorRef: string, occurredAt: string): WorkOrderIntakeRecord {
    const current = this.require(tenantId, id);
    if (current.status === 'confirmed') return current;
    if (current.status !== 'pending') throw new Error('Only pending work order intake can be confirmed');
    if (current.payload.executable === false) throw new Error('This file type has no implemented capability and cannot be confirmed for execution');
    const workOrderId = `wo_intake_${sha256Hex(`${tenantId}:${id}`).slice(0, 24)}`;
    const confirm = this.database.transaction(() => {
      const changed = this.database.prepare(`
        UPDATE work_order_intake
        SET status = 'confirmed', work_order_id = ?, confirmed_by = ?, confirmed_at = ?, updated_at = ?
        WHERE id = ? AND tenant_id = ? AND status = 'pending'
      `).run(workOrderId, actorRef, occurredAt, occurredAt, id, tenantId);
      if (changed.changes !== 1) throw new Error('Work order intake confirmation lost a concurrent update');
      this.database.prepare(`
        INSERT INTO work_orders (id, tenant_id, status, title, payload_json, created_at, updated_at)
        VALUES (?, ?, 'submitted', ?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING
      `).run(workOrderId, tenantId, current.payload.title, canonicalJson({ intakeId: id, ...current.payload }), current.receivedAt, occurredAt);
      this.events.append({
        id: `evt_${randomUUID()}`, tenantId, aggregateType: 'work_order_intake', aggregateId: id,
        type: 'work_order_intake.confirmed', occurredAt, actorRef, correlationId: `corr_${id}`,
        payload: { status: 'confirmed', workOrderId, payloadEvidenceRef: current.payloadEvidenceRef },
      });
    });
    confirm();
    return this.require(tenantId, id);
  }

  configureInbox(tenantId: string, directory: string, occurredAt: string): { tenantId: string; directory: string; enabled: boolean } {
    if (!tenantId || !directory) throw new TypeError('Inbox tenant and directory are required');
    this.database.prepare(`
      INSERT INTO work_order_inbox (tenant_id, directory, enabled, created_at, updated_at)
      VALUES (?, ?, 1, ?, ?)
      ON CONFLICT(tenant_id) DO UPDATE SET directory = excluded.directory, enabled = 1, updated_at = excluded.updated_at
    `).run(tenantId, directory, occurredAt, occurredAt);
    return { tenantId, directory, enabled: true };
  }

  inbox(tenantId: string): { tenantId: string; directory: string; enabled: boolean } | null {
    const row = this.database.prepare('SELECT * FROM work_order_inbox WHERE tenant_id = ?').get<InboxRow>(tenantId);
    return row ? { tenantId: row.tenant_id, directory: row.directory, enabled: row.enabled === 1 } : null;
  }

  listInboxes(): Array<{ tenantId: string; directory: string; enabled: boolean }> {
    return this.database.prepare('SELECT * FROM work_order_inbox WHERE enabled = 1 ORDER BY tenant_id')
      .all<InboxRow>().map((row) => ({ tenantId: row.tenant_id, directory: row.directory, enabled: true }));
  }

  private require(tenantId: string, id: string): WorkOrderIntakeRecord {
    const row = this.database.prepare('SELECT * FROM work_order_intake WHERE tenant_id = ? AND id = ?').get<IntakeRow>(tenantId, id);
    if (!row) throw new Error('Work order intake is unavailable in the current tenant');
    return mapRow(row);
  }

  private findByExternalRef(tenantId: string, source: WorkOrderIntakeSource, externalRef: string): WorkOrderIntakeRecord | undefined {
    const row = this.database.prepare('SELECT * FROM work_order_intake WHERE tenant_id = ? AND source = ? AND external_ref = ?')
      .get<IntakeRow>(tenantId, source, externalRef);
    return row ? mapRow(row) : undefined;
  }
}

function mapRow(row: IntakeRow): WorkOrderIntakeRecord {
  return {
    id: row.id, tenantId: row.tenant_id, source: row.source, externalRef: row.external_ref, receivedAt: row.received_at,
    status: row.status, payloadEvidenceRef: row.payload_evidence_ref,
    payload: JSON.parse(row.payload_json) as WorkOrderIntakePayload,
    workOrderId: row.work_order_id, confirmedBy: row.confirmed_by, confirmedAt: row.confirmed_at,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function validateInput(input: IntakeWorkOrderInput): void {
  for (const [field, value] of Object.entries({
    tenantId: input.tenantId, source: input.source, externalRef: input.externalRef, actorRef: input.actorRef,
    receivedAt: input.receivedAt, payloadMediaType: input.payloadMediaType, payloadName: input.payloadName,
  })) if (typeof value !== 'string' || !value.trim()) throw new TypeError(`Work order intake ${field} is required`);
  if (!['folder', 'form'].includes(input.source)) throw new TypeError('Work order intake source must be folder or form');
  for (const field of ['title', 'target', 'expectedDeliverable', 'assignee', 'prompt'] as const) {
    if (!input.payload[field]?.trim()) throw new TypeError(`Work order intake payload ${field} is required`);
  }
  if (!Array.isArray(input.payload.attachmentNames)) throw new TypeError('Work order intake attachmentNames must be an array');
  canonicalJson(input.payload);
}
