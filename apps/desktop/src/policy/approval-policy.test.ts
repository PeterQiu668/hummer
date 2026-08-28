import { describe, expect, it } from 'vitest';
import { evaluateApprovalPolicy, type ApprovalPolicyRule } from './approval-policy.js';

const rules: ApprovalPolicyRule[] = [{
  id: 'policy_high_risk_write',
  actionPattern: 'file.write*',
  riskLevel: 'high',
  effect: 'require_approval',
  approverActorRef: 'human:owner',
  budgetLimitCny: 20,
  enabled: true,
}];

describe('approval policy engine', () => {
  it('requires the assigned approver for a matching high-risk action', () => {
    expect(evaluateApprovalPolicy(rules, {
      action: 'file.write.customer-report',
      requestedBy: 'employee_m-1',
      estimatedCostCny: 5,
    })).toEqual({
      effect: 'require_approval',
      policyId: 'policy_high_risk_write',
      approverActorRef: 'human:owner',
      reason: 'matched_rule',
    });
  });

  it('denies a request over the configured budget', () => {
    expect(evaluateApprovalPolicy(rules, {
      action: 'file.write.customer-report',
      requestedBy: 'employee_m-1',
      estimatedCostCny: 21,
    }).reason).toBe('budget_exceeded');
  });

  it('fails closed when no policy matches', () => {
    expect(evaluateApprovalPolicy(rules, {
      action: 'command.execute',
      requestedBy: 'employee_m-1',
      estimatedCostCny: null,
    })).toEqual({ effect: 'deny', policyId: null, approverActorRef: null, reason: 'default_deny' });
  });
});
