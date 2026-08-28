export type ApprovalEffect = 'allow' | 'require_approval' | 'deny';

export interface ApprovalPolicyRule {
  id: string;
  actionPattern: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  effect: ApprovalEffect;
  approverActorRef: string;
  budgetLimitCny: number | null;
  enabled: boolean;
}

export interface ApprovalPolicyRequest {
  action: string;
  requestedBy: string;
  estimatedCostCny: number | null;
}

export interface ApprovalPolicyDecision {
  effect: ApprovalEffect;
  policyId: string | null;
  approverActorRef: string | null;
  reason: 'matched_rule' | 'budget_exceeded' | 'default_deny';
}

export function evaluateApprovalPolicy(
  rules: readonly ApprovalPolicyRule[],
  request: ApprovalPolicyRequest,
): ApprovalPolicyDecision {
  const rule = rules
    .filter((candidate) => candidate.enabled && matchesAction(candidate.actionPattern, request.action))
    .sort((left, right) => riskRank(right.riskLevel) - riskRank(left.riskLevel))[0];

  if (!rule) {
    return { effect: 'deny', policyId: null, approverActorRef: null, reason: 'default_deny' };
  }
  if (rule.budgetLimitCny !== null && request.estimatedCostCny !== null && request.estimatedCostCny > rule.budgetLimitCny) {
    return { effect: 'deny', policyId: rule.id, approverActorRef: rule.approverActorRef, reason: 'budget_exceeded' };
  }
  return {
    effect: rule.effect,
    policyId: rule.id,
    approverActorRef: rule.effect === 'allow' ? null : rule.approverActorRef,
    reason: 'matched_rule',
  };
}

function matchesAction(pattern: string, action: string): boolean {
  if (pattern === '*') return true;
  if (pattern.endsWith('*')) return action.startsWith(pattern.slice(0, -1));
  return pattern === action;
}

function riskRank(risk: ApprovalPolicyRule['riskLevel']): number {
  return { low: 1, medium: 2, high: 3, critical: 4 }[risk];
}
