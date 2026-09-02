import { randomUUID } from 'node:crypto';
import { evaluateApprovalPolicy, type ApprovalPolicyDecision, type ApprovalPolicyRequest, type ApprovalPolicyRule } from '../policy/approval-policy.js';
import { canonicalJson, type JsonValue } from './canonical-json.js';
import { DomainEventStore } from './domain-event-store.js';
import type { SqliteDatabase } from './sqlite.js';

export interface AuthorizeApprovalInput extends ApprovalPolicyRequest {
  tenantId: string;
  sessionId: string;
  approvalId: string;
  approverActorRef: string;
  approved: boolean;
  occurredAt: string;
}

export interface ApprovalAuthorization extends ApprovalPolicyDecision {
  approved: boolean;
}

export interface ApprovalEvidence {
  id: string;
  sessionId: string;
  status: 'pending' | 'approved' | 'declined';
  requestedAt: string;
  decidedAt: string | null;
  action: string;
  requestedBy: string;
  estimatedCostCny: number | null;
  policyId: string | null;
  approverActorRef: string | null;
  decisionActorRef: string | null;
  decisionEventType: string | null;
  eventHash: string | null;
}

interface PolicyRow {
  id: string;
  action_pattern: string;
  risk_level: ApprovalPolicyRule['riskLevel'];
  effect: ApprovalPolicyRule['effect'];
  approver_actor_ref: string;
  budget_limit_cny: number | null;
  enabled: number;
}

interface ApprovalRow {
  id: string;
  session_id: string;
  sequence: number;
  status: 'pending' | 'approved' | 'declined';
  requested_at: string;
  resolved_at: string | null;
  payload_json: string;
}

const DEFAULT_POLICIES = [
  ['policy_file_write', 'file.write*', 'high', 20],
  ['policy_shell_command', 'shell.command*', 'high', 20],
  ['policy_external_send', 'external.send*', 'high', 10],
  ['policy_payment', 'payment.*', 'critical', 0],
  ['policy_permission', 'permission.*', 'critical', 0],
  ['policy_data_delete', 'data.delete*', 'critical', 0],
  ['policy_crm_write', 'crm.write*', 'high', 20],
] as const;

export class ApprovalPolicyStore {
  private readonly events: DomainEventStore;

  constructor(private readonly database: SqliteDatabase) {
    this.events = new DomainEventStore(database);
  }

  ensureDefaults(tenantId: string, approverActorRef: string): void {
    const now = new Date().toISOString();
    const insert = this.database.prepare(`
      INSERT OR IGNORE INTO approval_policies
        (id, tenant_id, action_pattern, risk_level, effect, approver_actor_ref,
         budget_limit_cny, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'require_approval', ?, ?, 1, ?, ?)
    `);
    const run = this.database.transaction(() => {
      for (const [id, actionPattern, riskLevel, budgetLimitCny] of DEFAULT_POLICIES) {
        insert.run(`${tenantId}_${id}`, tenantId, actionPattern, riskLevel, approverActorRef, budgetLimitCny, now, now);
      }
    });
    run();
  }

  list(tenantId: string): ApprovalPolicyRule[] {
    return this.database.prepare(`
      SELECT id, action_pattern, risk_level, effect, approver_actor_ref, budget_limit_cny, enabled
      FROM approval_policies WHERE tenant_id = ? ORDER BY id
    `).all<PolicyRow>(tenantId).map((row) => ({
      id: row.id,
      actionPattern: row.action_pattern,
      riskLevel: row.risk_level,
      effect: row.effect,
      approverActorRef: row.approver_actor_ref,
      budgetLimitCny: row.budget_limit_cny,
      enabled: row.enabled === 1,
    }));
  }

  preview(tenantId: string, input: ApprovalPolicyRequest): ApprovalPolicyDecision {
    return evaluateApprovalPolicy(this.list(tenantId), input);
  }

  getEvidence(tenantId: string, sessionId: string, approvalId: string): ApprovalEvidence | undefined {
    const row = this.database.prepare(`
      SELECT a.id, a.session_id, a.sequence, a.status, a.requested_at, a.resolved_at, a.payload_json
      FROM approvals a
      JOIN sessions s ON s.id = a.session_id
      WHERE a.id = ? AND a.session_id = ? AND s.tenant_id = ?
    `).get<ApprovalRow>(approvalId, sessionId, tenantId);
    if (!row) return undefined;
    const payload = parsePayload(row.payload_json);
    const authorization = objectField(payload, 'policyAuthorization');
    const request = objectField(payload, 'approvalRequest');
    const decision = this.events.listByTenant(tenantId)
      .filter((event) => event.aggregateType === 'approval' && event.aggregateId === approvalId)
      .at(-1);
    return {
      id: row.id,
      sessionId: row.session_id,
      status: row.status,
      requestedAt: row.requested_at,
      decidedAt: row.resolved_at,
      action: stringField(request, 'action') ?? stringField(payload, 'tool') ?? 'unknown',
      requestedBy: stringField(request, 'requestedBy') ?? stringField(payload, 'actorRef') ?? 'unknown',
      estimatedCostCny: numberField(request, 'estimatedCostCny') ?? numberField(payload, 'costCny'),
      policyId: stringField(authorization, 'policyId') ?? null,
      approverActorRef: stringField(payload, 'approverActorRef') ?? stringField(authorization, 'approverActorRef') ?? null,
      decisionActorRef: decision?.actorRef ?? null,
      decisionEventType: decision?.type ?? null,
      eventHash: decision?.hash ?? null,
    };
  }

  authorize(input: AuthorizeApprovalInput): ApprovalAuthorization {
    const decision = evaluateApprovalPolicy(this.list(input.tenantId), input);
    const approverMatches = decision.effect !== 'require_approval' || decision.approverActorRef === input.approverActorRef;
    const approved = input.approved && decision.effect !== 'deny' && approverMatches;
    const authorization: ApprovalAuthorization = { ...decision, approved };
    const run = this.database.transaction(() => {
      const current = this.database.prepare(`
        SELECT id, session_id, sequence, status, requested_at, resolved_at, payload_json FROM approvals WHERE id = ? AND session_id = ?
      `).get<ApprovalRow>(input.approvalId, input.sessionId);
      if (!current) throw new Error(`Approval ${input.approvalId} is not pending for session ${input.sessionId}`);
      const payload = parsePayload(current.payload_json);
      this.database.prepare(`
        UPDATE approvals SET status = ?, resolved_at = ?, payload_json = ? WHERE id = ? AND session_id = ?
      `).run(
        approved ? 'approved' : 'declined',
        input.occurredAt,
        canonicalJson({
          ...payload,
          approvalRequest: { action: input.action, requestedBy: input.requestedBy, estimatedCostCny: input.estimatedCostCny },
          policyAuthorization: authorization,
          approverActorRef: input.approverActorRef,
        }),
        input.approvalId,
        input.sessionId,
      );
      this.events.append({
        id: `evt_${randomUUID()}`,
        tenantId: input.tenantId,
        aggregateType: 'approval',
        aggregateId: input.approvalId,
        type: approved ? 'approval.authorized' : input.approved ? 'approval.denied' : 'approval.rejected',
        occurredAt: input.occurredAt,
        actorRef: input.approverActorRef,
        correlationId: `corr_${input.sessionId}`,
        payload: {
          action: input.action,
          approvalId: input.approvalId,
          approved,
          policyId: decision.policyId,
          reason: approverMatches ? decision.reason : 'approver_mismatch',
          sessionId: input.sessionId,
        },
      });
    });
    run();
    return authorization;
  }
}

function parsePayload(value: string): Record<string, JsonValue> {
  const parsed = JSON.parse(value) as JsonValue;
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : {};
}

function objectField(value: Record<string, JsonValue>, key: string): Record<string, JsonValue> {
  const candidate = value[key];
  return typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate) ? candidate : {};
}

function stringField(value: Record<string, JsonValue>, key: string): string | undefined {
  const candidate = value[key];
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : undefined;
}

function numberField(value: Record<string, JsonValue>, key: string): number | null {
  const candidate = value[key];
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : null;
}
