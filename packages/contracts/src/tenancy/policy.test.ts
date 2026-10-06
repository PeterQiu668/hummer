import { describe, expect, it } from 'vitest';
import {
  evaluateTenantRolePolicy,
  TenantRolePolicyRequestStandardSchema,
  type TenantAction,
  type TenantRole,
  type TenantRolePolicyRequest,
} from '../index.ts';

const roles = ['owner', 'admin', 'member', 'auditor', 'operator'] as const satisfies readonly TenantRole[];
const actions = [
  'manage_members',
  'change_policy',
  'approve_high_risk',
  'create_task',
  'read_receipt_audit',
  'export_capability',
  'start_recording',
  'destroy_tenant',
  'accept_result',
] as const satisfies readonly TenantAction[];

const expectedMatrix = {
  owner: {
    manage_members: true,
    change_policy: true,
    approve_high_risk: true,
    create_task: true,
    read_receipt_audit: true,
    export_capability: true,
    start_recording: true,
    destroy_tenant: true,
    accept_result: true,
  },
  admin: {
    manage_members: true,
    change_policy: true,
    approve_high_risk: true,
    create_task: true,
    read_receipt_audit: true,
    export_capability: true,
    start_recording: true,
    destroy_tenant: false,
    accept_result: true,
  },
  member: {
    manage_members: false,
    change_policy: false,
    approve_high_risk: false,
    create_task: true,
    read_receipt_audit: true,
    export_capability: true,
    start_recording: true,
    destroy_tenant: false,
    accept_result: true,
  },
  auditor: {
    manage_members: false,
    change_policy: false,
    approve_high_risk: false,
    create_task: false,
    read_receipt_audit: true,
    export_capability: true,
    start_recording: false,
    destroy_tenant: false,
    accept_result: false,
  },
  operator: {
    manage_members: false,
    change_policy: false,
    approve_high_risk: true,
    create_task: true,
    read_receipt_audit: true,
    export_capability: false,
    start_recording: false,
    destroy_tenant: false,
    accept_result: false,
  },
} as const satisfies Record<TenantRole, Record<TenantAction, boolean>>;

describe('[TEN-ROLE-POLICY-MATRIX] unified tenant role policy', () => {
  const matrixCases = roles.flatMap((role) => actions.map((action) => ({ role, action })));

  it.each(matrixCases)('$role × $action', ({ role, action }) => {
    const decision = evaluateTenantRolePolicy(baseRequest(role, action));
    expect(decision.allowed).toBe(expectedMatrix[role][action]);
  });

  it('allows a member to approve only a low-risk action they initiated', () => {
    expect(evaluateTenantRolePolicy({
      ...common('member', 'approve_high_risk'),
      context: { riskLevel: 'low', initiatedByActorId: 'actor-1', approvalScope: 'other' },
    })).toEqual({ allowed: true, reason: 'allowed_by_role_policy' });

    for (const context of [
      { riskLevel: 'low', initiatedByActorId: 'actor-2', approvalScope: 'other' },
      { riskLevel: 'medium', initiatedByActorId: 'actor-1', approvalScope: 'other' },
      { riskLevel: 'high', initiatedByActorId: 'actor-1', approvalScope: 'egress' },
    ]) {
      expect(evaluateTenantRolePolicy({
        ...common('member', 'approve_high_risk'),
        context,
      })).toEqual({ allowed: false, reason: 'member_requires_self_low_risk' });
    }
  });

  it('limits a member to participated reads, owned capabilities, self recordings and participated acceptance', () => {
    const cases = [
      {
        request: { ...common('member', 'read_receipt_audit'), context: { participantActorIds: [], nodeRelated: true } },
        reason: 'member_requires_participation',
      },
      {
        request: { ...common('member', 'export_capability'), context: { capabilityOwnerActorId: 'actor-2', mode: 'read_only' } },
        reason: 'member_requires_own_capability',
      },
      {
        request: { ...common('member', 'start_recording'), context: { recordingSubjectActorId: 'actor-2' } },
        reason: 'member_requires_self_recording',
      },
      {
        request: { ...common('member', 'accept_result'), context: { initiatedByActorId: 'actor-2', participantActorIds: [] } },
        reason: 'member_requires_participation',
      },
    ] as const;

    for (const { request, reason } of cases) {
      expect(evaluateTenantRolePolicy(request)).toEqual({ allowed: false, reason });
    }
  });

  it('limits an operator to egress/write approvals and node-related reads', () => {
    expect(evaluateTenantRolePolicy({
      ...common('operator', 'approve_high_risk'),
      context: { riskLevel: 'high', initiatedByActorId: 'actor-2', approvalScope: 'other' },
    })).toEqual({ allowed: false, reason: 'operator_requires_egress_or_write' });

    expect(evaluateTenantRolePolicy({
      ...common('operator', 'read_receipt_audit'),
      context: { participantActorIds: ['actor-1'], nodeRelated: false },
    })).toEqual({ allowed: false, reason: 'operator_requires_node_related_read' });
  });

  it('allows auditor capability export only in read-only mode', () => {
    expect(evaluateTenantRolePolicy({
      ...common('auditor', 'export_capability'),
      context: { capabilityOwnerActorId: 'actor-2', mode: 'share' },
    })).toEqual({ allowed: false, reason: 'role_forbidden' });
  });

  it('requires owner, L3 approval and a verified export before tenant destruction', () => {
    for (const role of roles.filter((role) => role !== 'owner')) {
      expect(evaluateTenantRolePolicy({
        ...common(role, 'destroy_tenant'),
        context: { l3Approved: true, verifiedExportAvailable: true },
      }).allowed).toBe(false);
    }

    for (const context of [
      { l3Approved: false, verifiedExportAvailable: true },
      { l3Approved: true, verifiedExportAvailable: false },
      { l3Approved: false, verifiedExportAvailable: false },
    ]) {
      expect(evaluateTenantRolePolicy({
        ...common('owner', 'destroy_tenant'),
        context,
      })).toEqual({ allowed: false, reason: 'owner_requires_l3_and_verified_export' });
    }
  });

  it('never permits auditor or operator to perform final result acceptance', () => {
    for (const role of ['auditor', 'operator'] as const) {
      expect(evaluateTenantRolePolicy({
        ...common(role, 'accept_result'),
        context: { initiatedByActorId: 'actor-1', participantActorIds: ['actor-1'] },
      })).toEqual({ allowed: false, reason: 'final_acceptance_role_forbidden' });
    }
  });

  it('[TEN-W4-WRITE-POLICY] denies cross-tenant requests before applying role permissions', () => {
    expect(evaluateTenantRolePolicy({
      ...common('owner', 'manage_members'),
      targetTenantId: 'tenant-b',
      context: {},
    })).toEqual({ allowed: false, reason: 'cross_tenant_forbidden' });
  });

  it('fails closed for unknown roles, actions, fields, contexts and malformed values', async () => {
    const valid = baseRequest('owner', 'manage_members');
    const invalid = [
      { ...valid, role: 'superadmin' },
      { ...valid, action: 'read_everything' },
      { ...valid, unexpected: true },
      { ...valid, context: { unexpected: true } },
      { ...valid, context: undefined },
      null,
      'owner',
    ];

    for (const input of invalid) {
      expect(() => evaluateTenantRolePolicy(input)).not.toThrow();
      expect(evaluateTenantRolePolicy(input)).toEqual({ allowed: false, reason: 'invalid_request' });
      expect(await TenantRolePolicyRequestStandardSchema['~standard'].validate(input)).toHaveProperty('issues');
    }
  });
});

function common<Role extends TenantRole, Action extends TenantAction>(role: Role, action: Action) {
  return {
    role,
    actorId: 'actor-1',
    actorTenantId: 'tenant-a',
    targetTenantId: 'tenant-a',
    action,
  } as const;
}

function baseRequest(role: TenantRole, action: TenantAction): TenantRolePolicyRequest {
  switch (action) {
    case 'manage_members':
    case 'change_policy':
    case 'create_task':
      return { ...common(role, action), context: {} };
    case 'approve_high_risk':
      return {
        ...common(role, action),
        context: { riskLevel: 'high', initiatedByActorId: 'actor-1', approvalScope: 'egress' },
      };
    case 'read_receipt_audit':
      return {
        ...common(role, action),
        context: { participantActorIds: ['actor-1'], nodeRelated: true },
      };
    case 'export_capability':
      return {
        ...common(role, action),
        context: { capabilityOwnerActorId: 'actor-1', mode: 'read_only' },
      };
    case 'start_recording':
      return { ...common(role, action), context: { recordingSubjectActorId: 'actor-1' } };
    case 'destroy_tenant':
      return {
        ...common(role, action),
        context: { l3Approved: true, verifiedExportAvailable: true },
      };
    case 'accept_result':
      return {
        ...common(role, action),
        context: { initiatedByActorId: 'actor-1', participantActorIds: ['actor-1'] },
      };
  }
}
