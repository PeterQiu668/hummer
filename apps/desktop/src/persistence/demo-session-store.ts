import { randomUUID } from 'node:crypto';
import { canonicalJson, sha256Hex, type JsonValue } from './canonical-json.js';
import { DomainEventStore } from './domain-event-store.js';
import type { SqliteDatabase } from './sqlite.js';

export type DemoCaptureMetadata =
  | {
      kind: 'ax-node';
      role: string;
      name?: string;
      automationId?: string;
    }
  | {
      kind: 'input-event';
      action: 'click' | 'scroll' | 'key';
      target?: string;
      keyClass?: 'navigation' | 'command' | 'text-entry';
    }
  | {
      kind: 'keyframe-metadata';
      frameId: string;
      width: number;
      height: number;
      changedRegions: number;
      sha256: string;
    };

export interface DemoSourceBoundary {
  apps: string[];
  windows: string[];
  excluded: string[];
}

export interface DemoSessionSegment {
  segId: string;
  sequence: number;
  from: string;
  to?: string;
  deletedAt?: string;
  recordCount: number;
  previousDigest: string | null;
  digest: string;
}

export interface DemoDeletionAuditEntry {
  segId: string;
  requestedAt: string;
  by: string;
  purgedAt: string;
  previousDigest: string;
  replacementDigest: string;
}

export interface DemoSessionV1 {
  schema: 'hummer.demo-session';
  version: 1;
  sessionId: string;
  tenantId: string;
  expertActorRef: string;
  nodeId: string;
  sourceBoundary: DemoSourceBoundary;
  startedAt: string;
  endedAt?: string;
  pausedCount: number;
  segments: DemoSessionSegment[];
  captureMode: 'ax-tree+keyframes' | 'events-only';
  status: 'capturing' | 'paused' | 'ended';
  localOnly: true;
  redactionApplied: boolean;
  redactionPolicyRef?: string;
  evidenceRefs: string[];
  chainHead: string;
  deletionAudit: DemoDeletionAuditEntry[];
}

export interface StartDemoSessionInput {
  sessionId: string;
  tenantId: string;
  expertActorRef: string;
  nodeId: string;
  sourceBoundary: DemoSourceBoundary;
  captureMode: DemoSessionV1['captureMode'];
}

export interface IngestDemoCaptureInput {
  tenantId: string;
  sessionId: string;
  app: string;
  window: string;
  metadata: DemoCaptureMetadata;
  occurredAt?: string;
}

export interface IngestDemoCaptureBatchInput {
  tenantId: string;
  sessionId: string;
  app: string;
  window: string;
  metadata: DemoCaptureMetadata[];
  occurredAt?: string;
}

export type DemoCaptureIngestResult =
  | { accepted: true; segmentId: string; sequence: number; digest: string }
  | { accepted: false; reason: 'paused' | 'ended' | 'outside_source_boundary' };

interface DemoSessionRow {
  tenant_id: string;
  session_id: string;
  expert_actor_ref: string;
  node_id: string;
  source_boundary_json: string;
  capture_mode: DemoSessionV1['captureMode'];
  status: DemoSessionV1['status'];
  started_at: string;
  ended_at: string | null;
  paused_count: number;
  local_only: number;
  redaction_applied: number;
  redaction_policy_ref: string | null;
  evidence_refs_json: string;
  chain_head: string;
  deletion_audit_json: string;
}

interface DemoSegmentRow {
  segment_id: string;
  sequence: number;
  started_at: string;
  ended_at: string | null;
  deleted_at: string | null;
  record_count: number;
  previous_digest: string | null;
  digest: string;
}

interface DemoRecordRow {
  sequence: number;
  digest: string;
}

const SESSION_UNAVAILABLE = 'Demo session is unavailable in the current tenant';

export class DemoSessionStore {
  private readonly events: DomainEventStore;

  constructor(private readonly database: SqliteDatabase, private readonly now: () => Date = () => new Date()) {
    this.events = new DomainEventStore(database);
  }

  start(input: StartDemoSessionInput): DemoSessionV1 {
    const actor = requireHumanActor(input.expertActorRef);
    this.requireHumanMember(input.tenantId, actor);
    const sessionId = required(input.sessionId, 'Demo session id');
    const nodeId = required(input.nodeId, 'Demo session node id');
    const sourceBoundary = validateSourceBoundary(input.sourceBoundary);
    if (input.captureMode !== 'ax-tree+keyframes' && input.captureMode !== 'events-only') {
      throw new TypeError('Demo session capture mode is unsupported');
    }
    const startedAt = this.now().toISOString();
    const segmentId = `seg_${randomUUID().replaceAll('-', '')}`;
    const initialDigest = segmentDigest({
      sessionId,
      segmentId,
      sequence: 1,
      from: startedAt,
      to: null,
      deletedAt: null,
      previousDigest: null,
      recordDigests: [],
    });
    return this.database.transaction(() => {
      const foreign = this.database.prepare('SELECT 1 AS found FROM demo_sessions WHERE session_id = ?')
        .get<{ found: number }>(sessionId);
      if (foreign) throw new Error(SESSION_UNAVAILABLE);
      this.database.prepare(`
        INSERT INTO demo_sessions (
          tenant_id, session_id, expert_actor_ref, node_id, source_boundary_json,
          capture_mode, status, started_at, paused_count, local_only,
          redaction_applied, evidence_refs_json, chain_head, deletion_audit_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'capturing', ?, 0, 1, 0, '[]', ?, '[]', ?)
      `).run(
        input.tenantId, sessionId, actor, nodeId, canonicalJson(sourceBoundary),
        input.captureMode, startedAt, initialDigest, startedAt,
      );
      this.database.prepare(`
        INSERT INTO demo_session_segments (
          tenant_id, session_id, segment_id, sequence, started_at, record_count, previous_digest, digest
        ) VALUES (?, ?, ?, 1, ?, 0, NULL, ?)
      `).run(input.tenantId, sessionId, segmentId, startedAt, initialDigest);
      this.appendEvent(input.tenantId, sessionId, actor, 'demo_session.started', startedAt, {
        captureMode: input.captureMode,
        nodeId,
        sourceBoundary: {
          apps: [...sourceBoundary.apps],
          windows: [...sourceBoundary.windows],
          excluded: [...sourceBoundary.excluded],
        },
      });
      return this.require(input.tenantId, sessionId);
    })();
  }

  get(tenantId: string, sessionId: string): DemoSessionV1 {
    return this.require(tenantId, sessionId);
  }

  ingest(input: IngestDemoCaptureInput): DemoCaptureIngestResult {
    return this.database.transaction(() => this.ingestInTransaction(input))();
  }

  ingestBatch(input: IngestDemoCaptureBatchInput): DemoCaptureIngestResult[] {
    if (!Array.isArray(input.metadata) || input.metadata.length === 0 || input.metadata.length > 128) {
      throw new TypeError('Capture metadata batch must contain between 1 and 128 records');
    }
    const occurredAt = input.occurredAt ?? this.now().toISOString();
    return this.database.transaction(() => input.metadata.map((metadata) => this.ingestInTransaction({
      tenantId: input.tenantId,
      sessionId: input.sessionId,
      app: input.app,
      window: input.window,
      metadata,
      occurredAt,
    })))();
  }

  private ingestInTransaction(input: IngestDemoCaptureInput): DemoCaptureIngestResult {
    const app = required(input.app, 'Capture application');
    const window = required(input.window, 'Capture window');
    const metadata = validateCaptureMetadata(input.metadata);
    const occurredAt = input.occurredAt ?? this.now().toISOString();
    // Re-read status and boundary inside the write transaction so a concurrent
    // pause cannot race a capture record into storage.
    const session = this.require(input.tenantId, input.sessionId);
    if (session.status === 'paused') return { accepted: false as const, reason: 'paused' as const };
    if (session.status === 'ended') return { accepted: false as const, reason: 'ended' as const };
    if (!withinBoundary(session.sourceBoundary, app, window)) {
      return { accepted: false as const, reason: 'outside_source_boundary' as const };
    }
    if (session.captureMode === 'events-only' && metadata.kind === 'keyframe-metadata') {
      throw new Error('Keyframe metadata is not permitted in events-only capture mode');
    }
    const active = this.database.prepare(`
        SELECT * FROM demo_session_segments
        WHERE tenant_id = ? AND session_id = ? AND ended_at IS NULL AND deleted_at IS NULL
        ORDER BY sequence DESC LIMIT 1
      `).get<DemoSegmentRow>(input.tenantId, input.sessionId);
    if (!active) throw new Error('Capturing demo session has no active segment');
    if (occurredAt < active.started_at) throw new TypeError('Capture event precedes the active segment');
    const sequence = (this.database.prepare(`
        SELECT COALESCE(MAX(sequence), 0) AS sequence FROM demo_session_records
        WHERE tenant_id = ? AND session_id = ? AND segment_id = ?
      `).get<{ sequence: number }>(input.tenantId, input.sessionId, active.segment_id)?.sequence ?? 0) + 1;
    const recordDigest = sha256Hex(canonicalJson({ app, metadata, occurredAt, sequence, window }));
    this.database.prepare(`
        INSERT INTO demo_session_records (
          tenant_id, session_id, segment_id, sequence, kind, occurred_at,
          app_name, window_name, metadata_json, digest
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.tenantId, input.sessionId, active.segment_id, sequence, metadata.kind,
        occurredAt, app, window, canonicalJson(metadata), recordDigest,
      );
    this.database.prepare(`
        UPDATE demo_session_segments SET record_count = record_count + 1
        WHERE tenant_id = ? AND session_id = ? AND segment_id = ?
      `).run(input.tenantId, input.sessionId, active.segment_id);
    const chainHead = this.rechain(input.tenantId, input.sessionId);
    this.database.prepare(`
        UPDATE demo_sessions SET chain_head = ?, updated_at = ?
        WHERE tenant_id = ? AND session_id = ?
      `).run(chainHead, occurredAt, input.tenantId, input.sessionId);
    return { accepted: true as const, segmentId: active.segment_id, sequence, digest: recordDigest };
  }

  pause(tenantId: string, sessionId: string, actorRef: string): DemoSessionV1 {
    const session = this.authorizeOwner(tenantId, sessionId, actorRef);
    if (session.status !== 'capturing') throw new Error('Only a capturing demo session can be paused');
    const at = this.now().toISOString();
    return this.database.transaction(() => {
      const closed = this.database.prepare(`
        UPDATE demo_session_segments SET ended_at = ?
        WHERE tenant_id = ? AND session_id = ? AND ended_at IS NULL AND deleted_at IS NULL
      `).run(at, tenantId, sessionId);
      if (closed.changes !== 1) throw new Error('Capturing demo session has no active segment');
      const chainHead = this.rechain(tenantId, sessionId);
      this.database.prepare(`
        UPDATE demo_sessions SET status = 'paused', paused_count = paused_count + 1,
          chain_head = ?, updated_at = ? WHERE tenant_id = ? AND session_id = ?
      `).run(chainHead, at, tenantId, sessionId);
      this.appendEvent(tenantId, sessionId, actorRef, 'demo_session.paused', at, { chainHead });
      return this.require(tenantId, sessionId);
    })();
  }

  resume(tenantId: string, sessionId: string, actorRef: string): DemoSessionV1 {
    const session = this.authorizeOwner(tenantId, sessionId, actorRef);
    if (session.status !== 'paused') throw new Error('Only a paused demo session can be resumed');
    const at = this.now().toISOString();
    const sequence = session.segments.length + 1;
    const segmentId = `seg_${randomUUID().replaceAll('-', '')}`;
    return this.database.transaction(() => {
      this.database.prepare(`
        INSERT INTO demo_session_segments (
          tenant_id, session_id, segment_id, sequence, started_at, record_count, previous_digest, digest
        ) VALUES (?, ?, ?, ?, ?, 0, ?, ?)
      `).run(tenantId, sessionId, segmentId, sequence, at, session.chainHead, session.chainHead);
      const chainHead = this.rechain(tenantId, sessionId);
      this.database.prepare(`
        UPDATE demo_sessions SET status = 'capturing', chain_head = ?, updated_at = ?
        WHERE tenant_id = ? AND session_id = ?
      `).run(chainHead, at, tenantId, sessionId);
      this.appendEvent(tenantId, sessionId, actorRef, 'demo_session.resumed', at, { chainHead, segmentId });
      return this.require(tenantId, sessionId);
    })();
  }

  end(tenantId: string, sessionId: string, actorRef: string): DemoSessionV1 {
    const session = this.authorizeOwner(tenantId, sessionId, actorRef);
    if (session.status === 'ended') return session;
    const at = this.now().toISOString();
    return this.database.transaction(() => {
      if (session.status === 'capturing') {
        this.database.prepare(`
          UPDATE demo_session_segments SET ended_at = ?
          WHERE tenant_id = ? AND session_id = ? AND ended_at IS NULL AND deleted_at IS NULL
        `).run(at, tenantId, sessionId);
      }
      const chainHead = this.rechain(tenantId, sessionId);
      this.database.prepare(`
        UPDATE demo_sessions SET status = 'ended', ended_at = ?, chain_head = ?, updated_at = ?
        WHERE tenant_id = ? AND session_id = ?
      `).run(at, chainHead, at, tenantId, sessionId);
      this.appendEvent(tenantId, sessionId, actorRef, 'demo_session.ended', at, { chainHead });
      return this.require(tenantId, sessionId);
    })();
  }

  deleteSegment(tenantId: string, sessionId: string, segmentId: string, actorRef: string): DemoSessionV1 {
    const session = this.authorizeOwner(tenantId, sessionId, actorRef);
    const segment = this.database.prepare(`
      SELECT * FROM demo_session_segments
      WHERE tenant_id = ? AND session_id = ? AND segment_id = ?
    `).get<DemoSegmentRow>(tenantId, sessionId, segmentId);
    if (!segment) throw new Error('Demo session segment is unavailable in the current tenant');
    if (segment.deleted_at) return session;
    if (!segment.ended_at) throw new Error('Pause or end before deleting the active segment');
    const at = this.now().toISOString();
    return this.database.transaction(() => {
      this.database.prepare(`
        DELETE FROM demo_session_records
        WHERE tenant_id = ? AND session_id = ? AND segment_id = ?
      `).run(tenantId, sessionId, segmentId);
      this.database.prepare(`
        UPDATE demo_session_segments SET deleted_at = ?, record_count = 0
        WHERE tenant_id = ? AND session_id = ? AND segment_id = ?
      `).run(at, tenantId, sessionId, segmentId);
      const chainHead = this.rechain(tenantId, sessionId);
      const replacement = this.database.prepare(`
        SELECT digest FROM demo_session_segments
        WHERE tenant_id = ? AND session_id = ? AND segment_id = ?
      `).get<{ digest: string }>(tenantId, sessionId, segmentId)?.digest;
      if (!replacement) throw new Error('Deleted segment digest is unavailable');
      const deletionAudit: DemoDeletionAuditEntry[] = [
        ...session.deletionAudit,
        {
          segId: segmentId,
          requestedAt: at,
          by: actorRef,
          purgedAt: at,
          previousDigest: segment.digest,
          replacementDigest: replacement,
        },
      ];
      this.database.prepare(`
        UPDATE demo_sessions SET chain_head = ?, deletion_audit_json = ?, updated_at = ?
        WHERE tenant_id = ? AND session_id = ?
      `).run(chainHead, canonicalJson(deletionAudit), at, tenantId, sessionId);
      this.appendEvent(tenantId, sessionId, actorRef, 'demo_session.segment_deleted', at, {
        segmentId,
        previousDigest: segment.digest,
        replacementDigest: replacement,
        chainHead,
      });
      return this.require(tenantId, sessionId);
    })();
  }

  markRedactionApplied(tenantId: string, sessionId: string, actorRef: string, policyRef: string): DemoSessionV1 {
    const session = this.authorizeOwner(tenantId, sessionId, actorRef);
    if (session.status !== 'ended') throw new Error('Redaction can only be finalized after the demo session ends');
    const normalizedPolicy = required(policyRef, 'Redaction policy reference');
    const at = this.now().toISOString();
    return this.database.transaction(() => {
      this.database.prepare(`
        UPDATE demo_sessions SET redaction_applied = 1, redaction_policy_ref = ?, updated_at = ?
        WHERE tenant_id = ? AND session_id = ?
      `).run(normalizedPolicy, at, tenantId, sessionId);
      this.appendEvent(tenantId, sessionId, actorRef, 'demo_session.redaction_applied', at, {
        redactionPolicyRef: normalizedPolicy,
      });
      return this.require(tenantId, sessionId);
    })();
  }

  exportForEgress(tenantId: string, sessionId: string): DemoSessionV1 {
    const session = this.require(tenantId, sessionId);
    if (session.status !== 'ended') throw new Error('Demo session must end before egress');
    if (!session.redactionApplied || !session.redactionPolicyRef) {
      throw new Error('Unredacted demo session bytes cannot leave this device');
    }
    return structuredClone(session);
  }

  captureRecordCount(tenantId: string, sessionId: string, segmentId?: string): number {
    this.require(tenantId, sessionId);
    const row = segmentId
      ? this.database.prepare(`
          SELECT COUNT(*) AS count FROM demo_session_records
          WHERE tenant_id = ? AND session_id = ? AND segment_id = ?
        `).get<{ count: number }>(tenantId, sessionId, segmentId)
      : this.database.prepare(`
          SELECT COUNT(*) AS count FROM demo_session_records
          WHERE tenant_id = ? AND session_id = ?
        `).get<{ count: number }>(tenantId, sessionId);
    return row?.count ?? 0;
  }

  private authorizeOwner(tenantId: string, sessionId: string, actorRef: string): DemoSessionV1 {
    const actor = requireHumanActor(actorRef);
    this.requireHumanMember(tenantId, actor);
    const session = this.require(tenantId, sessionId);
    if (session.expertActorRef !== actor) throw new Error(SESSION_UNAVAILABLE);
    return session;
  }

  private require(tenantId: string, sessionId: string): DemoSessionV1 {
    const row = this.database.prepare(`
      SELECT * FROM demo_sessions WHERE tenant_id = ? AND session_id = ?
    `).get<DemoSessionRow>(tenantId, sessionId);
    if (!row) throw new Error(SESSION_UNAVAILABLE);
    const segments = this.database.prepare(`
      SELECT * FROM demo_session_segments
      WHERE tenant_id = ? AND session_id = ? ORDER BY sequence
    `).all<DemoSegmentRow>(tenantId, sessionId).map(mapSegment);
    const value: DemoSessionV1 = {
      schema: 'hummer.demo-session',
      version: 1,
      sessionId: row.session_id,
      tenantId: row.tenant_id,
      expertActorRef: row.expert_actor_ref,
      nodeId: row.node_id,
      sourceBoundary: JSON.parse(row.source_boundary_json) as DemoSourceBoundary,
      startedAt: row.started_at,
      ...(row.ended_at ? { endedAt: row.ended_at } : {}),
      pausedCount: row.paused_count,
      segments,
      captureMode: row.capture_mode,
      status: row.status,
      localOnly: true,
      redactionApplied: row.redaction_applied === 1,
      ...(row.redaction_policy_ref ? { redactionPolicyRef: row.redaction_policy_ref } : {}),
      evidenceRefs: JSON.parse(row.evidence_refs_json) as string[],
      chainHead: row.chain_head,
      deletionAudit: JSON.parse(row.deletion_audit_json) as DemoDeletionAuditEntry[],
    };
    if (row.local_only !== 1) throw new Error('Stored DemoSession violated the local-only invariant');
    return value;
  }

  private rechain(tenantId: string, sessionId: string): string {
    const segments = this.database.prepare(`
      SELECT * FROM demo_session_segments
      WHERE tenant_id = ? AND session_id = ? ORDER BY sequence
    `).all<DemoSegmentRow>(tenantId, sessionId);
    let previousDigest: string | null = null;
    for (const segment of segments) {
      const recordDigests = this.database.prepare(`
        SELECT sequence, digest FROM demo_session_records
        WHERE tenant_id = ? AND session_id = ? AND segment_id = ? ORDER BY sequence
      `).all<DemoRecordRow>(tenantId, sessionId, segment.segment_id).map((record) => record.digest);
      const digest = segmentDigest({
        sessionId,
        segmentId: segment.segment_id,
        sequence: segment.sequence,
        from: segment.started_at,
        to: segment.ended_at,
        deletedAt: segment.deleted_at,
        previousDigest,
        recordDigests,
      });
      this.database.prepare(`
        UPDATE demo_session_segments SET previous_digest = ?, digest = ?
        WHERE tenant_id = ? AND session_id = ? AND segment_id = ?
      `).run(previousDigest, digest, tenantId, sessionId, segment.segment_id);
      previousDigest = digest;
    }
    if (!previousDigest) throw new Error('Demo session requires at least one segment');
    return previousDigest;
  }

  private requireHumanMember(tenantId: string, actorRef: string): void {
    const humanUserId = actorRef.slice('human:'.length);
    const row = this.database.prepare(`
      SELECT 1 AS found FROM memberships
      WHERE tenant_id = ? AND human_user_id = ? AND status = 'active'
    `).get<{ found: number }>(tenantId, humanUserId);
    if (!row) throw new Error(SESSION_UNAVAILABLE);
  }

  private appendEvent(
    tenantId: string,
    sessionId: string,
    actorRef: string,
    type: string,
    occurredAt: string,
    payload: JsonValue,
  ): void {
    this.events.append({
      id: `evt_${randomUUID().replaceAll('-', '')}`,
      tenantId,
      aggregateType: 'demo_session',
      aggregateId: sessionId,
      type,
      occurredAt,
      actorRef,
      correlationId: `corr_${randomUUID().replaceAll('-', '')}`,
      payload,
    });
  }
}

function mapSegment(row: DemoSegmentRow): DemoSessionSegment {
  return {
    segId: row.segment_id,
    sequence: row.sequence,
    from: row.started_at,
    ...(row.ended_at ? { to: row.ended_at } : {}),
    ...(row.deleted_at ? { deletedAt: row.deleted_at } : {}),
    recordCount: row.record_count,
    previousDigest: row.previous_digest,
    digest: row.digest,
  };
}

function segmentDigest(input: {
  sessionId: string;
  segmentId: string;
  sequence: number;
  from: string;
  to: string | null;
  deletedAt: string | null;
  previousDigest: string | null;
  recordDigests: string[];
}): string {
  return sha256Hex(canonicalJson(input));
}

function withinBoundary(boundary: DemoSourceBoundary, app: string, window: string): boolean {
  const excluded = new Set(boundary.excluded);
  if (excluded.has(app) || excluded.has(window) || excluded.has(`${app}::${window}`)) return false;
  if (!boundary.apps.includes(app)) return false;
  return boundary.windows.includes(window);
}

function validateSourceBoundary(boundary: DemoSourceBoundary): DemoSourceBoundary {
  const value = structuredClone(boundary);
  if (!Array.isArray(value.apps) || value.apps.length === 0) throw new TypeError('At least one capture application is required');
  if (!Array.isArray(value.windows) || value.windows.length === 0) throw new TypeError('At least one capture window is required');
  for (const list of [value.apps, value.windows, value.excluded]) {
    if (!Array.isArray(list) || list.some((item) => typeof item !== 'string' || !item.trim())) {
      throw new TypeError('Demo source boundary entries must be non-empty strings');
    }
    if (new Set(list).size !== list.length) throw new TypeError('Demo source boundary entries must be unique');
  }
  if (value.apps.some((app) => value.excluded.includes(app)) ||
      value.windows.some((window) => value.excluded.includes(window))) {
    throw new TypeError('An allowed capture source cannot also be excluded');
  }
  return value;
}

function validateCaptureMetadata(metadata: DemoCaptureMetadata): DemoCaptureMetadata {
  if (!metadata || typeof metadata !== 'object') throw new TypeError('Capture metadata is required');
  if (metadata.kind === 'ax-node') {
    exactKeys(metadata, ['kind', 'role', 'name', 'automationId']);
    required(metadata.role, 'Accessibility role');
    optionalText(metadata.name, 'Accessibility name');
    optionalText(metadata.automationId, 'Accessibility automation id');
  } else if (metadata.kind === 'input-event') {
    exactKeys(metadata, ['kind', 'action', 'target', 'keyClass']);
    if (!['click', 'scroll', 'key'].includes(metadata.action)) throw new TypeError('Input event action is unsupported');
    optionalText(metadata.target, 'Input event target');
    if (metadata.keyClass && !['navigation', 'command', 'text-entry'].includes(metadata.keyClass)) {
      throw new TypeError('Input event key class is unsupported');
    }
  } else if (metadata.kind === 'keyframe-metadata') {
    exactKeys(metadata, ['kind', 'frameId', 'width', 'height', 'changedRegions', 'sha256']);
    required(metadata.frameId, 'Keyframe id');
    if (!Number.isSafeInteger(metadata.width) || metadata.width <= 0 ||
        !Number.isSafeInteger(metadata.height) || metadata.height <= 0 ||
        !Number.isSafeInteger(metadata.changedRegions) || metadata.changedRegions < 0) {
      throw new TypeError('Keyframe dimensions and changed-region count are invalid');
    }
    if (!/^[a-f0-9]{64}$/.test(metadata.sha256)) throw new TypeError('Keyframe digest is invalid');
  } else {
    throw new TypeError('Capture metadata kind is unsupported');
  }
  return structuredClone(metadata);
}

function exactKeys(value: object, allowed: string[]): void {
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length > 0) throw new TypeError(`Capture metadata contains unsupported fields: ${extras.join(', ')}`);
}

function optionalText(value: string | undefined, label: string): void {
  if (value !== undefined) required(value, label);
}

function requireHumanActor(value: string): string {
  const actor = required(value, 'Demo session expert actor');
  if (!/^human:[A-Za-z0-9_-]+$/.test(actor)) throw new TypeError('Demo session expert must be a human actor');
  return actor;
}

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} is required`);
  if (normalized.length > 512) throw new TypeError(`${label} is too long`);
  return normalized;
}
