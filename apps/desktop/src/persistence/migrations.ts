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
  {
    version: 3,
    name: 'm4a_identity_and_tenant_boundary',
    sql: `
      CREATE TABLE tenants (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE accounts (
        id TEXT PRIMARY KEY,
        email TEXT,
        phone TEXT,
        display_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX accounts_email_unique ON accounts (email) WHERE email IS NOT NULL;
      CREATE UNIQUE INDEX accounts_phone_unique ON accounts (phone) WHERE phone IS NOT NULL;

      ALTER TABLE human_users ADD COLUMN account_id TEXT REFERENCES accounts(id);
      CREATE UNIQUE INDEX human_users_active_account
        ON human_users (tenant_id, account_id) WHERE status = 'active' AND account_id IS NOT NULL;
      CREATE UNIQUE INDEX digital_twins_one_active_per_human
        ON digital_twins (tenant_id, owner_human_id) WHERE status = 'active';

      CREATE TABLE memberships (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        human_user_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (tenant_id, account_id),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id),
        FOREIGN KEY (account_id) REFERENCES accounts(id),
        FOREIGN KEY (human_user_id) REFERENCES human_users(id)
      );

      CREATE INDEX memberships_account ON memberships (account_id, status);
      CREATE INDEX memberships_tenant ON memberships (tenant_id, status);

      CREATE TABLE invitations (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        contact_type TEXT NOT NULL CHECK (contact_type IN ('email', 'phone')),
        contact_value TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
        token_hash TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'pending',
        invited_by_account_id TEXT NOT NULL,
        accepted_by_account_id TEXT,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        accepted_at TEXT,
        FOREIGN KEY (tenant_id) REFERENCES tenants(id),
        FOREIGN KEY (invited_by_account_id) REFERENCES accounts(id),
        FOREIGN KEY (accepted_by_account_id) REFERENCES accounts(id)
      );

      CREATE INDEX invitations_tenant_status ON invitations (tenant_id, status);

      CREATE TABLE sessions_auth (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        current_tenant_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        FOREIGN KEY (account_id) REFERENCES accounts(id),
        FOREIGN KEY (current_tenant_id) REFERENCES tenants(id)
      );

      CREATE INDEX sessions_auth_account_status ON sessions_auth (account_id, status);
    `,
  },
  {
    version: 4,
    name: 'm4c_projects_and_evolution',
    sql: `
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        title TEXT NOT NULL,
        goal TEXT NOT NULL,
        accountable_human_id TEXT NOT NULL,
        coordinator_twin_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (accountable_human_id) REFERENCES human_users(id),
        FOREIGN KEY (coordinator_twin_id) REFERENCES digital_twins(id)
      );
      CREATE INDEX projects_tenant_status ON projects (tenant_id, status, created_at);
      CREATE TABLE project_memberships (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, project_id TEXT NOT NULL, actor_ref TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('accountable_human', 'coordinator_twin', 'collaborating_human', 'collaborator_twin', 'digital_assistant', 'temporary_specialist', 'external_expert')),
        scope TEXT NOT NULL, joined_at TEXT NOT NULL, expires_at TEXT, status TEXT NOT NULL DEFAULT 'active',
        UNIQUE (project_id, actor_ref), FOREIGN KEY (project_id) REFERENCES projects(id)
      );
      CREATE INDEX project_memberships_tenant_project ON project_memberships (tenant_id, project_id, status);
      CREATE TABLE worker_assignments (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, project_id TEXT NOT NULL, work_order_id TEXT,
        employee_id TEXT NOT NULL, sponsor_human_id TEXT NOT NULL, permission_scope TEXT NOT NULL,
        expires_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, released_at TEXT,
        FOREIGN KEY (project_id) REFERENCES projects(id), FOREIGN KEY (employee_id) REFERENCES digital_employees(id),
        FOREIGN KEY (sponsor_human_id) REFERENCES human_users(id)
      );
      CREATE INDEX worker_assignments_expiry ON worker_assignments (tenant_id, status, expires_at);
      CREATE TABLE bad_cases (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, project_id TEXT NOT NULL, work_order_id TEXT,
        trajectory_ref TEXT NOT NULL, reported_by TEXT NOT NULL, failed_criteria TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL, FOREIGN KEY (project_id) REFERENCES projects(id)
      );
      CREATE INDEX bad_cases_project ON bad_cases (tenant_id, project_id, created_at);
      CREATE TABLE sop_revisions (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, project_id TEXT NOT NULL, bad_case_id TEXT NOT NULL,
        target_actor_ref TEXT NOT NULL, base_version TEXT NOT NULL, candidate_version TEXT NOT NULL, diff TEXT NOT NULL,
        scope TEXT NOT NULL CHECK (scope IN ('private', 'project', 'department', 'organization')),
        status TEXT NOT NULL DEFAULT 'candidate', promoted_scope TEXT, created_at TEXT NOT NULL, promoted_at TEXT,
        FOREIGN KEY (project_id) REFERENCES projects(id), FOREIGN KEY (bad_case_id) REFERENCES bad_cases(id)
      );
      CREATE INDEX sop_revisions_project ON sop_revisions (tenant_id, project_id, created_at);
      CREATE TABLE evaluations (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, project_id TEXT NOT NULL, sop_revision_id TEXT NOT NULL,
        source_run_id TEXT NOT NULL, candidate_run_id TEXT NOT NULL, criteria TEXT NOT NULL, metrics_json TEXT NOT NULL,
        verdict TEXT NOT NULL CHECK (verdict IN ('passed', 'failed', 'inconclusive')), created_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id), FOREIGN KEY (sop_revision_id) REFERENCES sop_revisions(id)
      );
      CREATE INDEX evaluations_revision ON evaluations (tenant_id, sop_revision_id, created_at);
    `,
  },
  {
    version: 5,
    name: 'm5a_outcome_ledger',
    sql: `
      CREATE TABLE outcome_definitions (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        action_pattern TEXT NOT NULL,
        title TEXT NOT NULL,
        acceptance_criteria TEXT NOT NULL,
        unit_price_cny REAL,
        risk_level TEXT NOT NULL CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (tenant_id, action_pattern)
      );

      CREATE INDEX outcome_definitions_tenant ON outcome_definitions (tenant_id, enabled);

      CREATE TABLE outcome_events (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        outcome_definition_id TEXT NOT NULL,
        work_order_id TEXT,
        session_id TEXT NOT NULL,
        approval_id TEXT,
        verdict TEXT NOT NULL CHECK (verdict IN ('accepted', 'rejected')),
        accepted_by TEXT NOT NULL,
        evidence_ref TEXT,
        occurred_at TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        UNIQUE (tenant_id, idempotency_key),
        FOREIGN KEY (outcome_definition_id) REFERENCES outcome_definitions(id)
      );

      CREATE INDEX outcome_events_tenant ON outcome_events (tenant_id, occurred_at);
      CREATE INDEX outcome_events_session ON outcome_events (session_id);
      CREATE INDEX outcome_events_definition ON outcome_events (outcome_definition_id);

      CREATE TABLE cost_ledger (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        outcome_event_id TEXT,
        engine_profile_id TEXT NOT NULL,
        model TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        cached_input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cost_cny REAL NOT NULL,
        pricing_source TEXT NOT NULL,
        pricing_verified_at TEXT NOT NULL,
        computed_at TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        UNIQUE (tenant_id, idempotency_key),
        FOREIGN KEY (outcome_event_id) REFERENCES outcome_events(id)
      );

      CREATE INDEX cost_ledger_session ON cost_ledger (session_id);
      CREATE INDEX cost_ledger_outcome ON cost_ledger (outcome_event_id);
    `,
  },
  {
    version: 6,
    name: 'm5c_encrypted_engine_credentials',
    sql: `
      CREATE TABLE engine_credentials (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        engine_profile_id TEXT NOT NULL,
        env_key TEXT NOT NULL,
        encrypted_value TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (tenant_id, engine_profile_id)
      );

      CREATE INDEX engine_credentials_tenant
        ON engine_credentials (tenant_id, engine_profile_id);
    `,
  },
  {
    version: 7,
    name: 'm5d_tool_registry',
    sql: `
      CREATE TABLE tool_definitions (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        capability_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        transport TEXT NOT NULL CHECK (transport IN ('mcp', 'builtin')),
        risk_level TEXT NOT NULL CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
        policy_action_pattern TEXT NOT NULL,
        endpoint_config_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'verified', 'disabled')),
        verified_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (tenant_id, capability_id)
      );

      CREATE INDEX tool_definitions_tenant
        ON tool_definitions (tenant_id, status, capability_id);

      CREATE TABLE tool_invocations (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        tool_definition_id TEXT NOT NULL,
        capability_id TEXT NOT NULL,
        actor_ref TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('completed', 'failed', 'declined')),
        args_json TEXT NOT NULL,
        result_json TEXT NOT NULL,
        duration_ms REAL,
        evidence_refs_json TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        UNIQUE (tenant_id, idempotency_key),
        FOREIGN KEY (tool_definition_id) REFERENCES tool_definitions(id)
      );

      CREATE INDEX tool_invocations_session
        ON tool_invocations (tenant_id, session_id, occurred_at);
    `,
  },
  {
    version: 8,
    name: 'm5e_work_order_intake',
    sql: `
      CREATE TABLE work_order_intake (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('folder', 'form')),
        external_ref TEXT NOT NULL,
        received_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'cancelled')),
        payload_evidence_ref TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        work_order_id TEXT,
        confirmed_by TEXT,
        confirmed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (tenant_id, source, external_ref)
      );

      CREATE INDEX work_order_intake_queue
        ON work_order_intake (tenant_id, status, received_at);

      CREATE TABLE work_order_inbox (
        tenant_id TEXT PRIMARY KEY,
        directory TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
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
