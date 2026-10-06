import { randomUUID } from 'node:crypto';
import { DomainEventStore } from './domain-event-store.js';
import type { SqliteDatabase } from './sqlite.js';

export interface HireDigitalEmployeeInput {
  id: string;
  tenantId: string;
  sponsorActorRef: string;
  departmentId: string;
  name: string;
  jobTitle: string;
  runtimeProfile: string;
  autonomyLevel: 'L1' | 'L2' | 'L3';
  idempotencyKey: string;
}

export interface DigitalEmployeeRecord {
  id: string;
  tenantId: string;
  sponsorActorRef: string;
  departmentId: string | null;
  name: string;
  jobTitle: string;
  runtimeProfile: string;
  autonomyLevel: 'L1' | 'L2' | 'L3';
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface EmployeeRow {
  id: string;
  tenant_id: string;
  sponsor_actor_ref: string;
  department_id: string | null;
  name: string;
  job_title: string;
  runtime_profile: string;
  autonomy_level: 'L1' | 'L2' | 'L3';
  status: string;
  created_at: string;
  updated_at: string;
}

export class OrganizationStore {
  private readonly events: DomainEventStore;

  constructor(private readonly database: SqliteDatabase) {
    this.events = new DomainEventStore(database);
  }

  hireDigitalEmployee(input: HireDigitalEmployeeInput): DigitalEmployeeRecord {
    validateHire(input);
    const run = this.database.transaction(() => {
      const existing = this.database.prepare(`
        SELECT id, tenant_id, sponsor_actor_ref, department_id, name, job_title,
          runtime_profile, autonomy_level, status, created_at, updated_at
        FROM digital_employees WHERE tenant_id = ? AND idempotency_key = ?
      `).get<EmployeeRow>(input.tenantId, input.idempotencyKey);
      if (existing) return mapEmployee(existing);

      const now = new Date().toISOString();
      this.assertIdentifierTenant('digital_employees', input.id, input.tenantId);
      const ownerHumanId = this.resolveSponsorHuman(input.tenantId, input.sponsorActorRef);
      this.ensureDepartment(input.tenantId, input.departmentId, ownerHumanId, now);

      const payload = JSON.stringify({
        source: 'employee_marketplace',
        probationDays: 7,
        permissionBoundary: 'least_privilege',
      });
      this.database.prepare(`
        INSERT INTO digital_employees
          (id, tenant_id, sponsor_actor_ref, department_id, name, job_title,
           runtime_profile, autonomy_level, status, idempotency_key, payload_json,
           created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'probation', ?, ?, ?, ?)
      `).run(
        input.id,
        input.tenantId,
        input.sponsorActorRef,
        input.departmentId,
        input.name,
        input.jobTitle,
        input.runtimeProfile,
        input.autonomyLevel,
        input.idempotencyKey,
        payload,
        now,
        now,
      );
      this.events.append({
        id: `evt_${randomUUID()}`,
        tenantId: input.tenantId,
        aggregateType: 'digital_employee',
        aggregateId: input.id,
        type: 'digital_employee.hired',
        occurredAt: now,
        actorRef: input.sponsorActorRef,
        correlationId: `corr_${input.idempotencyKey}`,
        payload: {
          employeeId: input.id,
          departmentId: input.departmentId,
          jobTitle: input.jobTitle,
          runtimeProfile: input.runtimeProfile,
          autonomyLevel: input.autonomyLevel,
          status: 'probation',
        },
      });
      return this.requireEmployee(input.tenantId, input.id);
    });
    return run();
  }

  listDigitalEmployees(tenantId: string): DigitalEmployeeRecord[] {
    return this.database.prepare(`
      SELECT id, tenant_id, sponsor_actor_ref, department_id, name, job_title,
        runtime_profile, autonomy_level, status, created_at, updated_at
      FROM digital_employees WHERE tenant_id = ? ORDER BY created_at, id
    `).all<EmployeeRow>(tenantId).map(mapEmployee);
  }

  private requireEmployee(tenantId: string, id: string): DigitalEmployeeRecord {
    const row = this.database.prepare(`
      SELECT id, tenant_id, sponsor_actor_ref, department_id, name, job_title,
        runtime_profile, autonomy_level, status, created_at, updated_at
      FROM digital_employees WHERE tenant_id = ? AND id = ?
    `).get<EmployeeRow>(tenantId, id);
    if (!row) throw unavailableOrganizationResource();
    return mapEmployee(row);
  }

  private resolveSponsorHuman(tenantId: string, actorRef: string): string {
    if (actorRef.startsWith('twin:')) {
      const twinId = actorRef.slice('twin:'.length);
      const twin = this.database.prepare(`
        SELECT owner_human_id FROM digital_twins WHERE tenant_id = ? AND id = ? AND status = 'active'
      `).get<{ owner_human_id: string }>(tenantId, twinId);
      if (!twin) throw unavailableOrganizationResource();
      return twin.owner_human_id;
    }

    const humanId = actorRef.slice('human:'.length);
    const existing = this.database.prepare('SELECT id FROM human_users WHERE tenant_id = ? AND id = ?')
      .get<{ id: string }>(tenantId, humanId);
    if (!existing) throw unavailableOrganizationResource();
    return humanId;
  }

  private ensureDepartment(tenantId: string, departmentId: string, ownerHumanId: string, now: string): void {
    this.assertIdentifierTenant('departments', departmentId, tenantId);
    const existing = this.database.prepare('SELECT id FROM departments WHERE tenant_id = ? AND id = ?')
      .get<{ id: string }>(tenantId, departmentId);
    if (!existing) this.database.prepare(`
      INSERT INTO departments
        (id, tenant_id, name, owner_human_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'active', ?, ?)
    `).run(departmentId, tenantId, departmentId, ownerHumanId, now, now);
  }

  private assertIdentifierTenant(table: 'human_users' | 'departments' | 'digital_employees', id: string, tenantId: string): void {
    const row = this.database.prepare(`SELECT tenant_id FROM ${table} WHERE id = ?`)
      .get<{ tenant_id: string }>(id);
    if (row && row.tenant_id !== tenantId) throw unavailableOrganizationResource();
  }
}

function unavailableOrganizationResource(): Error {
  return new Error('Organization resource is unavailable in the current tenant');
}

function validateHire(input: HireDigitalEmployeeInput): void {
  if (!/^employee_[A-Za-z0-9_-]+$/.test(input.id)) throw new TypeError('Digital employee id must start with employee_');
  if (!input.tenantId || !input.departmentId || !input.name || !input.jobTitle) throw new TypeError('Digital employee hire requires tenant, department, name and job title');
  if (!/^(human|twin):[A-Za-z0-9_-]+$/.test(input.sponsorActorRef)) throw new TypeError('Digital employee sponsor must be a human or twin actor');
  if (input.idempotencyKey.length < 8) throw new TypeError('Hire idempotency key must contain at least 8 characters');
}

function mapEmployee(row: EmployeeRow): DigitalEmployeeRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    sponsorActorRef: row.sponsor_actor_ref,
    departmentId: row.department_id,
    name: row.name,
    jobTitle: row.job_title,
    runtimeProfile: row.runtime_profile,
    autonomyLevel: row.autonomy_level,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
