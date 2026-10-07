import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import {
  CapabilityGrantRegistry,
  type CapabilityGrantStatus,
  type PersistedCapabilityGrant,
  type TaskGrantAuthenticator,
  type TaskGrantAuthorizationClaims,
  type TaskGrantAuthorizationInput,
  type TaskGrantAuthorizationResult,
} from './badge-auth.js';
import { canonicalJson } from './canonical-json.js';

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

interface TaskGrantRow {
  grant_id: string;
  tenant_id: string;
  work_order_id: string;
  node_id: string;
  capabilities_json: string;
  paths_json: string;
  expires_at: string;
  max_uses: number;
  used_count: number;
  issued_to_run_id: string;
  token_ref: string;
  issued_at: string;
  issued_by_authority_ref: string;
  status: CapabilityGrantStatus;
  revoked_at: string | null;
  rotated_from_grant_ref: string | null;
  rotated_to_grant_ref: string | null;
  token_digest: string;
  updated_at: string;
}

export interface TaskGrantSnapshotV1 {
  schema: 'hummer.task-grant-snapshot';
  version: 1;
  tenantId: string;
  grants: readonly PersistedCapabilityGrant[];
}

export interface TaskGrantImportResult {
  tenantId: string;
  inserted: number;
  unchanged: number;
}

export class SqliteTaskGrantAuthorityError extends Error {
  constructor(readonly code: 'invalid_store' | 'invalid_snapshot' | 'snapshot_conflict' | 'grant_not_found', message: string) {
    super(message);
    this.name = 'SqliteTaskGrantAuthorityError';
  }
}

export class SqliteTaskGrantAuthority implements TaskGrantAuthenticator {
  readonly #db: SqliteDatabase;
  readonly #now: () => Date;
  #closed = false;

  constructor(path: string, options: { now?: () => Date } = {}) {
    if (!isAbsolute(path)) throw new SqliteTaskGrantAuthorityError('invalid_store', 'task grant database path must be absolute');
    this.#now = options.now ?? (() => new Date());
    this.#db = openDatabase(path);
    this.#migrate();
    this.#validateStoredState();
  }

  importSnapshot(snapshot: TaskGrantSnapshotV1): TaskGrantImportResult {
    const canonical = validateSnapshot(snapshot, this.#now);
    return this.#db.transaction(() => {
      let inserted = 0;
      let unchanged = 0;
      for (const grant of canonical.grants) {
        const existing = this.#rowByGrant(grant.tenantId, grant.grantId);
        if (existing) {
          if (canonicalJson(immutableGrantMaterial(toRecord(existing))) !== canonicalJson(immutableGrantMaterial(grant))) {
            throw new SqliteTaskGrantAuthorityError('snapshot_conflict', 'task grant snapshot conflicts with durable state');
          }
          unchanged += 1;
          continue;
        }
        try {
          this.#db.prepare(`
            INSERT INTO relay_task_grants (
              grant_id, tenant_id, work_order_id, node_id, capabilities_json, paths_json,
              expires_at, max_uses, used_count, issued_to_run_id, token_ref, issued_at,
              issued_by_authority_ref, status, revoked_at, rotated_from_grant_ref,
              rotated_to_grant_ref, token_digest, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            grant.grantId, grant.tenantId, grant.workOrderId, grant.nodeId,
            JSON.stringify(grant.capabilities), JSON.stringify(grant.paths), grant.expiresAt,
            grant.maxUses, grant.usedCount, grant.issuedToRunId, grant.tokenRef, grant.issuedAt,
            grant.issuedByAuthorityRef, grant.status, grant.revokedAt ?? null,
            grant.rotatedFromGrantRef ?? null, grant.rotatedToGrantRef ?? null,
            grant.tokenDigest, this.#now().toISOString(),
          );
        } catch (error) {
          if (error instanceof SqliteTaskGrantAuthorityError) throw error;
          throw new SqliteTaskGrantAuthorityError('snapshot_conflict', 'task grant snapshot conflicts with durable state');
        }
        inserted += 1;
      }
      return { tenantId: canonical.tenantId, inserted, unchanged };
    })();
  }

  async consume(input: TaskGrantAuthorizationInput): Promise<TaskGrantAuthorizationResult> {
    return this.#authorize(input, true);
  }

  async checkpoint(input: TaskGrantAuthorizationInput): Promise<TaskGrantAuthorizationResult> {
    return this.#authorize(input, false);
  }

  revoke(tenantId: string, grantId: string, at = this.#now().toISOString()): PersistedCapabilityGrant {
    const now = canonicalTimestamp(at);
    return this.#db.transaction(() => {
      const row = this.#rowByGrant(tenantId, grantId);
      if (!row) throw new SqliteTaskGrantAuthorityError('grant_not_found', 'task grant was not found');
      if (row.status !== 'revoked' && row.status !== 'rotated') {
        this.#db.prepare(`
          UPDATE relay_task_grants
          SET status = 'revoked', revoked_at = ?, updated_at = ?
          WHERE tenant_id = ? AND grant_id = ?
        `).run(now, now, tenantId, grantId);
      }
      return toRecord(this.#requireRow(tenantId, grantId));
    })();
  }

  snapshot(tenantId: string): readonly PersistedCapabilityGrant[] {
    return this.#db.prepare(`
      SELECT * FROM relay_task_grants WHERE tenant_id = ? ORDER BY grant_id
    `).all<TaskGrantRow>(tenantId).map(toRecord);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#db.close();
  }

  #authorize(input: TaskGrantAuthorizationInput, consume: boolean): TaskGrantAuthorizationResult {
    return this.#db.transaction(() => {
      const now = safeTimestamp(input.now);
      if (!now) return { ok: false, reason: 'unknown' } as const;
      const row = this.#db.prepare('SELECT * FROM relay_task_grants WHERE token_digest = ?')
        .get<TaskGrantRow>(fingerprint(input.token));
      if (!row) return { ok: false, reason: 'unknown' } as const;
      if (row.status === 'revoked' || row.status === 'rotated') return { ok: false, reason: 'revoked' } as const;
      if (Date.parse(row.expires_at) <= Date.parse(now)) {
        this.#db.prepare(`
          UPDATE relay_task_grants SET status = 'expired', updated_at = ?
          WHERE tenant_id = ? AND grant_id = ? AND status NOT IN ('revoked', 'rotated')
        `).run(now, row.tenant_id, row.grant_id);
        return { ok: false, reason: 'expired' } as const;
      }
      if (row.token_ref !== input.grantRef
        || row.tenant_id !== input.tenantId
        || row.work_order_id !== input.workOrderId
        || row.node_id !== input.nodeId
        || row.issued_to_run_id !== input.issuedToRunId
        || row.max_uses !== input.maxUses) {
        return { ok: false, reason: 'binding_mismatch' } as const;
      }
      const capabilities = parseStringArray(row.capabilities_json);
      const paths = parseStringArray(row.paths_json);
      if (input.capabilities.length === 0
        || input.capabilities.some((capability) => !capabilities.includes(capability))
        || input.paths.some((path) => !paths.includes(path))) {
        return { ok: false, reason: 'scope_denied' } as const;
      }
      if (consume) {
        if (row.used_count >= row.max_uses || row.status === 'exhausted') {
          return { ok: false, reason: 'uses_exhausted' } as const;
        }
        const updated = this.#db.prepare(`
          UPDATE relay_task_grants
          SET used_count = used_count + 1,
              status = CASE WHEN used_count + 1 >= max_uses THEN 'exhausted' ELSE status END,
              updated_at = ?
          WHERE tenant_id = ? AND grant_id = ? AND status = 'active' AND used_count < max_uses
        `).run(now, row.tenant_id, row.grant_id);
        if (updated.changes !== 1) return { ok: false, reason: 'uses_exhausted' } as const;
      } else if (row.used_count === 0) {
        return { ok: false, reason: 'not_consumed' } as const;
      }
      const current = this.#requireRow(row.tenant_id, row.grant_id);
      return { ok: true, claims: claims(current, input.capabilities, input.paths) } as const;
    })();
  }

  #rowByGrant(tenantId: string, grantId: string): TaskGrantRow | undefined {
    return this.#db.prepare('SELECT * FROM relay_task_grants WHERE tenant_id = ? AND grant_id = ?')
      .get<TaskGrantRow>(tenantId, grantId);
  }

  #requireRow(tenantId: string, grantId: string): TaskGrantRow {
    const row = this.#rowByGrant(tenantId, grantId);
    if (!row) throw new SqliteTaskGrantAuthorityError('grant_not_found', 'task grant was not found');
    return row;
  }

  #migrate(): void {
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS relay_task_grants (
        grant_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        work_order_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        capabilities_json TEXT NOT NULL,
        paths_json TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        max_uses INTEGER NOT NULL CHECK (max_uses = 1),
        used_count INTEGER NOT NULL CHECK (used_count BETWEEN 0 AND max_uses),
        issued_to_run_id TEXT NOT NULL,
        token_ref TEXT NOT NULL,
        issued_at TEXT NOT NULL,
        issued_by_authority_ref TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'expired', 'revoked', 'rotated', 'exhausted')),
        revoked_at TEXT,
        rotated_from_grant_ref TEXT,
        rotated_to_grant_ref TEXT,
        token_digest TEXT NOT NULL UNIQUE CHECK (length(token_digest) = 64),
        updated_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, grant_id),
        UNIQUE (tenant_id, token_ref)
      );
      CREATE INDEX IF NOT EXISTS relay_task_grants_binding
        ON relay_task_grants (tenant_id, node_id, work_order_id, issued_to_run_id, status);
    `);
  }

  #validateStoredState(): void {
    const byTenant = new Map<string, PersistedCapabilityGrant[]>();
    let records: PersistedCapabilityGrant[];
    try {
      records = this.#db.prepare('SELECT * FROM relay_task_grants ORDER BY tenant_id, grant_id')
        .all<TaskGrantRow>().map(toRecord);
    } catch {
      throw new SqliteTaskGrantAuthorityError('invalid_store', 'task grant database contains invalid records');
    }
    for (const grant of records) {
      const tenant = byTenant.get(grant.tenantId) ?? [];
      tenant.push(grant);
      byTenant.set(grant.tenantId, tenant);
    }
    try {
      for (const [tenantId, grants] of byTenant) {
        const registry = new CapabilityGrantRegistry({
          now: this.#now,
          initialTenantId: tenantId,
          initialRecords: grants,
        });
        if (registry.snapshot(tenantId).some((grant) => grant.maxUses !== 1 || !grant.capabilities.includes('task.execute'))) {
          throw new Error('unsupported task grant');
        }
      }
    } catch {
      throw new SqliteTaskGrantAuthorityError('invalid_store', 'task grant database contains invalid records');
    }
  }
}

export async function loadTaskGrantSnapshot(path: string): Promise<TaskGrantSnapshotV1> {
  if (!isAbsolute(path)) throw new SqliteTaskGrantAuthorityError('invalid_snapshot', 'task grant snapshot path must be absolute');
  let value: unknown;
  try { value = JSON.parse(await readFile(path, 'utf8')); } catch {
    throw new SqliteTaskGrantAuthorityError('invalid_snapshot', 'task grant snapshot could not be read');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SqliteTaskGrantAuthorityError('invalid_snapshot', 'task grant snapshot must be an object');
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).sort().join(',') !== 'grants,schema,tenantId,version'
    || input.schema !== 'hummer.task-grant-snapshot' || input.version !== 1
    || typeof input.tenantId !== 'string' || !Array.isArray(input.grants) || input.grants.length === 0) {
    throw new SqliteTaskGrantAuthorityError('invalid_snapshot', 'task grant snapshot has an invalid shape');
  }
  return value as TaskGrantSnapshotV1;
}

function openDatabase(path: string): SqliteDatabase {
  const require = createRequire(import.meta.url);
  const loaded = require('better-sqlite3') as SqliteConstructor | { default: SqliteConstructor };
  const Constructor = typeof loaded === 'function' ? loaded : loaded.default;
  const database = new Constructor(path);
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  database.pragma('busy_timeout = 5000');
  database.pragma('synchronous = FULL');
  return database;
}

function validateSnapshot(snapshot: TaskGrantSnapshotV1, now: () => Date): TaskGrantSnapshotV1 {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)
    || Object.keys(snapshot as unknown as Record<string, unknown>).sort().join(',') !== 'grants,schema,tenantId,version'
    || snapshot.schema !== 'hummer.task-grant-snapshot' || snapshot.version !== 1
    || typeof snapshot.tenantId !== 'string' || !Array.isArray(snapshot.grants) || snapshot.grants.length === 0) {
    throw new SqliteTaskGrantAuthorityError('invalid_snapshot', 'task grant snapshot has an invalid shape');
  }
  let grants: readonly PersistedCapabilityGrant[];
  try {
    const registry = new CapabilityGrantRegistry({
      now,
      initialTenantId: snapshot.tenantId,
      initialRecords: snapshot.grants,
    });
    grants = registry.snapshot(snapshot.tenantId);
  } catch {
    throw new SqliteTaskGrantAuthorityError('invalid_snapshot', 'task grant snapshot contains invalid records');
  }
  if (grants.some((grant) => grant.maxUses !== 1 || !grant.capabilities.includes('task.execute'))) {
    throw new SqliteTaskGrantAuthorityError('invalid_snapshot', 'task grant snapshot must contain one-use execution grants');
  }
  return { schema: 'hummer.task-grant-snapshot', version: 1, tenantId: snapshot.tenantId, grants };
}

function toRecord(row: TaskGrantRow): PersistedCapabilityGrant {
  return {
    grantId: row.grant_id,
    tenantId: row.tenant_id,
    workOrderId: row.work_order_id,
    nodeId: row.node_id,
    capabilities: parseStringArray(row.capabilities_json),
    paths: parseStringArray(row.paths_json),
    expiresAt: row.expires_at,
    maxUses: row.max_uses,
    usedCount: row.used_count,
    issuedToRunId: row.issued_to_run_id,
    tokenRef: row.token_ref,
    issuedAt: row.issued_at,
    issuedByAuthorityRef: row.issued_by_authority_ref,
    status: row.status,
    ...(row.revoked_at ? { revokedAt: row.revoked_at } : {}),
    ...(row.rotated_from_grant_ref ? { rotatedFromGrantRef: row.rotated_from_grant_ref } : {}),
    ...(row.rotated_to_grant_ref ? { rotatedToGrantRef: row.rotated_to_grant_ref } : {}),
    tokenDigest: row.token_digest,
  };
}

function immutableGrantMaterial(grant: PersistedCapabilityGrant): Record<string, unknown> {
  return {
    grantId: grant.grantId,
    tenantId: grant.tenantId,
    workOrderId: grant.workOrderId,
    nodeId: grant.nodeId,
    capabilities: [...grant.capabilities],
    paths: [...grant.paths],
    expiresAt: grant.expiresAt,
    maxUses: grant.maxUses,
    issuedToRunId: grant.issuedToRunId,
    tokenRef: grant.tokenRef,
    issuedAt: grant.issuedAt,
    issuedByAuthorityRef: grant.issuedByAuthorityRef,
    rotatedFromGrantRef: grant.rotatedFromGrantRef ?? null,
    rotatedToGrantRef: grant.rotatedToGrantRef ?? null,
    tokenDigest: grant.tokenDigest,
  };
}

function claims(row: TaskGrantRow, capabilities: readonly string[], paths: readonly string[]): TaskGrantAuthorizationClaims {
  return {
    grantRef: row.token_ref,
    tenantId: row.tenant_id,
    workOrderId: row.work_order_id,
    nodeId: row.node_id,
    issuedToRunId: row.issued_to_run_id,
    capabilities: [...capabilities],
    paths: [...paths],
    expiresAt: row.expires_at,
    maxUses: row.max_uses,
    usedCount: row.used_count,
  };
}

function parseStringArray(value: string): string[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== 'string')) {
    throw new SqliteTaskGrantAuthorityError('invalid_store', 'task grant database contains invalid list data');
  }
  return [...parsed];
}

function fingerprint(token: string): string { return createHash('sha256').update(token, 'utf8').digest('hex'); }

function safeTimestamp(value: string): string | null {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function canonicalTimestamp(value: string): string {
  const timestamp = safeTimestamp(value);
  if (!timestamp) throw new SqliteTaskGrantAuthorityError('invalid_store', 'task grant mutation time must be an ISO timestamp');
  return timestamp;
}
