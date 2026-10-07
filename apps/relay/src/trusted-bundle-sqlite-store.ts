import { createRequire } from 'node:module';
import { validateTrustedBundleContract, type TrustedBundleEnvelopeV1 } from '@hummer/contracts';
import { canonicalJson } from './canonical-json.js';
import type { BadgeTokenClaims } from './badge-auth.js';
import {
  TrustedBundleRelayError,
  validateTrustedBundleAuthorization,
  validateTrustedBundlePublication,
  type ApprovedBundleAuthorization,
  type TrustedBundlePublishResult,
  type TrustedBundleRelayStore,
} from './trusted-bundle-relay.js';

interface RunResult { readonly changes: number }
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

interface TrustedBundleRow {
  tenant_id: string;
  bundle_id: string;
  target_node_id: string;
  envelope_digest: string;
  envelope_json: string;
  gate_input_json: string;
  decision_json: string;
}

export interface SqliteTrustedBundleRelayStoreOptions {
  readonly busyTimeoutMs?: number;
}

export const TRUSTED_BUNDLE_SCHEMA_VERSION = 1;

function openDatabase(path: string, busyTimeoutMs: number): SqliteDatabase {
  if (!Number.isSafeInteger(busyTimeoutMs) || busyTimeoutMs < 0 || busyTimeoutMs > 60_000) {
    throw new TypeError('busyTimeoutMs must be an integer between 0 and 60000');
  }
  const require = createRequire(import.meta.url);
  const loaded = require('better-sqlite3') as SqliteConstructor | { default: SqliteConstructor };
  const Constructor = typeof loaded === 'function' ? loaded : loaded.default;
  const database = new Constructor(path);
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  database.pragma(`busy_timeout = ${busyTimeoutMs}`);
  return database;
}

function parseStoredEnvelope(row: TrustedBundleRow): TrustedBundleEnvelopeV1 {
  let parsed: unknown;
  let gateInput: unknown;
  let decision: unknown;
  try {
    parsed = JSON.parse(row.envelope_json);
    gateInput = JSON.parse(row.gate_input_json);
    decision = JSON.parse(row.decision_json);
  } catch {
    throw new Error('persisted trusted bundle evidence is not valid JSON');
  }
  const validation = validateTrustedBundleContract('TrustedBundleEnvelopeV1', parsed);
  if (validation.issues) throw new Error('persisted trusted bundle envelope failed contract validation');
  const envelope = validation.value;
  if (envelope.tenantId !== row.tenant_id || envelope.bundleId !== row.bundle_id ||
      envelope.targetNodeId !== row.target_node_id || envelope.envelopeDigest !== row.envelope_digest ||
      canonicalJson(envelope) !== row.envelope_json) {
    throw new Error('persisted trusted bundle metadata does not match its immutable envelope');
  }
  try {
    validateTrustedBundleAuthorization(envelope, { gateInput, decision });
  } catch {
    throw new Error('persisted trusted bundle authorization evidence is invalid');
  }
  return envelope;
}

export class SqliteTrustedBundleRelayStore implements TrustedBundleRelayStore {
  readonly #db: SqliteDatabase;

  constructor(path: string, options: SqliteTrustedBundleRelayStoreOptions = {}) {
    this.#db = openDatabase(path, options.busyTimeoutMs ?? 5_000);
    try {
      this.migrate();
    } catch (error) {
      this.#db.close();
      throw error;
    }
  }

  publish(claims: BadgeTokenClaims, input: unknown, authorization: ApprovedBundleAuthorization): TrustedBundlePublishResult {
    const envelope = validateTrustedBundlePublication(claims, input, authorization);
    const serialized = canonicalJson(envelope);
    const gateInputJson = canonicalJson(authorization.gateInput);
    const decisionJson = canonicalJson(authorization.decision);
    return this.#db.transaction(() => {
      const insertion = this.#db.prepare(`
        INSERT INTO trusted_bundle_envelopes (
          tenant_id, bundle_id, target_node_id, envelope_digest, envelope_json, gate_input_json, decision_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (tenant_id, bundle_id) DO NOTHING
      `).run(
        envelope.tenantId, envelope.bundleId, envelope.targetNodeId, envelope.envelopeDigest,
        serialized, gateInputJson, decisionJson,
      );
      if (insertion.changes === 1) {
        return { inserted: true, envelopeDigest: envelope.envelopeDigest, bundleId: envelope.bundleId };
      }
      const existing = this.#db.prepare(`
        SELECT tenant_id, bundle_id, target_node_id, envelope_digest, envelope_json, gate_input_json, decision_json
        FROM trusted_bundle_envelopes WHERE tenant_id = ? AND bundle_id = ?
      `).get<TrustedBundleRow>(envelope.tenantId, envelope.bundleId);
      if (!existing) throw new Error('trusted bundle conflict was reported without a persisted row');
      if (existing.envelope_digest !== envelope.envelopeDigest || existing.envelope_json !== serialized ||
          existing.gate_input_json !== gateInputJson || existing.decision_json !== decisionJson) {
        throw new TrustedBundleRelayError(409, 'bundle_conflict', 'bundle id is already bound to different immutable bytes');
      }
      return { inserted: false, envelopeDigest: existing.envelope_digest, bundleId: existing.bundle_id };
    })();
  }

  consume(claims: BadgeTokenClaims, nodeId: string, bundleId: string): TrustedBundleEnvelopeV1 {
    if (!claims.nodeId || claims.nodeId !== nodeId) {
      throw new TrustedBundleRelayError(403, 'node_mismatch', 'bundle consumption requires the target node badge');
    }
    const row = this.#db.prepare(`
      SELECT tenant_id, bundle_id, target_node_id, envelope_digest, envelope_json, gate_input_json, decision_json
      FROM trusted_bundle_envelopes WHERE tenant_id = ? AND bundle_id = ?
    `).get<TrustedBundleRow>(claims.tenantId, bundleId);
    if (!row) throw new TrustedBundleRelayError(404, 'bundle_not_found', 'trusted bundle was not found');
    if (row.target_node_id !== nodeId) {
      throw new TrustedBundleRelayError(403, 'node_mismatch', 'bundle is bound to a different target node');
    }
    return structuredClone(parseStoredEnvelope(row));
  }

  close(): void {
    this.#db.close();
  }

  private migrate(): void {
    this.#db.transaction(() => {
      this.#db.exec(`
        CREATE TABLE IF NOT EXISTS trusted_bundle_schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TEXT NOT NULL
        );
      `);
      const future = this.#db.prepare('SELECT version FROM trusted_bundle_schema_migrations WHERE version > ? ORDER BY version')
        .all<{ version: number }>(TRUSTED_BUNDLE_SCHEMA_VERSION);
      if (future.length) throw new Error(`trusted bundle database schema version ${future[0]!.version} is newer than supported version ${TRUSTED_BUNDLE_SCHEMA_VERSION}`);
      this.#db.exec(`
        CREATE TABLE IF NOT EXISTS trusted_bundle_envelopes (
          tenant_id TEXT NOT NULL,
          bundle_id TEXT NOT NULL,
          target_node_id TEXT NOT NULL,
          envelope_digest TEXT NOT NULL,
          envelope_json TEXT NOT NULL,
          gate_input_json TEXT NOT NULL,
          decision_json TEXT NOT NULL,
          PRIMARY KEY (tenant_id, bundle_id)
        );
        CREATE INDEX IF NOT EXISTS trusted_bundle_target_node
          ON trusted_bundle_envelopes (tenant_id, target_node_id, bundle_id);
        CREATE TRIGGER IF NOT EXISTS trusted_bundle_envelopes_no_update
          BEFORE UPDATE ON trusted_bundle_envelopes
          BEGIN SELECT RAISE(ABORT, 'trusted bundle envelopes are append-only'); END;
        CREATE TRIGGER IF NOT EXISTS trusted_bundle_envelopes_no_delete
          BEFORE DELETE ON trusted_bundle_envelopes
          BEGIN SELECT RAISE(ABORT, 'trusted bundle envelopes are append-only'); END;
      `);
      this.#db.prepare(`
        INSERT OR IGNORE INTO trusted_bundle_schema_migrations (version, name, applied_at)
        VALUES (?, ?, ?)
      `).run(TRUSTED_BUNDLE_SCHEMA_VERSION, 'trusted_bundle_envelopes', new Date(0).toISOString());
    })();
  }
}
