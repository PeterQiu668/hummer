import { canonicalJson, sha256Hex, type JsonValue } from './canonical-json.js';
import type { SqliteDatabase } from './sqlite.js';
import { computeTenantEventHash } from './tenant-chain.js';

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
  | {
    valid: false;
    checked: number;
    eventId: string;
    reason: 'payload_not_canonical' | 'previous_hash_mismatch' | 'hash_mismatch'
      | 'tenant_position_mismatch' | 'tenant_head_mismatch' | 'missing_event';
  };

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

interface TenantChainRow extends DomainEventRow {
  tenant_position: number;
  tenant_previous_hash: string | null;
  tenant_hash: string;
  chain_event_id: string;
  tenant_created_at: string;
}

interface TenantChainHeadRow {
  position: number;
  hash: string;
  updated_at: string;
}

export class DomainEventStore {
  constructor(private readonly database: SqliteDatabase) {}

  append(input: DomainEventInput): StoredDomainEvent {
    assertDomainEvent(input);
    const appendTransaction = this.database.transaction(() => {
      const existing = this.database.prepare('SELECT * FROM domain_events WHERE tenant_id = ? AND id = ?')
        .get<DomainEventRow>(input.tenantId, input.id);
      if (existing) {
        const stored = mapRow(existing);
        if (canonicalJson(eventHashMaterial(stored)) !== canonicalJson(eventHashMaterial({ ...input, aggregateVersion: stored.aggregateVersion, canonicalPayload: canonicalJson(input.payload), previousHash: stored.previousHash }))) {
          throw new Error(`Domain event ${input.id} already exists with different content`);
        }
        const chain = this.database.prepare(`
          SELECT tenant_position AS position, hash FROM tenant_event_chain
          WHERE tenant_id = ? AND event_id = ?
        `).get<{ position: number; hash: string }>(input.tenantId, input.id);
        if (!chain) throw new Error('Tenant event chain is invalid');
        return stored;
      }
      const foreignId = this.database.prepare('SELECT 1 AS found FROM domain_events WHERE id = ?')
        .get<{ found: number }>(input.id);
      if (foreignId) throw new Error('Domain event is unavailable in the current tenant');

      const previous = this.database.prepare('SELECT hash FROM domain_events ORDER BY position DESC LIMIT 1').get<{ hash: string }>();
      const tenantHead = this.database.prepare(`
        SELECT position, hash, updated_at FROM tenant_chain_heads WHERE tenant_id = ?
      `).get<TenantChainHeadRow>(input.tenantId);
      const aggregate = this.database.prepare(`
        SELECT COALESCE(MAX(aggregate_version), 0) AS version
        FROM domain_events WHERE tenant_id = ? AND aggregate_type = ? AND aggregate_id = ?
      `).get<{ version: number }>(input.tenantId, input.aggregateType, input.aggregateId);
      const aggregateVersion = (aggregate?.version ?? 0) + 1;
      const canonicalPayload = canonicalJson(input.payload);
      const previousHash = previous?.hash ?? null;
      const hash = computeEventHash({ ...input, aggregateVersion, canonicalPayload, previousHash });
      const tenantPosition = (tenantHead?.position ?? 0) + 1;
      const tenantPreviousHash = tenantHead?.hash ?? null;
      const tenantHash = computeTenantEventHash({ ...input, aggregateVersion }, tenantPosition, tenantPreviousHash);
      const result = this.database.prepare(`
        INSERT INTO domain_events (
          id, tenant_id, aggregate_type, aggregate_id, aggregate_version, event_type,
          occurred_at, actor_ref, correlation_id, canonical_payload, previous_hash, hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.id, input.tenantId, input.aggregateType, input.aggregateId, aggregateVersion, input.type,
        input.occurredAt, input.actorRef, input.correlationId, canonicalPayload, previousHash, hash,
      );
      this.database.prepare(`
        INSERT INTO tenant_event_chain (tenant_id, tenant_position, event_id, previous_hash, hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(input.tenantId, tenantPosition, input.id, tenantPreviousHash, tenantHash, input.occurredAt);
      this.database.prepare(`
        INSERT INTO tenant_chain_heads (tenant_id, position, hash, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT (tenant_id) DO UPDATE SET
          position = excluded.position,
          hash = excluded.hash,
          updated_at = excluded.updated_at
      `).run(input.tenantId, tenantPosition, tenantHash, input.occurredAt);
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

  listByTenant(tenantId: string): StoredDomainEvent[] {
    return this.database.prepare('SELECT * FROM domain_events WHERE tenant_id = ? ORDER BY position')
      .all<DomainEventRow>(tenantId).map(mapRow);
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

  verifyTenantIntegrity(tenantId: string): IntegrityResult {
    const rows = this.database.prepare(`
      SELECT
        c.tenant_position,
        c.previous_hash AS tenant_previous_hash,
        c.hash AS tenant_hash,
        c.event_id AS chain_event_id,
        c.created_at AS tenant_created_at,
        d.*
      FROM tenant_event_chain c
      LEFT JOIN domain_events d ON d.id = c.event_id AND d.tenant_id = c.tenant_id
      WHERE c.tenant_id = ?
      ORDER BY c.tenant_position
    `).all<TenantChainRow>(tenantId);
    const unchained = this.database.prepare(`
      SELECT d.id FROM domain_events d
      LEFT JOIN tenant_event_chain c ON c.tenant_id = d.tenant_id AND c.event_id = d.id
      WHERE d.tenant_id = ? AND c.event_id IS NULL
      ORDER BY d.position LIMIT 1
    `).get<{ id: string }>(tenantId);
    if (unchained) return { valid: false, checked: 0, eventId: unchained.id, reason: 'missing_event' };
    let expectedPosition = 1;
    let expectedPreviousHash: string | null = null;
    let checked = 0;
    for (const row of rows) {
      checked += 1;
      if (!row.id || row.chain_event_id !== row.id) {
        return { valid: false, checked, eventId: row.chain_event_id, reason: 'missing_event' };
      }
      if (row.tenant_position !== expectedPosition) {
        return { valid: false, checked, eventId: row.id, reason: 'tenant_position_mismatch' };
      }
      if (row.tenant_previous_hash !== expectedPreviousHash) {
        return { valid: false, checked, eventId: row.id, reason: 'previous_hash_mismatch' };
      }
      if (row.tenant_created_at !== row.occurred_at) {
        return { valid: false, checked, eventId: row.id, reason: 'hash_mismatch' };
      }
      let payload: JsonValue;
      try {
        payload = JSON.parse(row.canonical_payload) as JsonValue;
        if (canonicalJson(payload) !== row.canonical_payload) {
          return { valid: false, checked, eventId: row.id, reason: 'payload_not_canonical' };
        }
      } catch {
        return { valid: false, checked, eventId: row.id, reason: 'payload_not_canonical' };
      }
      const stored = mapRow(row, payload);
      if (computeTenantEventHash(stored, row.tenant_position, row.tenant_previous_hash) !== row.tenant_hash) {
        return { valid: false, checked, eventId: row.id, reason: 'hash_mismatch' };
      }
      expectedPosition += 1;
      expectedPreviousHash = row.tenant_hash;
    }
    const head = this.database.prepare(`
      SELECT position, hash, updated_at FROM tenant_chain_heads WHERE tenant_id = ?
    `).get<TenantChainHeadRow>(tenantId);
    if (rows.length === 0) {
      if (head) return { valid: false, checked, eventId: `tenant:${tenantId}`, reason: 'tenant_head_mismatch' };
      return { valid: true, checked };
    }
    if (!head || head.position !== rows.length || head.hash !== expectedPreviousHash
      || head.updated_at !== rows.at(-1)?.occurred_at) {
      return {
        valid: false,
        checked,
        eventId: rows.at(-1)?.id ?? `tenant:${tenantId}`,
        reason: 'tenant_head_mismatch',
      };
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
