import { beforeAll, describe, expect, it } from 'vitest';
import {
  evaluateDesktopRolePolicy,
  type DesktopRoleAction,
  type DesktopRolePolicyRequest,
} from './desktop-role-policy.js';

let evaluateTenantRolePolicy: (request: unknown) => { allowed: boolean; reason: string };

beforeAll(async () => {
  // Keep the canonical policy out of the Electron TypeScript graph: it is test-only parity evidence.
  const contractModulePath = '../../../packages/contracts/src/index.ts';
  const contracts = await import(contractModulePath) as {
    evaluateTenantRolePolicy(request: unknown): { allowed: boolean; reason: string };
  };
  evaluateTenantRolePolicy = contracts.evaluateTenantRolePolicy;
});

const roles = ['owner', 'admin', 'member', 'auditor', 'operator'] as const satisfies readonly DesktopRolePolicyRequest['role'][];
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
] as const satisfies readonly DesktopRoleAction[];

describe('[TEN-ROLE-DESKTOP-PARITY] Desktop role adapter', () => {
  it.each(roles.flatMap((role) => actions.map((action) => ({ role, action }))))(
    'matches contracts for $role × $action',
    ({ role, action }) => expectParity(baseRequest(role, action)),
  );

  it('matches every contextual deny and cross-tenant decision used by Desktop', () => {
    const cases: DesktopRolePolicyRequest[] = [
      { ...common('member', 'approve_high_risk'), context: { riskLevel: 'low', initiatedByActorId: 'other', approvalScope: 'write' } },
      { ...common('member', 'approve_high_risk'), context: { riskLevel: 'high', initiatedByActorId: 'actor-1', approvalScope: 'write' } },
      { ...common('operator', 'approve_high_risk'), context: { riskLevel: 'high', initiatedByActorId: 'other', approvalScope: 'other' } },
      { ...common('member', 'read_receipt_audit'), context: { participantActorIds: [], nodeRelated: true } },
      { ...common('operator', 'read_receipt_audit'), context: { participantActorIds: ['actor-1'], nodeRelated: false } },
      { ...common('member', 'export_capability'), context: { capabilityOwnerActorId: 'other', mode: 'read_only' } },
      { ...common('auditor', 'export_capability'), context: { capabilityOwnerActorId: 'other', mode: 'share' } },
      { ...common('member', 'start_recording'), context: { recordingSubjectActorId: 'other' } },
      { ...common('owner', 'destroy_tenant'), context: { l3Approved: false, verifiedExportAvailable: true } },
      { ...common('auditor', 'accept_result'), context: { initiatedByActorId: 'actor-1', participantActorIds: ['actor-1'] } },
      { ...common('operator', 'accept_result'), context: { initiatedByActorId: 'actor-1', participantActorIds: ['actor-1'] } },
      { ...common('owner', 'manage_members'), targetTenantId: 'tenant-b', context: {} },
    ];
    cases.forEach(expectParity);
  });
});

function expectParity(request: DesktopRolePolicyRequest): void {
  expect(evaluateDesktopRolePolicy(request))
    .toEqual(evaluateTenantRolePolicy(request));
}

function common<Role extends DesktopRolePolicyRequest['role'], Action extends DesktopRoleAction>(role: Role, action: Action) {
  return {
    role,
    actorId: 'actor-1',
    actorTenantId: 'tenant-a',
    targetTenantId: 'tenant-a',
    action,
  } as const;
}

function baseRequest(role: DesktopRolePolicyRequest['role'], action: DesktopRoleAction): DesktopRolePolicyRequest {
  switch (action) {
    case 'manage_members':
    case 'change_policy':
    case 'create_task':
      return { ...common(role, action), context: {} };
    case 'approve_high_risk':
      return { ...common(role, action), context: { riskLevel: 'high', initiatedByActorId: 'actor-1', approvalScope: 'egress' } };
    case 'read_receipt_audit':
      return { ...common(role, action), context: { participantActorIds: ['actor-1'], nodeRelated: true } };
    case 'export_capability':
      return { ...common(role, action), context: { capabilityOwnerActorId: 'actor-1', mode: 'read_only' } };
    case 'start_recording':
      return { ...common(role, action), context: { recordingSubjectActorId: 'actor-1' } };
    case 'destroy_tenant':
      return { ...common(role, action), context: { l3Approved: true, verifiedExportAvailable: true } };
    case 'accept_result':
      return { ...common(role, action), context: { initiatedByActorId: 'actor-1', participantActorIds: ['actor-1'] } };
  }
}
