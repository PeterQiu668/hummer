import type { IdentityContext, MembershipRole } from './persistence/index.js';

export type DesktopRoleAction =
  | 'manage_members'
  | 'change_policy'
  | 'approve_high_risk'
  | 'create_task'
  | 'read_receipt_audit'
  | 'export_capability'
  | 'start_recording'
  | 'destroy_tenant'
  | 'accept_result';

export type DesktopRoleActionContext = {
  manage_members: Record<string, never>;
  change_policy: Record<string, never>;
  approve_high_risk: {
    riskLevel: 'low' | 'medium' | 'high';
    initiatedByActorId: string;
    approvalScope: 'egress' | 'write' | 'other';
  };
  create_task: Record<string, never>;
  read_receipt_audit: { participantActorIds: string[]; nodeRelated: boolean };
  export_capability: { capabilityOwnerActorId: string; mode: 'read_only' | 'share' };
  start_recording: { recordingSubjectActorId: string };
  destroy_tenant: { l3Approved: boolean; verifiedExportAvailable: boolean };
  accept_result: { initiatedByActorId: string; participantActorIds: string[] };
};

export type DesktopRolePolicyRequest<Action extends DesktopRoleAction = DesktopRoleAction> = {
  role: MembershipRole;
  actorId: string;
  actorTenantId: string;
  targetTenantId: string;
  action: Action;
  context: DesktopRoleActionContext[Action];
};

export type DesktopRolePolicyReason =
  | 'allowed_by_role_policy'
  | 'cross_tenant_forbidden'
  | 'role_forbidden'
  | 'member_requires_self_low_risk'
  | 'member_requires_participation'
  | 'member_requires_own_capability'
  | 'member_requires_self_recording'
  | 'operator_requires_egress_or_write'
  | 'operator_requires_node_related_read'
  | 'owner_requires_l3_and_verified_export'
  | 'final_acceptance_role_forbidden';

export interface DesktopRolePolicyDecision {
  allowed: boolean;
  reason: DesktopRolePolicyReason;
}

const ALLOWED: DesktopRolePolicyDecision = { allowed: true, reason: 'allowed_by_role_policy' };

function deny(reason: Exclude<DesktopRolePolicyReason, 'allowed_by_role_policy'>): DesktopRolePolicyDecision {
  return { allowed: false, reason };
}

/**
 * Runtime-safe mirror of the contracts policy. Electron ships only apps/desktop/dist today, so
 * importing the contracts package at runtime would leave a reference to workspace TypeScript.
 * desktop-role-policy-parity.test.ts locks this adapter to the canonical contract.
 */
export function evaluateDesktopRolePolicy(request: DesktopRolePolicyRequest): DesktopRolePolicyDecision {
  if (request.actorTenantId !== request.targetTenantId) return deny('cross_tenant_forbidden');

  switch (request.action) {
    case 'manage_members':
    case 'change_policy':
      return isOwnerOrAdmin(request.role) ? ALLOWED : deny('role_forbidden');
    case 'create_task':
      return request.role === 'auditor' ? deny('role_forbidden') : ALLOWED;
    case 'approve_high_risk': {
      const context = request.context as DesktopRoleActionContext['approve_high_risk'];
      if (isOwnerOrAdmin(request.role)) return ALLOWED;
      if (request.role === 'member') {
        return context.riskLevel === 'low' && context.initiatedByActorId === request.actorId
          ? ALLOWED
          : deny('member_requires_self_low_risk');
      }
      if (request.role === 'operator') {
        return context.approvalScope === 'egress' || context.approvalScope === 'write'
          ? ALLOWED
          : deny('operator_requires_egress_or_write');
      }
      return deny('role_forbidden');
    }
    case 'read_receipt_audit': {
      const context = request.context as DesktopRoleActionContext['read_receipt_audit'];
      if (isOwnerOrAdmin(request.role) || request.role === 'auditor') return ALLOWED;
      if (request.role === 'member') {
        return context.participantActorIds.includes(request.actorId)
          ? ALLOWED
          : deny('member_requires_participation');
      }
      if (request.role === 'operator') {
        return context.nodeRelated ? ALLOWED : deny('operator_requires_node_related_read');
      }
      return deny('role_forbidden');
    }
    case 'export_capability': {
      const context = request.context as DesktopRoleActionContext['export_capability'];
      if (isOwnerOrAdmin(request.role)) return ALLOWED;
      if (request.role === 'member') {
        return context.capabilityOwnerActorId === request.actorId
          ? ALLOWED
          : deny('member_requires_own_capability');
      }
      return request.role === 'auditor' && context.mode === 'read_only'
        ? ALLOWED
        : deny('role_forbidden');
    }
    case 'start_recording': {
      const context = request.context as DesktopRoleActionContext['start_recording'];
      if (isOwnerOrAdmin(request.role)) return ALLOWED;
      if (request.role === 'member') {
        return context.recordingSubjectActorId === request.actorId
          ? ALLOWED
          : deny('member_requires_self_recording');
      }
      return deny('role_forbidden');
    }
    case 'destroy_tenant': {
      const context = request.context as DesktopRoleActionContext['destroy_tenant'];
      return request.role === 'owner' && context.l3Approved && context.verifiedExportAvailable
        ? ALLOWED
        : deny(request.role === 'owner' ? 'owner_requires_l3_and_verified_export' : 'role_forbidden');
    }
    case 'accept_result': {
      const context = request.context as DesktopRoleActionContext['accept_result'];
      if (request.role === 'auditor' || request.role === 'operator') {
        return deny('final_acceptance_role_forbidden');
      }
      if (isOwnerOrAdmin(request.role)) return ALLOWED;
      return context.participantActorIds.includes(request.actorId)
        ? ALLOWED
        : deny('member_requires_participation');
    }
    default:
      return deny('role_forbidden');
  }
}

export function requireDesktopRoleAction<Action extends DesktopRoleAction>(
  identity: IdentityContext,
  action: Action,
  context: DesktopRoleActionContext[Action],
): void {
  const decision = evaluateDesktopRolePolicy({
    role: identity.membership.role,
    actorId: identity.account.id,
    actorTenantId: identity.tenant.id,
    targetTenantId: identity.tenant.id,
    action,
    context,
  });
  if (!decision.allowed) throw new Error(`Tenant role policy denied ${action}: ${decision.reason}`);
}

function isOwnerOrAdmin(role: MembershipRole): boolean {
  return role === 'owner' || role === 'admin';
}
