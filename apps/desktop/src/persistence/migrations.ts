import type { SqliteDatabase } from './sqlite.js';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const migrations: readonly Migration[] = [
  {
    version: 1,
    name: 'm2_local_fact_source',
    sql: `
      CREATE TABLE domain_events (
        position INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        tenant_id TEXT NOT NULL,
        aggregate_type TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        aggregate_version INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        actor_ref TEXT NOT NULL,
        correlation_id TEXT NOT NULL,
        canonical_payload TEXT NOT NULL,
        previous_hash TEXT,
        hash TEXT NOT NULL UNIQUE,
        UNIQUE (tenant_id, aggregate_type, aggregate_id, aggregate_version)
      );

      CREATE INDEX domain_events_session_replay
        ON domain_events (tenant_id, aggregate_type, aggregate_id, aggregate_version);

      CREATE TABLE work_orders (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        status TEXT NOT NULL,
        title TEXT,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        work_order_id TEXT,
        runtime_id TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        last_sequence INTEGER NOT NULL DEFAULT 0,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE steps (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        actor_ref TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        duration_ms REAL,
        cost_cny REAL,
        event_json TEXT NOT NULL,
        UNIQUE (session_id, sequence),
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      CREATE INDEX steps_session_sequence ON steps (session_id, sequence);

      CREATE TABLE approvals (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        status TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        resolved_at TEXT,
        payload_json TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      CREATE INDEX approvals_session_sequence ON approvals (session_id, sequence);

      CREATE TABLE evidence (
        id TEXT PRIMARY KEY,
        ref TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        session_id TEXT,
        sha256 TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        media_type TEXT NOT NULL,
        name TEXT,
        blob_path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        UNIQUE (session_id, ref)
      );

      CREATE INDEX evidence_digest ON evidence (sha256);
      CREATE INDEX evidence_session ON evidence (session_id);

      CREATE TABLE result_packages (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        work_order_id TEXT,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      CREATE INDEX result_packages_session ON result_packages (session_id, created_at);
    `,
  },
  {
    version: 2,
    name: 'm3_organization_responsibility_chain',
    sql: `
      CREATE TABLE human_users (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX human_users_tenant ON human_users (tenant_id, status);

      CREATE TABLE departments (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        name TEXT NOT NULL,
        owner_human_id TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (owner_human_id) REFERENCES human_users(id)
      );

      CREATE INDEX departments_tenant ON departments (tenant_id, status);

      CREATE TABLE digital_twins (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        owner_human_id TEXT NOT NULL,
        department_id TEXT,
        name TEXT NOT NULL,
        authority_level TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (owner_human_id) REFERENCES human_users(id),
        FOREIGN KEY (department_id) REFERENCES departments(id)
      );

      CREATE INDEX digital_twins_owner ON digital_twins (tenant_id, owner_human_id);

      CREATE TABLE digital_employees (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        sponsor_actor_ref TEXT NOT NULL,
        department_id TEXT,
        name TEXT NOT NULL,
        job_title TEXT NOT NULL,
        runtime_profile TEXT NOT NULL,
        autonomy_level TEXT NOT NULL,
        status TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (tenant_id, idempotency_key),
        FOREIGN KEY (department_id) REFERENCES departments(id)
      );

      CREATE INDEX digital_employees_tenant ON digital_employees (tenant_id, status);
      CREATE INDEX digital_employees_department ON digital_employees (tenant_id, department_id);

      CREATE TABLE approval_policies (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        action_pattern TEXT NOT NULL,
        risk_level TEXT NOT NULL,
        effect TEXT NOT NULL,
        approver_actor_ref TEXT NOT NULL,
        budget_limit_cny REAL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX approval_policies_match ON approval_policies (tenant_id, enabled, risk_level);

      CREATE TABLE execution_nodes (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        runtime_id TEXT NOT NULL,
        status TEXT NOT NULL,
        cwd TEXT NOT NULL,
        permission_scope TEXT NOT NULL,
        current_session_id TEXT,
        last_seen_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE INDEX execution_nodes_tenant ON execution_nodes (tenant_id, status);
    `,
  },
];

export function applyMigrations(database: SqliteDatabase): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
  const applied = new Set(database.prepare('SELECT version FROM schema_migrations').all<{ version: number }>().map((row) => row.version));
  const apply = database.transaction((migration: Migration) => {
    database.exec(migration.sql);
    database.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
      .run(migration.version, migration.name, new Date().toISOString());
  });

  for (const migration of migrations) {
    if (!applied.has(migration.version)) apply(migration);
  }
}
