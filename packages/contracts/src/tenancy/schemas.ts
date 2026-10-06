import { Type, type Static, type TSchema } from '@sinclair/typebox';

const Identifier = Type.String({ minLength: 1, maxLength: 128 });
const ActorIds = Type.Array(Identifier, { maxItems: 256, uniqueItems: true });
const EmptyContext = Type.Object({}, { additionalProperties: false });

export const TenantRoleSchema = Type.Union([
  Type.Literal('owner'),
  Type.Literal('admin'),
  Type.Literal('member'),
  Type.Literal('auditor'),
  Type.Literal('operator'),
]);

export const TenantActionSchema = Type.Union([
  Type.Literal('manage_members'),
  Type.Literal('change_policy'),
  Type.Literal('approve_high_risk'),
  Type.Literal('create_task'),
  Type.Literal('read_receipt_audit'),
  Type.Literal('export_capability'),
  Type.Literal('start_recording'),
  Type.Literal('destroy_tenant'),
  Type.Literal('accept_result'),
]);

const ApprovalContextSchema = Type.Object(
  {
    riskLevel: Type.Union([Type.Literal('low'), Type.Literal('medium'), Type.Literal('high')]),
    initiatedByActorId: Identifier,
    approvalScope: Type.Union([
      Type.Literal('egress'),
      Type.Literal('write'),
      Type.Literal('other'),
    ]),
  },
  { additionalProperties: false },
);

const ReceiptAuditContextSchema = Type.Object(
  {
    participantActorIds: ActorIds,
    nodeRelated: Type.Boolean(),
  },
  { additionalProperties: false },
);

const CapabilityExportContextSchema = Type.Object(
  {
    capabilityOwnerActorId: Identifier,
    mode: Type.Union([Type.Literal('read_only'), Type.Literal('share')]),
  },
  { additionalProperties: false },
);

const RecordingContextSchema = Type.Object(
  { recordingSubjectActorId: Identifier },
  { additionalProperties: false },
);

const DestroyTenantContextSchema = Type.Object(
  {
    l3Approved: Type.Boolean(),
    verifiedExportAvailable: Type.Boolean(),
  },
  { additionalProperties: false },
);

const ResultAcceptanceContextSchema = Type.Object(
  {
    initiatedByActorId: Identifier,
    participantActorIds: ActorIds,
  },
  { additionalProperties: false },
);

function requestVariant<Action extends string, Context extends TSchema>(
  action: Action,
  context: Context,
) {
  return Type.Object(
    {
      role: TenantRoleSchema,
      actorId: Identifier,
      actorTenantId: Identifier,
      targetTenantId: Identifier,
      action: Type.Literal(action),
      context,
    },
    { additionalProperties: false },
  );
}

export const TenantRolePolicyRequestSchema = Type.Union(
  [
    requestVariant('manage_members', EmptyContext),
    requestVariant('change_policy', EmptyContext),
    requestVariant('approve_high_risk', ApprovalContextSchema),
    requestVariant('create_task', EmptyContext),
    requestVariant('read_receipt_audit', ReceiptAuditContextSchema),
    requestVariant('export_capability', CapabilityExportContextSchema),
    requestVariant('start_recording', RecordingContextSchema),
    requestVariant('destroy_tenant', DestroyTenantContextSchema),
    requestVariant('accept_result', ResultAcceptanceContextSchema),
  ],
  { $id: 'hummer.tenant-role-policy-request.v1' },
);

export type TenantRole = Static<typeof TenantRoleSchema>;
export type TenantAction = Static<typeof TenantActionSchema>;
export type TenantRolePolicyRequest = Static<typeof TenantRolePolicyRequestSchema>;
