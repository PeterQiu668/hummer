import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ApprovalPolicyStore } from './approval-policy-store.js';
import { ExecutionNodeStore } from './execution-node-store.js';
import { DomainEventStore, type DomainEventInput, type IntegrityResult, type StoredDomainEvent } from './domain-event-store.js';
import { EvidenceStore, type StoredEvidence } from './evidence-store.js';
import { IdentityStore } from './identity-store.js';
import { applyMigrations } from './migrations.js';
import { OrganizationStore } from './organization-store.js';
import { ProjectStore } from './project-store.js';
import { RuntimeEventStore } from './runtime-event-store.js';
import { openSqlite, type SqliteDatabase } from './sqlite.js';

export interface OpenPersistenceOptions {
  dataDirectory: string;
  databasePath?: string;
  now?: () => Date;
}

export interface AppliedMigration {
  version: number;
  name: string;
  appliedAt: string;
}

export interface SessionProjection {
  id: string;
  tenantId: string;
  workOrderId: string | null;
  runtimeId: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  lastSequence: number;
}

export interface ApprovalProjection {
  id: string;
  sessionId: string;
  sequence: number;
  status: 'pending' | 'approved' | 'declined';
  requestedAt: string;
  resolvedAt: string | null;
}

export interface ResultPackageProjection {
  id: string;
  tenantId: string;
  sessionId: string;
  workOrderId: string | null;
  status: string;
  createdAt: string;
}

interface MigrationRow {
  version: number;
  name: string;
  applied_at: string;
}

interface SessionRow {
  id: string;
  tenant_id: string;
  work_order_id: string | null;
  runtime_id: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  last_sequence: number;
}

interface ApprovalRow {
  id: string;
  session_id: string;
  sequence: number;
  status: 'pending' | 'approved' | 'declined';
  requested_at: string;
  resolved_at: string | null;
}

interface ResultPackageRow {
  id: string;
  tenant_id: string;
  session_id: string;
  work_order_id: string | null;
  status: string;
  created_at: string;
}

export class DesktopPersistence {
  readonly databasePath: string;
  readonly runtimeEvents: RuntimeEventStore;
  readonly evidence: EvidenceStore;
  private readonly domainEvents: DomainEventStore;
  readonly organization: OrganizationStore;
  readonly approvalPolicies: ApprovalPolicyStore;
  readonly executionNodes: ExecutionNodeStore;
  readonly identity: IdentityStore;
  readonly projects: ProjectStore;

  constructor(
    private readonly database: SqliteDatabase,
    dataDirectory: string,
    databasePath: string,
    now: () => Date,
  ) {
    this.databasePath = databasePath;
    this.domainEvents = new DomainEventStore(database);
    this.runtimeEvents = new RuntimeEventStore(database, this.domainEvents);
    this.evidence = new EvidenceStore(database, dataDirectory);
    this.organization = new OrganizationStore(database);
    this.approvalPolicies = new ApprovalPolicyStore(database);
    this.executionNodes = new ExecutionNodeStore(database);
    this.identity = new IdentityStore(database, now);
    this.projects = new ProjectStore(database, now);
  }

  close(): void {
    this.database.close();
  }

  schemaVersion(): number {
    return this.database.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations')
      .get<{ version: number }>()?.version ?? 0;
  }

  appliedMigrations(): AppliedMigration[] {
    return this.database.prepare('SELECT version, name, applied_at FROM schema_migrations ORDER BY version')
      .all<MigrationRow>().map((row) => ({ version: row.version, name: row.name, appliedAt: row.applied_at }));
  }

  listTables(): string[] {
    return this.database.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name
    `).all<{ name: string }>().map((row) => row.name);
  }

  appendDomainEvent(input: DomainEventInput): StoredDomainEvent {
    return this.domainEvents.append(input);
  }

  listDomainEvents(sessionToken: string): StoredDomainEvent[] {
    return this.domainEvents.listByTenant(this.identity.currentTenantId(sessionToken));
  }

  verifyDomainEventIntegrity(): IntegrityResult {
    return this.domainEvents.verifyIntegrity();
  }

  replaceDomainEvent(_eventId: string, _replacement: unknown): never {
    throw new Error('Domain events are append-only and cannot be replaced');
  }

  getSession(sessionId: string): SessionProjection | undefined {
    const row = this.database.prepare(`
      SELECT id, tenant_id, work_order_id, runtime_id, status, started_at, ended_at, last_sequence
      FROM sessions WHERE id = ?
    `).get<SessionRow>(sessionId);
    return row ? mapSession(row) : undefined;
  }

  listApprovals(sessionId: string): ApprovalProjection[] {
    return this.database.prepare(`
      SELECT id, session_id, sequence, status, requested_at, resolved_at
      FROM approvals WHERE session_id = ? ORDER BY sequence
    `).all<ApprovalRow>(sessionId).map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      sequence: row.sequence,
      status: row.status,
      requestedAt: row.requested_at,
      resolvedAt: row.resolved_at,
    }));
  }

  listResultPackages(sessionId: string): ResultPackageProjection[] {
    return this.database.prepare(`
      SELECT id, tenant_id, session_id, work_order_id, status, created_at
      FROM result_packages WHERE session_id = ? ORDER BY created_at, id
    `).all<ResultPackageRow>(sessionId).map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      sessionId: row.session_id,
      workOrderId: row.work_order_id,
      status: row.status,
      createdAt: row.created_at,
    }));
  }

  listEvidence(sessionId: string): StoredEvidence[] {
    return this.evidence.listBySession(sessionId);
  }
}

export function openPersistence(options: OpenPersistenceOptions): DesktopPersistence {
  if (!options.dataDirectory) throw new TypeError('Persistence dataDirectory is required');
  mkdirSync(options.dataDirectory, { recursive: true });
  const databasePath = options.databasePath ?? join(options.dataDirectory, 'hummer.sqlite3');
  const database = openSqlite(databasePath);
  try {
    applyMigrations(database);
    return new DesktopPersistence(database, options.dataDirectory, databasePath, options.now ?? (() => new Date()));
  } catch (error) {
    database.close();
    throw error;
  }
}

function mapSession(row: SessionRow): SessionProjection {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workOrderId: row.work_order_id,
    runtimeId: row.runtime_id,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    lastSequence: row.last_sequence,
  };
}
