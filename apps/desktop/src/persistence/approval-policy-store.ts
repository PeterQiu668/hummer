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
  sequence: number;
  requested_at: string;
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

  ensureDefaults(tenantId: string, approverActorRef = 'human:owner'): void {
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

  authorize(input: AuthorizeApprovalInput): ApprovalAuthorization {
    this.ensureDefaults(input.tenantId);
    const decision = evaluateApprovalPolicy(this.list(input.tenantId), input);
    const approverMatches = decision.effect !== 'require_approval' || decision.approverActorRef === input.approverActorRef;
    const approved = input.approved && decision.effect !== 'deny' && approverMatches;
    const authorization: ApprovalAuthorization = { ...decision, approved };
    const run = this.database.transaction(() => {
      const current = this.database.prepare(`
        SELECT sequence, requested_at, payload_json FROM approvals WHERE id = ? AND session_id = ?
      `).get<ApprovalRow>(input.approvalId, input.sessionId);
      if (!current) throw new Error(`Approval ${input.approvalId} is not pending for session ${input.sessionId}`);
      const payload = parsePayload(current.payload_json);
      this.database.prepare(`
        UPDATE approvals SET status = ?, resolved_at = ?, payload_json = ? WHERE id = ? AND session_id = ?
      `).run(
        approved ? 'approved' : 'declined',
        input.occurredAt,
        canonicalJson({ ...payload, policyAuthorization: authorization, approverActorRef: input.approverActorRef }),
        input.approvalId,
        input.sessionId,
      );
      this.events.append({
        id: `evt_${randomUUID()}`,
        tenantId: input.tenantId,
        aggregateType: 'approval',
        aggregateId: input.approvalId,
        type: approved ? 'approval.authorized' : 'approval.denied',
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
