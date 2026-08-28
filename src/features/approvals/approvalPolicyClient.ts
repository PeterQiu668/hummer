export interface ApprovalAuthorizationRequest {
  tenantId: string;
  sessionId: string;
  approvalId: string;
  action: string;
  requestedBy: string;
  estimatedCostCny: number | null;
  approverActorRef: string;
  approved: boolean;
  occurredAt: string;
}

export interface ApprovalAuthorizationResult {
  approved: boolean;
  effect: 'allow' | 'require_approval' | 'deny';
  policyId: string | null;
  approverActorRef: string | null;
  reason: 'matched_rule' | 'budget_exceeded' | 'default_deny';
}

export interface ApprovalPolicyPort {
  authorize(request: ApprovalAuthorizationRequest): Promise<ApprovalAuthorizationResult>;
}

declare global {
  interface Window {
    hummerApprovalPolicy?: ApprovalPolicyPort;
  }
}

export function desktopApprovalPolicyPort(): ApprovalPolicyPort | undefined {
  return typeof window === 'undefined' ? undefined : window.hummerApprovalPolicy;
}
