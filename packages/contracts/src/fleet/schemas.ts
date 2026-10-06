import { Type, type Static, type TSchema } from '@sinclair/typebox';

export const FLEET_CONTRACT_MAX_BYTES = 64 * 1024;

const Identifier = Type.String({ minLength: 1, maxLength: 128 });
const ShortText = Type.String({ minLength: 1, maxLength: 512 });
const LongText = Type.String({ minLength: 1, maxLength: 32_768 });
const IsoUtc = Type.String({
  pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?Z$',
  maxLength: 24,
});
const Sha256 = Type.String({ pattern: '^[a-f0-9]{64}$' });
const RelativePath = Type.String({
  minLength: 1,
  maxLength: 1024,
  pattern: '^(?![A-Za-z]:)(?!/)(?!.*(?:^|/)\\.\\.(?:/|$))(?!.*\\\\).+$',
});

export const RuntimeKindSchema = Type.Union([
  Type.Literal('codex'),
  Type.Literal('claude'),
  Type.Literal('deepseek'),
  Type.Literal('cli-other'),
  Type.Literal('gui-exec'),
]);

export const ActorRefSchema = Type.String({
  pattern: '^(human|twin|employee|system|expert|account):[A-Za-z0-9_-]+$',
  maxLength: 160,
});

export const RuntimeProbeSchema = Type.Object(
  {
    kind: RuntimeKindSchema,
    available: Type.Boolean(),
    pinnedVersion: Type.String({ minLength: 1, maxLength: 128 }),
    probeError: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
  },
  { additionalProperties: false },
);

export const NodeManifestSchema = Type.Object(
  {
    schema: Type.Literal('hummer.node-manifest'),
    version: Type.Literal(1),
    nodeId: Identifier,
    tenantIds: Type.Array(Identifier, { minItems: 1, maxItems: 32, uniqueItems: true }),
    platform: Type.Union([Type.Literal('win32'), Type.Literal('darwin'), Type.Literal('linux')]),
    agentVersion: Type.String({
      pattern: '^(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?$',
      maxLength: 128,
    }),
    runtimes: Type.Array(RuntimeProbeSchema, { minItems: 1, maxItems: 16 }),
    capabilities: Type.Array(Identifier, { maxItems: 128, uniqueItems: true }),
    mcp: Type.Object(
      {
        endpoint: Type.String({ minLength: 1, maxLength: 2048 }),
        tools: Type.Array(Identifier, { maxItems: 128, uniqueItems: true }),
      },
      { additionalProperties: false },
    ),
    load: Type.Object(
      {
        running: Type.Integer({ minimum: 0, maximum: 10_000 }),
        queued: Type.Integer({ minimum: 0, maximum: 100_000 }),
        cpuPct: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })),
      },
      { additionalProperties: false },
    ),
    untrustedNotes: Type.Optional(Type.String({ maxLength: 2048 })),
  },
  { $id: 'hummer.node-manifest.v1', additionalProperties: false },
);

export const WorkOrderTaskSchema = Type.Object(
  {
    schema: Type.Literal('hummer.work-order-task'),
    version: Type.Literal(1),
    title: ShortText,
    target: LongText,
    expectedDeliverable: LongText,
    assignee: Type.Optional(ShortText),
    dueAt: Type.Optional(IsoUtc),
    attachmentNames: Type.Optional(
      Type.Array(RelativePath, { maxItems: 128, uniqueItems: true }),
    ),
    prompt: Type.Optional(Type.String({ maxLength: 32_768 })),
    origin: Type.Optional(
      Type.Object(
        {
          system: Type.Optional(ShortText),
          device: Type.Optional(ShortText),
          agent: Type.Optional(ShortText),
          taskId: Type.Optional(ShortText),
        },
        { additionalProperties: false, minProperties: 1 },
      ),
    ),
  },
  { additionalProperties: false },
);

export const TaskEnvelopeSchema = Type.Object(
  {
    schema: Type.Literal('hummer.task-envelope'),
    version: Type.Literal(1),
    workOrderTask: WorkOrderTaskSchema,
    tenantId: Identifier,
    targetNodeId: Identifier,
    targetRuntime: RuntimeKindSchema,
    idempotencyKey: Type.String({ minLength: 8, maxLength: 128 }),
    leaseMs: Type.Integer({ minimum: 1_000, maximum: 86_400_000 }),
    approvalPolicyRef: Identifier,
    grantRef: Type.Optional(Identifier),
    expiresAt: IsoUtc,
    originRef: Identifier,
    capabilityRef: Type.Optional(Identifier),
  },
  { $id: 'hummer.task-envelope.v1', additionalProperties: false },
);

const RunEventCommonProperties = {
  schema: Type.Literal('hummer.run-event'),
  version: Type.Literal(1),
  eventId: Identifier,
  tenantId: Identifier,
  workOrderId: Identifier,
  nodeId: Identifier,
  seq: Type.Integer({ minimum: 1 }),
  occurredAt: IsoUtc,
  actorRef: ActorRefSchema,
  idempotencyKey: Type.String({ minLength: 8, maxLength: 128 }),
};

function runEventVariant<TypeName extends string, PayloadSchema extends TSchema>(
  type: TypeName,
  payload: PayloadSchema,
) {
  return Type.Object(
    { ...RunEventCommonProperties, type: Type.Literal(type), payload },
    { additionalProperties: false },
  );
}

const StartedRunEventSchema = runEventVariant(
  'started',
  Type.Object({ runId: Identifier }, { additionalProperties: false }),
);
const ProgressRunEventSchema = runEventVariant(
  'progress',
  Type.Object(
    { message: ShortText, percent: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })) },
    { additionalProperties: false },
  ),
);
const FailedRunEventSchema = runEventVariant(
  'failed',
  Type.Object(
    { code: Identifier, message: LongText, retryable: Type.Boolean() },
    { additionalProperties: false },
  ),
);
const CompletedRunEventSchema = runEventVariant(
  'completed',
  Type.Object({ summary: Type.Optional(Type.String({ maxLength: 32_768 })) }, { additionalProperties: false }),
);
const CancelledRunEventSchema = runEventVariant(
  'cancelled',
  Type.Object({ reason: LongText }, { additionalProperties: false }),
);

const ArtifactRunEventSchema = Type.Object(
  {
    ...RunEventCommonProperties,
    type: Type.Literal('artifact'),
    payload: Type.Object(
      {
        artifactId: Identifier,
        sha256: Sha256,
        bytes: Type.Integer({ minimum: 0, maximum: 1_073_741_824 }),
        relPath: RelativePath,
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

const NeedsApprovalRunEventSchema = Type.Object(
  {
    ...RunEventCommonProperties,
    type: Type.Literal('needs_approval'),
    payload: Type.Object(
      { requestId: Identifier },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const RunEventSchema = Type.Union(
  [
    StartedRunEventSchema,
    ProgressRunEventSchema,
    ArtifactRunEventSchema,
    NeedsApprovalRunEventSchema,
    FailedRunEventSchema,
    CompletedRunEventSchema,
    CancelledRunEventSchema,
  ],
  { $id: 'hummer.run-event.v1' },
);

export const RiskClassSchema = Type.Union([
  Type.Literal('egress'),
  Type.Literal('write'),
  Type.Literal('spend'),
  Type.Literal('delete'),
  Type.Literal('privilege'),
  Type.Literal('network'),
  Type.Literal('unknown'),
]);

const RequestedScopeSchema = Type.Object(
  {
    capabilities: Type.Array(Identifier, { minItems: 1, maxItems: 128, uniqueItems: true }),
    paths: Type.Optional(Type.Array(RelativePath, { maxItems: 128, uniqueItems: true })),
    maxUses: Type.Optional(Type.Integer({ minimum: 1, maximum: 10_000 })),
  },
  { additionalProperties: false },
);

export const ApprovalRequestSchema = Type.Object(
  {
    schema: Type.Literal('hummer.approval-request'),
    version: Type.Literal(1),
    requestId: Identifier,
    tenantId: Identifier,
    workOrderId: Identifier,
    nodeId: Identifier,
    runId: Identifier,
    riskClass: RiskClassSchema,
    action: ShortText,
    target: ShortText,
    redactedPreview: Type.String({ maxLength: 4096 }),
    requestedScope: RequestedScopeSchema,
    expiresAt: IsoUtc,
    requestedBy: Type.String({
      pattern: '^(system|employee|twin):[A-Za-z0-9_-]+$',
      maxLength: 160,
    }),
  },
  { $id: 'hummer.approval-request.v1', additionalProperties: false },
);

const ApprovalDecisionCommonProperties = {
  schema: Type.Literal('hummer.approval-decision'),
  version: Type.Literal(1),
  decisionId: Identifier,
  requestId: Identifier,
  tenantId: Identifier,
  deciderActorRef: Type.String({
    pattern: '^(human|account):[A-Za-z0-9_-]+$',
    maxLength: 160,
  }),
  decidedAt: IsoUtc,
  rationale: Type.Optional(Type.String({ maxLength: 4096 })),
  delegatedFrom: Type.Optional(ActorRefSchema),
};

const GrantedScopeSchema = Type.Object(
  {
    capabilities: Type.Array(Identifier, { minItems: 1, maxItems: 128, uniqueItems: true }),
    paths: Type.Optional(Type.Array(RelativePath, { maxItems: 128, uniqueItems: true })),
    expiresAt: IsoUtc,
    maxUses: Type.Optional(Type.Integer({ minimum: 1, maximum: 10_000 })),
  },
  { additionalProperties: false },
);

const ApprovedDecisionSchema = Type.Object(
  {
    ...ApprovalDecisionCommonProperties,
    decision: Type.Literal('approved'),
    grantedScope: Type.Optional(GrantedScopeSchema),
  },
  { additionalProperties: false },
);

const NonApprovedDecisionSchema = Type.Object(
  {
    ...ApprovalDecisionCommonProperties,
    decision: Type.Union([
      Type.Literal('denied'),
      Type.Literal('expired'),
      Type.Literal('revoked'),
    ]),
  },
  { additionalProperties: false },
);

export const ApprovalDecisionSchema = Type.Union(
  [ApprovedDecisionSchema, NonApprovedDecisionSchema],
  { $id: 'hummer.approval-decision.v1' },
);

export const CapabilityGrantSchema = Type.Object(
  {
    schema: Type.Literal('hummer.capability-grant'),
    version: Type.Literal(1),
    grantId: Identifier,
    tenantId: Identifier,
    workOrderId: Identifier,
    nodeId: Identifier,
    capabilities: Type.Array(Identifier, { minItems: 1, maxItems: 128, uniqueItems: true }),
    paths: Type.Array(RelativePath, { maxItems: 128, uniqueItems: true }),
    expiresAt: IsoUtc,
    maxUses: Type.Integer({ minimum: 1, maximum: 10_000 }),
    usedCount: Type.Integer({ minimum: 0, maximum: 10_000 }),
    revokedAt: Type.Optional(IsoUtc),
    issuedToRunId: Identifier,
  },
  { $id: 'hummer.capability-grant.v1', additionalProperties: false },
);

export const FleetContractSchemas = {
  NodeManifest: NodeManifestSchema,
  TaskEnvelope: TaskEnvelopeSchema,
  RunEvent: RunEventSchema,
  ApprovalRequest: ApprovalRequestSchema,
  ApprovalDecision: ApprovalDecisionSchema,
  CapabilityGrant: CapabilityGrantSchema,
} as const satisfies Record<string, TSchema>;

export type RuntimeKind = Static<typeof RuntimeKindSchema>;
export type RuntimeProbe = Static<typeof RuntimeProbeSchema>;
export type NodeManifest = Static<typeof NodeManifestSchema>;
export type WorkOrderTask = Static<typeof WorkOrderTaskSchema>;
export type TaskEnvelope = Static<typeof TaskEnvelopeSchema>;
export type RunEvent = Static<typeof RunEventSchema>;
export type RiskClass = Static<typeof RiskClassSchema>;
export type ApprovalRequest = Static<typeof ApprovalRequestSchema>;
export type ApprovalDecision = Static<typeof ApprovalDecisionSchema>;
export type CapabilityGrant = Static<typeof CapabilityGrantSchema>;
export type FleetContractName = keyof typeof FleetContractSchemas;

export const FleetContractNameBySchema = {
  'hummer.node-manifest': 'NodeManifest',
  'hummer.task-envelope': 'TaskEnvelope',
  'hummer.run-event': 'RunEvent',
  'hummer.approval-request': 'ApprovalRequest',
  'hummer.approval-decision': 'ApprovalDecision',
  'hummer.capability-grant': 'CapabilityGrant',
} as const satisfies Record<string, FleetContractName>;
