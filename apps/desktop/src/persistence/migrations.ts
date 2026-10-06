import type { SqliteDatabase } from './sqlite.js';
import type { JsonValue } from './canonical-json.js';
import { computeTenantEventHash } from './tenant-chain.js';

export interface Migration {
  version: number;
  name: string;
  sql: string;
  up?: (database: SqliteDatabase) => void;
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
  {
    version: 9,
    name: 'm5g_hummer_execution_sandbox',
    sql: `
      CREATE TABLE execution_sandbox_checks (
        id TEXT PRIMARY KEY,
        runtime TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('passed', 'failed')),
        passed_probes INTEGER NOT NULL,
        total_probes INTEGER NOT NULL,
        issue TEXT,
        result_json TEXT NOT NULL,
        checked_at TEXT NOT NULL
      );

      CREATE INDEX execution_sandbox_checks_latest
        ON execution_sandbox_checks (checked_at DESC);

      CREATE TABLE workspace_exec_jobs (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        work_order_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
        argv_json TEXT NOT NULL,
        exit_code INTEGER NOT NULL,
        duration_ms REAL NOT NULL,
        artifacts_json TEXT NOT NULL,
        occurred_at TEXT NOT NULL
      );

      CREATE INDEX workspace_exec_jobs_session
        ON workspace_exec_jobs (tenant_id, session_id, occurred_at);
    `,
  },
  {
    version: 10,
    name: 'm5h_egress_delivery',
    sql: `
      CREATE TABLE egress_deliveries (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        approval_id TEXT NOT NULL,
        capability_id TEXT NOT NULL,
        target TEXT NOT NULL,
        content_sha256 TEXT NOT NULL,
        evidence_ref TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('delivered', 'failed')),
        result_json TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        UNIQUE (tenant_id, idempotency_key)
      );

      CREATE INDEX egress_deliveries_session
        ON egress_deliveries (tenant_id, session_id, occurred_at);
    `,
  },
  {
    version: 11,
    name: 'phase0_fleet_nodes_and_task_leases',
    sql: `
      CREATE TABLE fleet_nodes (
        tenant_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        manifest_json TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('online', 'offline', 'draining')),
        PRIMARY KEY (tenant_id, node_id)
      );

      CREATE INDEX fleet_nodes_availability
        ON fleet_nodes (tenant_id, status, last_seen_at);

      CREATE TABLE fleet_task_leases (
        tenant_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        delivery_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        envelope_json TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('queued', 'leased', 'blocked', 'completed', 'failed')),
        lease_expires_at TEXT,
        attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
        result_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, task_id),
        UNIQUE (tenant_id, delivery_id),
        UNIQUE (tenant_id, idempotency_key),
        FOREIGN KEY (tenant_id, node_id) REFERENCES fleet_nodes(tenant_id, node_id)
      );

      CREATE INDEX fleet_task_leases_queue
        ON fleet_task_leases (tenant_id, node_id, state, lease_expires_at);
    `,
  },
  {
    version: 12,
    name: 'w4_tenant_governance_and_dual_chain',
    sql: `
      ALTER TABLE memberships RENAME TO memberships_v3_legacy;

      CREATE TABLE memberships (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        human_user_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'auditor', 'operator')),
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (tenant_id, account_id),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id),
        FOREIGN KEY (account_id) REFERENCES accounts(id),
        FOREIGN KEY (human_user_id) REFERENCES human_users(id)
      );

      INSERT INTO memberships (id, tenant_id, account_id, human_user_id, role, status, created_at, updated_at)
      SELECT id, tenant_id, account_id, human_user_id, role, status, created_at, updated_at
      FROM memberships_v3_legacy;

      DROP TABLE memberships_v3_legacy;

      CREATE INDEX memberships_account ON memberships (account_id, status);
      CREATE INDEX memberships_tenant ON memberships (tenant_id, status);

      ALTER TABLE invitations RENAME TO invitations_v3_legacy;

      CREATE TABLE invitations (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        contact_type TEXT NOT NULL CHECK (contact_type IN ('email', 'phone')),
        contact_value TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin', 'member', 'auditor', 'operator')),
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

      INSERT INTO invitations (
        id, tenant_id, contact_type, contact_value, role, token_hash, status,
        invited_by_account_id, accepted_by_account_id, expires_at, created_at, accepted_at
      )
      SELECT
        id, tenant_id, contact_type, contact_value, role, token_hash, status,
        invited_by_account_id, accepted_by_account_id, expires_at, created_at, accepted_at
      FROM invitations_v3_legacy;

      DROP TABLE invitations_v3_legacy;

      CREATE INDEX invitations_tenant_status ON invitations (tenant_id, status);

      CREATE TABLE tenant_settings (
        tenant_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, key),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id)
      );

      CREATE TABLE tenant_event_chain (
        tenant_id TEXT NOT NULL,
        tenant_position INTEGER NOT NULL CHECK (tenant_position > 0),
        event_id TEXT NOT NULL UNIQUE,
        previous_hash TEXT,
        hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, tenant_position),
        FOREIGN KEY (event_id) REFERENCES domain_events(id)
      );

      CREATE INDEX tenant_event_chain_event
        ON tenant_event_chain (tenant_id, event_id);

      CREATE TABLE tenant_chain_heads (
        tenant_id TEXT PRIMARY KEY,
        position INTEGER NOT NULL CHECK (position > 0),
        hash TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TRIGGER tenants_status_insert_guard
      BEFORE INSERT ON tenants
      WHEN NEW.status NOT IN ('active', 'suspended', 'export_required', 'destroyed')
      BEGIN
        SELECT RAISE(ABORT, 'invalid tenant lifecycle status');
      END;

      CREATE TRIGGER tenants_status_update_guard
      BEFORE UPDATE OF status ON tenants
      WHEN NEW.status NOT IN ('active', 'suspended', 'export_required', 'destroyed')
      BEGIN
        SELECT RAISE(ABORT, 'invalid tenant lifecycle status');
      END;
    `,
    up: backfillTenantEventChains,
  },
  {
    version: 13,
    name: 'w4_audit_exports_and_quota_counters',
    sql: `
      CREATE TABLE audit_exports (
        export_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        range_from INTEGER NOT NULL CHECK (range_from > 0),
        range_to INTEGER NOT NULL CHECK (range_to >= range_from),
        sha256 TEXT NOT NULL,
        manifest_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (tenant_id) REFERENCES tenants(id)
      );

      CREATE INDEX audit_exports_tenant_range
        ON audit_exports (tenant_id, range_from, range_to, created_at);

      CREATE TABLE quota_counters (
        tenant_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        window_day TEXT NOT NULL,
        metric TEXT NOT NULL CHECK (metric IN ('tasks', 'tokens', 'cost_cny')),
        used REAL NOT NULL DEFAULT 0 CHECK (used >= 0),
        limit_value REAL NOT NULL CHECK (limit_value > 0),
        warning_emitted INTEGER NOT NULL DEFAULT 0 CHECK (warning_emitted IN (0, 1)),
        updated_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, node_id, window_day, metric),
        FOREIGN KEY (tenant_id, node_id) REFERENCES fleet_nodes(tenant_id, node_id)
      );

      CREATE TABLE quota_admissions (
        tenant_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        window_day TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        request_sha256 TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, node_id, window_day, idempotency_key),
        FOREIGN KEY (tenant_id, node_id) REFERENCES fleet_nodes(tenant_id, node_id)
      );

      CREATE INDEX quota_admissions_tenant_window
        ON quota_admissions (tenant_id, node_id, window_day, created_at);
    `,
  },
  {
    version: 14,
    name: 'p2_w7_demo_session_privacy_kernel',
    sql: `
      CREATE TABLE demo_sessions (
        tenant_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        expert_actor_ref TEXT NOT NULL CHECK (expert_actor_ref GLOB 'human:*'),
        node_id TEXT NOT NULL,
        source_boundary_json TEXT NOT NULL,
        capture_mode TEXT NOT NULL CHECK (capture_mode IN ('ax-tree+keyframes', 'events-only')),
        status TEXT NOT NULL CHECK (status IN ('capturing', 'paused', 'ended')),
        started_at TEXT NOT NULL,
        ended_at TEXT,
        paused_count INTEGER NOT NULL DEFAULT 0 CHECK (paused_count >= 0),
        local_only INTEGER NOT NULL DEFAULT 1 CHECK (local_only = 1),
        redaction_applied INTEGER NOT NULL DEFAULT 0 CHECK (redaction_applied IN (0, 1)),
        redaction_policy_ref TEXT,
        evidence_refs_json TEXT NOT NULL DEFAULT '[]',
        chain_head TEXT NOT NULL,
        deletion_audit_json TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, session_id),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id)
      );

      CREATE UNIQUE INDEX demo_sessions_global_id
        ON demo_sessions (session_id);
      CREATE INDEX demo_sessions_tenant_status
        ON demo_sessions (tenant_id, status, started_at);

      CREATE TABLE demo_session_segments (
        tenant_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        segment_id TEXT NOT NULL,
        sequence INTEGER NOT NULL CHECK (sequence > 0),
        started_at TEXT NOT NULL,
        ended_at TEXT,
        deleted_at TEXT,
        record_count INTEGER NOT NULL DEFAULT 0 CHECK (record_count >= 0),
        previous_digest TEXT,
        digest TEXT NOT NULL,
        PRIMARY KEY (tenant_id, session_id, segment_id),
        UNIQUE (tenant_id, session_id, sequence),
        FOREIGN KEY (tenant_id, session_id) REFERENCES demo_sessions(tenant_id, session_id)
      );

      CREATE TABLE demo_session_records (
        tenant_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        segment_id TEXT NOT NULL,
        sequence INTEGER NOT NULL CHECK (sequence > 0),
        kind TEXT NOT NULL CHECK (kind IN ('ax-node', 'input-event', 'keyframe-metadata')),
        occurred_at TEXT NOT NULL,
        app_name TEXT NOT NULL,
        window_name TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        digest TEXT NOT NULL,
        PRIMARY KEY (tenant_id, session_id, segment_id, sequence),
        FOREIGN KEY (tenant_id, session_id, segment_id)
          REFERENCES demo_session_segments(tenant_id, session_id, segment_id)
      );

      CREATE TRIGGER demo_sessions_no_delete
        BEFORE DELETE ON demo_sessions
        BEGIN SELECT RAISE(ABORT, 'demo session deletion requires a separately approved purge workflow'); END;
      CREATE TRIGGER demo_session_segments_no_delete
        BEFORE DELETE ON demo_session_segments
        BEGIN SELECT RAISE(ABORT, 'demo session segments are retained as deletion tombstones'); END;
    `,
  },
  {
    version: 15,
    name: 'p2_w10_public_marketplace_kernel',
    sql: `
      CREATE TABLE capability_packages (
        source_tenant_id TEXT NOT NULL,
        package_id TEXT NOT NULL,
        package_version INTEGER NOT NULL CHECK (package_version > 0),
        package_digest TEXT NOT NULL CHECK (length(package_digest) = 64),
        package_json TEXT NOT NULL,
        integrity_kind TEXT NOT NULL CHECK (integrity_kind = 'package_digest'),
        integrity_digest TEXT NOT NULL CHECK (length(integrity_digest) = 64),
        verified_by_actor_ref TEXT NOT NULL CHECK (verified_by_actor_ref GLOB 'human:*'),
        verified_at TEXT NOT NULL,
        PRIMARY KEY (source_tenant_id, package_id, package_version),
        UNIQUE (package_digest),
        UNIQUE (source_tenant_id, package_id, package_version, package_digest),
        FOREIGN KEY (source_tenant_id) REFERENCES tenants(id)
      );

      CREATE TABLE skill_trials (
        source_tenant_id TEXT NOT NULL,
        package_id TEXT NOT NULL,
        package_version INTEGER NOT NULL,
        trial_id TEXT NOT NULL,
        package_digest TEXT NOT NULL,
        mode TEXT NOT NULL CHECK (mode IN ('shadow', 'live')),
        ok INTEGER NOT NULL CHECK (ok IN (0, 1)),
        trial_json TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        PRIMARY KEY (source_tenant_id, package_id, package_version, trial_id),
        FOREIGN KEY (source_tenant_id, package_id, package_version, package_digest)
          REFERENCES capability_packages(source_tenant_id, package_id, package_version, package_digest)
      );

      CREATE INDEX skill_trials_package
        ON skill_trials (source_tenant_id, package_id, package_version, recorded_at);

      CREATE TABLE listings (
        listing_id TEXT PRIMARY KEY,
        source_tenant_id TEXT NOT NULL,
        package_id TEXT NOT NULL,
        package_version INTEGER NOT NULL,
        package_digest TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('public', 'taken_down')),
        public_projection_json TEXT NOT NULL,
        published_by_actor_ref TEXT NOT NULL CHECK (published_by_actor_ref GLOB 'human:*'),
        published_at TEXT NOT NULL,
        taken_down_at TEXT,
        FOREIGN KEY (source_tenant_id, package_id, package_version, package_digest)
          REFERENCES capability_packages(source_tenant_id, package_id, package_version, package_digest)
      );

      CREATE UNIQUE INDEX listings_one_public_package
        ON listings (source_tenant_id, package_id, package_version) WHERE status = 'public';
      CREATE INDEX listings_public_feed
        ON listings (status, published_at, listing_id);

      CREATE TABLE marketplace_reports (
        report_id TEXT PRIMARY KEY,
        listing_id TEXT NOT NULL,
        reporter_tenant_id TEXT NOT NULL,
        reporter_actor_ref TEXT NOT NULL CHECK (reporter_actor_ref GLOB 'human:*'),
        reason TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('open', 'resolved_actioned')),
        created_at TEXT NOT NULL,
        resolved_at TEXT,
        UNIQUE (report_id, listing_id),
        FOREIGN KEY (listing_id) REFERENCES listings(listing_id),
        FOREIGN KEY (reporter_tenant_id) REFERENCES tenants(id)
      );

      CREATE INDEX marketplace_reports_queue
        ON marketplace_reports (status, created_at, report_id);

      CREATE TABLE marketplace_moderation_actions (
        action_id TEXT PRIMARY KEY,
        report_id TEXT NOT NULL,
        listing_id TEXT NOT NULL,
        moderation_tenant_id TEXT NOT NULL,
        moderator_actor_ref TEXT NOT NULL CHECK (moderator_actor_ref GLOB 'human:*'),
        action TEXT NOT NULL CHECK (action = 'taken_down'),
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (report_id, listing_id) REFERENCES marketplace_reports(report_id, listing_id),
        FOREIGN KEY (listing_id) REFERENCES listings(listing_id),
        FOREIGN KEY (moderation_tenant_id) REFERENCES tenants(id)
      );

      CREATE TABLE marketplace_install_attempts (
        attempt_id TEXT PRIMARY KEY,
        listing_id TEXT NOT NULL,
        target_tenant_id TEXT NOT NULL,
        gate_id TEXT NOT NULL,
        decision TEXT NOT NULL CHECK (decision IN ('approved', 'denied')),
        reasons_json TEXT NOT NULL,
        request_digest TEXT NOT NULL CHECK (length(request_digest) = 64),
        decided_at TEXT NOT NULL,
        FOREIGN KEY (listing_id) REFERENCES listings(listing_id),
        FOREIGN KEY (target_tenant_id) REFERENCES tenants(id)
      );

      CREATE TRIGGER capability_packages_no_delete
        BEFORE DELETE ON capability_packages
        BEGIN SELECT RAISE(ABORT, 'verified capability packages are append-only'); END;
      CREATE TRIGGER capability_packages_member_guard
        BEFORE INSERT ON capability_packages
        WHEN NOT EXISTS (
          SELECT 1 FROM memberships
          WHERE tenant_id = NEW.source_tenant_id AND status = 'active'
            AND human_user_id = substr(NEW.verified_by_actor_ref, 7)
        )
        BEGIN SELECT RAISE(ABORT, 'marketplace authorization denied'); END;
      CREATE TRIGGER skill_trials_no_delete
        BEFORE DELETE ON skill_trials
        BEGIN SELECT RAISE(ABORT, 'skill trials are append-only'); END;
      CREATE TRIGGER listings_no_delete
        BEFORE DELETE ON listings
        BEGIN SELECT RAISE(ABORT, 'marketplace listings are retained for audit'); END;
      CREATE TRIGGER listings_member_guard
        BEFORE INSERT ON listings
        WHEN NOT EXISTS (
          SELECT 1 FROM memberships
          WHERE tenant_id = NEW.source_tenant_id AND status = 'active'
            AND human_user_id = substr(NEW.published_by_actor_ref, 7)
        )
        BEGIN SELECT RAISE(ABORT, 'marketplace authorization denied'); END;
      CREATE TRIGGER marketplace_reports_member_guard
        BEFORE INSERT ON marketplace_reports
        WHEN NOT EXISTS (
          SELECT 1 FROM memberships
          WHERE tenant_id = NEW.reporter_tenant_id AND status = 'active'
            AND human_user_id = substr(NEW.reporter_actor_ref, 7)
        )
        BEGIN SELECT RAISE(ABORT, 'marketplace authorization denied'); END;
      CREATE TRIGGER moderation_actions_member_guard
        BEFORE INSERT ON marketplace_moderation_actions
        WHEN NOT EXISTS (
          SELECT 1 FROM memberships
          WHERE tenant_id = NEW.moderation_tenant_id AND status = 'active'
            AND human_user_id = substr(NEW.moderator_actor_ref, 7)
        )
        BEGIN SELECT RAISE(ABORT, 'marketplace authorization denied'); END;
      CREATE TRIGGER listings_takedown_requires_action
        BEFORE UPDATE OF status ON listings
        WHEN NEW.status = 'taken_down' AND OLD.status != 'taken_down'
          AND NOT EXISTS (
            SELECT 1 FROM marketplace_moderation_actions
            WHERE listing_id = NEW.listing_id AND action = 'taken_down'
          )
        BEGIN SELECT RAISE(ABORT, 'listing takedown requires a human moderation action'); END;
      CREATE TRIGGER listings_no_republish
        BEFORE UPDATE OF status ON listings
        WHEN OLD.status = 'taken_down' AND NEW.status != 'taken_down'
        BEGIN SELECT RAISE(ABORT, 'taken-down listing cannot be republished'); END;
      CREATE TRIGGER moderation_actions_no_delete
        BEFORE DELETE ON marketplace_moderation_actions
        BEGIN SELECT RAISE(ABORT, 'moderation actions are append-only'); END;
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
    migration.up?.(database);
    database.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
      .run(migration.version, migration.name, new Date().toISOString());
  });
  for (const migration of migrations) {
    if (!applied.has(migration.version)) apply(migration);
  }
}

interface LegacyDomainEventRow {
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
}

function backfillTenantEventChains(database: SqliteDatabase): void {
  const invalidTenant = database.prepare(`
    SELECT id FROM tenants WHERE status NOT IN ('active', 'suspended', 'export_required', 'destroyed') LIMIT 1
  `).get<{ id: string }>();
  if (invalidTenant) throw new Error('Cannot migrate an invalid tenant lifecycle status');
  const rows = database.prepare('SELECT * FROM domain_events ORDER BY position').all<LegacyDomainEventRow>();
  const heads = new Map<string, { position: number; hash: string; updatedAt: string }>();
  const insertChain = database.prepare(`
    INSERT INTO tenant_event_chain (tenant_id, tenant_position, event_id, previous_hash, hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const row of rows) {
    const previous = heads.get(row.tenant_id);
    const tenantPosition = (previous?.position ?? 0) + 1;
    const previousHash = previous?.hash ?? null;
    const hash = computeTenantEventHash({
      id: row.id,
      tenantId: row.tenant_id,
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      aggregateVersion: row.aggregate_version,
      type: row.event_type,
      occurredAt: row.occurred_at,
      actorRef: row.actor_ref,
      correlationId: row.correlation_id,
      payload: JSON.parse(row.canonical_payload) as JsonValue,
    }, tenantPosition, previousHash);
    insertChain.run(row.tenant_id, tenantPosition, row.id, previousHash, hash, row.occurred_at);
    heads.set(row.tenant_id, { position: tenantPosition, hash, updatedAt: row.occurred_at });
  }
  const insertHead = database.prepare(`
    INSERT INTO tenant_chain_heads (tenant_id, position, hash, updated_at) VALUES (?, ?, ?, ?)
  `);
  for (const [tenantId, head] of heads) {
    insertHead.run(tenantId, head.position, head.hash, head.updatedAt);
  }
}
