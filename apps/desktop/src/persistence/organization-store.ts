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
      const ownerHumanId = input.sponsorActorRef.startsWith('human:')
        ? input.sponsorActorRef.slice('human:'.length)
        : 'owner';
      this.database.prepare(`
        INSERT OR IGNORE INTO human_users
          (id, tenant_id, display_name, role, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'active', ?, ?)
      `).run(ownerHumanId, input.tenantId, ownerHumanId, 'accountable_owner', now, now);
      this.database.prepare(`
        INSERT OR IGNORE INTO departments
          (id, tenant_id, name, owner_human_id, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'active', ?, ?)
      `).run(input.departmentId, input.tenantId, input.departmentId, ownerHumanId, now, now);

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
      return this.requireEmployee(input.id);
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

  private requireEmployee(id: string): DigitalEmployeeRecord {
    const row = this.database.prepare(`
      SELECT id, tenant_id, sponsor_actor_ref, department_id, name, job_title,
        runtime_profile, autonomy_level, status, created_at, updated_at
      FROM digital_employees WHERE id = ?
    `).get<EmployeeRow>(id);
    if (!row) throw new Error(`Digital employee ${id} was not persisted`);
    return mapEmployee(row);
  }
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
