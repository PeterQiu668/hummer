import { currentSessionToken } from '../identity/identityClient';

export interface ApprovalAuthorizationRequest {
  sessionId: string;
  approvalId: string;
  action: string;
  requestedBy: string;
  estimatedCostCny: number | null;
  approved: boolean;
  occurredAt: string;
}
export interface ApprovalPreviewRequest {
  action: string;
  requestedBy: string;
  estimatedCostCny: number | null;
}
export interface ApprovalAuthorizationResult {
  approved: boolean;
  effect: 'allow' | 'require_approval' | 'deny';
  policyId: string | null;
  approverActorRef: string | null;
  reason: 'matched_rule' | 'budget_exceeded' | 'default_deny';
}
export interface ApprovalPreviewResult extends Omit<ApprovalAuthorizationResult, 'approved'> {
  approverDisplayName: string | null;
  actionPattern: string | null;
  riskLevel: 'low' | 'medium' | 'high' | 'critical' | null;
  budgetLimitCny: number | null;
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
  approverDisplayName: string | null;
  decisionActorRef: string | null;
  decisionActorDisplayName: string | null;
  decisionEventType: string | null;
  eventHash: string | null;
}
export interface ApprovalPolicyPort {
  preview(request: ApprovalPreviewRequest): Promise<ApprovalPreviewResult>;
  authorize(request: ApprovalAuthorizationRequest): Promise<ApprovalAuthorizationResult>;
  evidence(request: { sessionId: string; approvalId: string }): Promise<ApprovalEvidence>;
}
interface DesktopApprovalPolicyHost {
  preview(request: { token: string; input: ApprovalPreviewRequest }): Promise<ApprovalPreviewResult>;
  authorize(request: { token: string; input: ApprovalAuthorizationRequest }): Promise<ApprovalAuthorizationResult>;
  evidence(request: { token: string; input: { sessionId: string; approvalId: string } }): Promise<ApprovalEvidence>;
}
declare global { interface Window { hummerApprovalPolicy?: DesktopApprovalPolicyHost } }

export function desktopApprovalPolicyPort(): ApprovalPolicyPort | undefined {
  if (typeof window === 'undefined' || !window.hummerApprovalPolicy) return undefined;
  const host = window.hummerApprovalPolicy;
  return {
    preview: (request) => host.preview({ token: requireToken(), input: request }),
    authorize: (request) => host.authorize({ token: requireToken(), input: request }),
    evidence: (request) => host.evidence({ token: requireToken(), input: request }),
  };
}
function requireToken(): string {
  const token = currentSessionToken();
  if (!token) throw new Error('Approval requires an authenticated account');
  return token;
}
