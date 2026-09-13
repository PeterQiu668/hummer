import { randomUUID } from 'node:crypto';
import type { WorkspaceExecArtifact, WorkspaceExecHealth } from '../workspace-exec-service.js';
import { canonicalJson, type JsonValue } from './canonical-json.js';
import { DomainEventStore } from './domain-event-store.js';
import type { SqliteDatabase } from './sqlite.js';

export class WorkspaceExecStore {
  private readonly events: DomainEventStore;

  constructor(private readonly database: SqliteDatabase) {
    this.events = new DomainEventStore(database);
  }

  recordHealth(health: WorkspaceExecHealth): void {
    const id = `sandbox_check_${randomUUID()}`;
    const transaction = this.database.transaction(() => {
      this.database.prepare(`
        INSERT INTO execution_sandbox_checks
          (id, runtime, status, passed_probes, total_probes, issue, result_json, checked_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, health.runtime, health.available ? 'passed' : 'failed', health.passed, health.total, health.issue, canonicalJson(health as unknown as JsonValue), health.checkedAt);
      this.events.append({
        id: `evt_${randomUUID()}`,
        tenantId: 'system',
        aggregateType: 'execution_sandbox',
        aggregateId: 'local-host',
        type: health.available ? 'execution_sandbox.self_check_passed' : 'execution_sandbox.self_check_failed',
        occurredAt: health.checkedAt,
        actorRef: 'system:desktop-host',
        correlationId: `corr_${id}`,
        payload: { runtime: health.runtime, passed: health.passed, total: health.total, issue: health.issue },
      });
    });
    transaction();
  }

  recordJob(input: {
    tenantId: string;
    sessionId: string;
    workOrderId: string;
    actorRef: string;
    argv: string[];
    exitCode: number;
    durationMs: number;
    artifacts: WorkspaceExecArtifact[];
    occurredAt: string;
  }): void {
    const id = `workspace_job_${randomUUID()}`;
    const status = input.exitCode === 0 ? 'completed' : 'failed';
    const transaction = this.database.transaction(() => {
      this.database.prepare(`
        INSERT INTO workspace_exec_jobs
          (id, tenant_id, session_id, work_order_id, status, argv_json, exit_code, duration_ms, artifacts_json, occurred_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, input.tenantId, input.sessionId, input.workOrderId, status,
        canonicalJson(input.argv), input.exitCode, input.durationMs, canonicalJson(input.artifacts as unknown as JsonValue), input.occurredAt,
      );
      this.events.append({
        id: `evt_${randomUUID()}`,
        tenantId: input.tenantId,
        aggregateType: 'workspace_exec_job',
        aggregateId: id,
        type: `workspace_exec.${status}`,
        occurredAt: input.occurredAt,
        actorRef: input.actorRef,
        correlationId: `corr_${input.sessionId}`,
        payload: {
          sessionId: input.sessionId,
          workOrderId: input.workOrderId,
          exitCode: input.exitCode,
          durationMs: input.durationMs,
          artifacts: input.artifacts,
        } as unknown as JsonValue,
      });
    });
    transaction();
  }
}
