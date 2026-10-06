import type { StandardSchemaV1 } from '@standard-schema/spec';
import { Value } from '@sinclair/typebox/value';
import {
  TenantRolePolicyRequestSchema,
  type TenantRolePolicyRequest,
} from './schemas.ts';

export type TenantRolePolicyReason =
  | 'allowed_by_role_policy'
  | 'invalid_request'
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

export interface TenantRolePolicyDecision {
  allowed: boolean;
  reason: TenantRolePolicyReason;
}

const ALLOWED: TenantRolePolicyDecision = {
  allowed: true,
  reason: 'allowed_by_role_policy',
};

function deny(reason: Exclude<TenantRolePolicyReason, 'allowed_by_role_policy'>): TenantRolePolicyDecision {
  return { allowed: false, reason };
}

export function evaluateTenantRolePolicy(input: unknown): TenantRolePolicyDecision {
  if (!Value.Check(TenantRolePolicyRequestSchema, input)) {
    return deny('invalid_request');
  }

  const request = input as TenantRolePolicyRequest;
  if (request.actorTenantId !== request.targetTenantId) {
    return deny('cross_tenant_forbidden');
  }

  switch (request.action) {
    case 'manage_members':
    case 'change_policy':
      return isOwnerOrAdmin(request.role) ? ALLOWED : deny('role_forbidden');

    case 'create_task':
      return request.role === 'auditor' ? deny('role_forbidden') : ALLOWED;

    case 'approve_high_risk':
      if (isOwnerOrAdmin(request.role)) return ALLOWED;
      if (request.role === 'member') {
        return request.context.riskLevel === 'low' && request.context.initiatedByActorId === request.actorId
          ? ALLOWED
          : deny('member_requires_self_low_risk');
      }
      if (request.role === 'operator') {
        return request.context.approvalScope === 'egress' || request.context.approvalScope === 'write'
          ? ALLOWED
          : deny('operator_requires_egress_or_write');
      }
      return deny('role_forbidden');

    case 'read_receipt_audit':
      if (isOwnerOrAdmin(request.role) || request.role === 'auditor') return ALLOWED;
      if (request.role === 'member') {
        return request.context.participantActorIds.includes(request.actorId)
          ? ALLOWED
          : deny('member_requires_participation');
      }
      if (request.role === 'operator') {
        return request.context.nodeRelated
          ? ALLOWED
          : deny('operator_requires_node_related_read');
      }
      return deny('role_forbidden');

    case 'export_capability':
      if (isOwnerOrAdmin(request.role)) return ALLOWED;
      if (request.role === 'member') {
        return request.context.capabilityOwnerActorId === request.actorId
          ? ALLOWED
          : deny('member_requires_own_capability');
      }
      if (request.role === 'auditor') {
        return request.context.mode === 'read_only' ? ALLOWED : deny('role_forbidden');
      }
      return deny('role_forbidden');

    case 'start_recording':
      if (isOwnerOrAdmin(request.role)) return ALLOWED;
      if (request.role === 'member') {
        return request.context.recordingSubjectActorId === request.actorId
          ? ALLOWED
          : deny('member_requires_self_recording');
      }
      return deny('role_forbidden');

    case 'destroy_tenant':
      return request.role === 'owner'
        && request.context.l3Approved
        && request.context.verifiedExportAvailable
        ? ALLOWED
        : deny(request.role === 'owner' ? 'owner_requires_l3_and_verified_export' : 'role_forbidden');

    case 'accept_result':
      if (request.role === 'auditor' || request.role === 'operator') {
        return deny('final_acceptance_role_forbidden');
      }
      if (isOwnerOrAdmin(request.role)) return ALLOWED;
      if (request.role === 'member') {
        return request.context.participantActorIds.includes(request.actorId)
          ? ALLOWED
          : deny('member_requires_participation');
      }
      return deny('role_forbidden');
  }
}

function isOwnerOrAdmin(role: TenantRolePolicyRequest['role']): boolean {
  return role === 'owner' || role === 'admin';
}

export const TenantRolePolicyRequestStandardSchema: StandardSchemaV1<unknown, TenantRolePolicyRequest> & {
  readonly jsonSchema: typeof TenantRolePolicyRequestSchema;
} = {
  jsonSchema: TenantRolePolicyRequestSchema,
  '~standard': {
    version: 1,
    vendor: 'hummer-typebox',
    validate(value) {
      return Value.Check(TenantRolePolicyRequestSchema, value)
        ? { value: value as TenantRolePolicyRequest }
        : { issues: [{ message: 'invalid tenant role policy request' }] };
    },
  },
};
