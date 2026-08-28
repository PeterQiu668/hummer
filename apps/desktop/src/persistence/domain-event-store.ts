import { canonicalJson, sha256Hex, type JsonValue } from './canonical-json.js';
import type { SqliteDatabase } from './sqlite.js';

export interface DomainEventInput {
  id: string;
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
  type: string;
  occurredAt: string;
  actorRef: string;
  correlationId: string;
  payload: JsonValue;
}

export interface StoredDomainEvent extends DomainEventInput {
  position: number;
  aggregateVersion: number;
  canonicalPayload: string;
  previousHash: string | null;
  hash: string;
}

export type IntegrityResult =
  | { valid: true; checked: number }
  | { valid: false; checked: number; eventId: string; reason: 'payload_not_canonical' | 'previous_hash_mismatch' | 'hash_mismatch' };

interface DomainEventRow {
  position: number;
  id: string;
  tenant_id: string;
  aggregate_type: string;
  aggregate_id: string;
  aggregate_version: number;
  event_type: string;
  occurred_at: string;
  actor_ref: string;
  correlation_id: string;
  canonical_payload: string;
  previous_hash: string | null;
  hash: string;
}

export class DomainEventStore {
  constructor(private readonly database: SqliteDatabase) {}

  append(input: DomainEventInput): StoredDomainEvent {
    assertDomainEvent(input);
    const appendTransaction = this.database.transaction(() => {
      const existing = this.database.prepare('SELECT * FROM domain_events WHERE id = ?').get<DomainEventRow>(input.id);
      if (existing) {
        const stored = mapRow(existing);
        if (canonicalJson(eventHashMaterial(stored)) !== canonicalJson(eventHashMaterial({ ...input, aggregateVersion: stored.aggregateVersion, canonicalPayload: canonicalJson(input.payload), previousHash: stored.previousHash }))) {
          throw new Error(`Domain event ${input.id} already exists with different content`);
        }
        return stored;
      }

      const previous = this.database.prepare('SELECT hash FROM domain_events ORDER BY position DESC LIMIT 1').get<{ hash: string }>();
      const aggregate = this.database.prepare(`
        SELECT COALESCE(MAX(aggregate_version), 0) AS version
        FROM domain_events WHERE tenant_id = ? AND aggregate_type = ? AND aggregate_id = ?
      `).get<{ version: number }>(input.tenantId, input.aggregateType, input.aggregateId);
      const aggregateVersion = (aggregate?.version ?? 0) + 1;
      const canonicalPayload = canonicalJson(input.payload);
      const previousHash = previous?.hash ?? null;
      const hash = computeEventHash({ ...input, aggregateVersion, canonicalPayload, previousHash });
      const result = this.database.prepare(`
        INSERT INTO domain_events (
          id, tenant_id, aggregate_type, aggregate_id, aggregate_version, event_type,
          occurred_at, actor_ref, correlation_id, canonical_payload, previous_hash, hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.id, input.tenantId, input.aggregateType, input.aggregateId, aggregateVersion, input.type,
        input.occurredAt, input.actorRef, input.correlationId, canonicalPayload, previousHash, hash,
      );
      return {
        ...input,
        position: Number(result.lastInsertRowid),
        aggregateVersion,
        canonicalPayload,
        previousHash,
        hash,
      };
    });
    return appendTransaction();
  }

  list(): StoredDomainEvent[] {
    return this.database.prepare('SELECT * FROM domain_events ORDER BY position').all<DomainEventRow>().map(mapRow);
  }

  verifyIntegrity(): IntegrityResult {
    const rows = this.database.prepare('SELECT * FROM domain_events ORDER BY position').all<DomainEventRow>();
    let expectedPreviousHash: string | null = null;
    let checked = 0;
    for (const row of rows) {
      checked += 1;
      let payload: JsonValue;
      try {
        payload = JSON.parse(row.canonical_payload) as JsonValue;
        if (canonicalJson(payload) !== row.canonical_payload) {
          return { valid: false, checked, eventId: row.id, reason: 'payload_not_canonical' };
        }
      } catch {
        return { valid: false, checked, eventId: row.id, reason: 'payload_not_canonical' };
      }
      if (row.previous_hash !== expectedPreviousHash) {
        return { valid: false, checked, eventId: row.id, reason: 'previous_hash_mismatch' };
      }
      const stored = mapRow(row, payload);
      if (computeEventHash(stored) !== row.hash) {
        return { valid: false, checked, eventId: row.id, reason: 'hash_mismatch' };
      }
      expectedPreviousHash = row.hash;
    }
    return { valid: true, checked };
  }
}

function computeEventHash(event: Omit<StoredDomainEvent, 'position' | 'hash'>): string {
  return sha256Hex(canonicalJson(eventHashMaterial(event)));
}

function eventHashMaterial(event: Omit<StoredDomainEvent, 'position' | 'hash' | 'payload'> & { payload?: JsonValue }): JsonValue {
  const payload = event.payload ?? JSON.parse(event.canonicalPayload) as JsonValue;
  return {
    actorRef: event.actorRef,
    aggregateId: event.aggregateId,
    aggregateType: event.aggregateType,
    aggregateVersion: event.aggregateVersion,
    correlationId: event.correlationId,
    id: event.id,
    occurredAt: event.occurredAt,
    payload,
    previousHash: event.previousHash,
    tenantId: event.tenantId,
    type: event.type,
  };
}

function mapRow(row: DomainEventRow, parsedPayload?: JsonValue): StoredDomainEvent {
  return {
    position: row.position,
    id: row.id,
    tenantId: row.tenant_id,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    aggregateVersion: row.aggregate_version,
    type: row.event_type,
    occurredAt: row.occurred_at,
    actorRef: row.actor_ref,
    correlationId: row.correlation_id,
    payload: parsedPayload ?? JSON.parse(row.canonical_payload) as JsonValue,
    canonicalPayload: row.canonical_payload,
    previousHash: row.previous_hash,
    hash: row.hash,
  };
}

function assertDomainEvent(input: DomainEventInput): void {
  for (const [field, value] of Object.entries({
    id: input.id, tenantId: input.tenantId, aggregateType: input.aggregateType, aggregateId: input.aggregateId,
    type: input.type, occurredAt: input.occurredAt, actorRef: input.actorRef, correlationId: input.correlationId,
  })) {
    if (typeof value !== 'string' || value.length === 0) throw new TypeError(`Domain event ${field} is required`);
  }
  canonicalJson(input.payload);
}
