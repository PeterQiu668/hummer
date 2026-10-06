import { Type, type Static, type TSchema } from '@sinclair/typebox';

const Identifier = Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' });
const ShortText = Type.String({ minLength: 1, maxLength: 512 });
const LongText = Type.String({ minLength: 1, maxLength: 32_768 });
const ActorRef = Type.String({
  pattern: '^(human|twin|employee|system|expert|account):[A-Za-z0-9_-]+$',
  maxLength: 160,
});
const IsoUtc = Type.String({
  pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?Z$',
  maxLength: 24,
});
const Sha256 = Type.String({ pattern: '^[a-f0-9]{64}$' });
const WindowsReservedSegment = '(?!(?:[Cc][Oo][Nn]|[Pp][Rr][Nn]|[Aa][Uu][Xx]|[Nn][Uu][Ll]|[Cc][Oo][Mm][1-9]|[Ll][Pp][Tt][1-9])(?:\\.|$))';
const SafePathSegment = `${WindowsReservedSegment}(?=[^/]*[^ .](?:/|$))[^/\\\\<>:"|?*\\x00-\\x1F\\x7F]+`;
const NormalizedRelativePath = Type.String({
  minLength: 1,
  maxLength: 1024,
  pattern: `^(?![A-Za-z]:)(?!/)(?!.*//)(?!.*(?:^|/)\\.\\.?($|/))${SafePathSegment}(?:/${SafePathSegment})*$`,
});
const StringList = (maxItems: number, options: Record<string, unknown> = {}) =>
  Type.Array(ShortText, { maxItems, uniqueItems: true, ...options });

export const SourceBoundarySchema = Type.Object(
  {
    apps: StringList(128),
    windows: StringList(128),
    includePaths: Type.Array(NormalizedRelativePath, { maxItems: 256, uniqueItems: true }),
    excludePaths: Type.Array(NormalizedRelativePath, { maxItems: 256, uniqueItems: true }),
  },
  { additionalProperties: false },
);

export const CapabilityProvenanceSchema = Type.Object(
  {
    demoSessionIds: Type.Array(Identifier, { minItems: 1, maxItems: 128, uniqueItems: true }),
    expertActorRef: ActorRef,
    nodeId: Identifier,
    device: ShortText,
    runtime: ShortText,
    runtimeVersion: ShortText,
    agentVersion: ShortText,
    capturedAt: IsoUtc,
  },
  { additionalProperties: false },
);

export const TrialEnvironmentSchema = Type.Object(
  {
    nodeId: Identifier,
    os: ShortText,
    runtime: ShortText,
    runtimeVersion: ShortText,
    appVersions: Type.Record(Type.String({ minLength: 1, maxLength: 128 }), ShortText, {
      maxProperties: 128,
    }),
  },
  { additionalProperties: false },
);

export const TrialRecordSchema = Type.Object(
  {
    tenantId: Identifier,
    packageId: Identifier,
    packageVersion: Type.Integer({ minimum: 1, maximum: 1_000_000 }),
    packageDigest: Sha256,
    trialIds: Type.Array(Identifier, { minItems: 1, maxItems: 1_000_000, uniqueItems: true }),
    shadowRuns: Type.Integer({ minimum: 1, maximum: 1_000_000 }),
    success: Type.Integer({ minimum: 0, maximum: 1_000_000 }),
    failure: Type.Integer({ minimum: 0, maximum: 1_000_000 }),
    lastRunAt: IsoUtc,
    environments: Type.Array(TrialEnvironmentSchema, { minItems: 1, maxItems: 256 }),
    regressionPassed: Type.Boolean(),
    regressionEvidenceDigest: Sha256,
  },
  { additionalProperties: false },
);

export const DeclaredPermissionSchema = Type.Object(
  {
    capability: Identifier,
    access: Type.Union([
      Type.Literal('read'),
      Type.Literal('write'),
      Type.Literal('execute'),
      Type.Literal('egress'),
    ]),
    paths: Type.Array(NormalizedRelativePath, {
      maxItems: 256,
      uniqueItems: true,
    }),
  },
  { additionalProperties: false },
);

const CapabilityTrackSchema = Type.Object(
  {
    responsibilities: StringList(256),
    workflows: StringList(256),
    standards: StringList(256),
    heuristics: StringList(256),
    pitfalls: StringList(256),
    examples: StringList(256),
  },
  { additionalProperties: false },
);

const BehaviorTrackSchema = Type.Object(
  {
    expressionPreferences: StringList(256),
    interactionRules: StringList(256),
    corrections: Type.Array(
      Type.Object(
        { scene: ShortText, wrong: LongText, correct: LongText },
        { additionalProperties: false },
      ),
      { maxItems: 256 },
    ),
  },
  { additionalProperties: false },
);

const DeletionAuditSchema = Type.Object(
  {
    requestedAt: Type.Optional(IsoUtc),
    by: Type.Optional(ActorRef),
    purgedAt: Type.Optional(IsoUtc),
  },
  { additionalProperties: false },
);

const capabilityAuthorProperties = {
  schema: Type.Literal('hummer.capability-package-author-input'),
  version: Type.Literal(1),
  tenantId: Identifier,
  packageId: Identifier,
  packageVersion: Type.Integer({ minimum: 1, maximum: 1_000_000 }),
  supersedesVersion: Type.Optional(Type.Integer({ minimum: 1, maximum: 999_999 })),
  previousPackageDigest: Type.Optional(Sha256),
  title: ShortText,
  goal: LongText,
  preset: Type.Union([
    Type.Literal('expert-work'),
    Type.Literal('team-sop'),
    Type.Literal('public-figure'),
  ]),
  capabilityTrack: CapabilityTrackSchema,
  behaviorTrack: BehaviorTrackSchema,
  runtimeProfile: Identifier,
  toolIds: Type.Array(Identifier, { maxItems: 256, uniqueItems: true }),
  requiredCapabilities: Type.Array(Identifier, { maxItems: 256, uniqueItems: true }),
  acceptanceCriteria: Type.Array(LongText, { minItems: 1, maxItems: 256, uniqueItems: true }),
  sourceBoundary: SourceBoundarySchema,
  provenance: CapabilityProvenanceSchema,
  evidenceRefs: Type.Array(Identifier, { minItems: 1, maxItems: 512, uniqueItems: true }),
  failureNotes: Type.Array(LongText, { maxItems: 256 }),
  declaredPermissions: Type.Array(DeclaredPermissionSchema, { maxItems: 256 }),
  regressionSuiteRef: Identifier,
  receiptRef: Identifier,
  status: Type.Union([
    Type.Literal('draft'),
    Type.Literal('shadow'),
    Type.Literal('verified'),
    Type.Literal('private'),
    Type.Literal('team'),
  ]),
  deletionAudit: DeletionAuditSchema,
} satisfies Record<string, TSchema>;

/** Human-authored package data. Deliberately has no trialRecord field. */
export const CapabilityPackageAuthorInputSchema = Type.Object(capabilityAuthorProperties, {
  $id: 'hummer.capability-package-author-input.v1',
  additionalProperties: false,
});

/**
 * Trusted trial-service input. This is separate from author input so no authoring
 * surface can claim an aggregate trialRecord directly.
 */
export const SkillTrialSystemRecordInputSchema = Type.Object(
  {
    schema: Type.Literal('hummer.skill-trial-system-record-input'),
    version: Type.Literal(1),
    tenantId: Identifier,
    trialId: Identifier,
    packageId: Identifier,
    packageVersion: Type.Integer({ minimum: 1, maximum: 1_000_000 }),
    packageDigest: Sha256,
    recordedBy: Type.Literal('system:skill-trial'),
    mode: Type.Union([Type.Literal('shadow'), Type.Literal('live')]),
    ok: Type.Boolean(),
    failureStepRef: Type.Optional(Identifier),
    startedAt: IsoUtc,
    endedAt: IsoUtc,
    environment: TrialEnvironmentSchema,
    receiptRef: Type.Optional(Identifier),
    liveApprovalRef: Type.Optional(Identifier),
  },
  { $id: 'hummer.skill-trial-system-record-input.v1', additionalProperties: false },
);

const finalPackageProperties = {
  ...capabilityAuthorProperties,
  schema: Type.Literal('hummer.capability-package'),
  trialRecord: TrialRecordSchema,
  packageDigest: Sha256,
  status: Type.Union([
    Type.Literal('draft'),
    Type.Literal('shadow'),
    Type.Literal('verified'),
    Type.Literal('private'),
    Type.Literal('team'),
    Type.Literal('shared'),
    Type.Literal('retired'),
  ]),
} satisfies Record<string, TSchema>;

export const CapabilityPackageV1Schema = Type.Object(finalPackageProperties, {
  $id: 'hummer.capability-package.v1',
  additionalProperties: false,
});

export const CapabilityShareInvitationSchema = Type.Object(
  {
    invitationId: Identifier,
    sourceTenantId: Identifier,
    targetTenantId: Identifier,
    packageId: Identifier,
    packageVersion: Type.Integer({ minimum: 1, maximum: 1_000_000 }),
    packageDigest: Sha256,
    status: Type.Literal('accepted'),
    expiresAt: IsoUtc,
    evidenceDigest: Sha256,
  },
  { additionalProperties: false },
);

/** Read-only package handoff. It is not a mutable listing or ownership transfer. */
export const TeamReadOnlyShareSchema = Type.Object(
  {
    schema: Type.Literal('hummer.capability-team-share'),
    version: Type.Literal(1),
    shareId: Identifier,
    sourceTenantId: Identifier,
    targetTenantId: Identifier,
    packageId: Identifier,
    packageVersion: Type.Integer({ minimum: 1, maximum: 1_000_000 }),
    invitation: Type.Optional(CapabilityShareInvitationSchema),
    access: Type.Literal('read_only'),
    allowEdit: Type.Literal(false),
    allowCopyToTenant: Type.Literal(false),
    packageDigest: Sha256,
    shareDigest: Sha256,
    package: CapabilityPackageV1Schema,
    sharedByActorRef: ActorRef,
    sharedAt: IsoUtc,
  },
  { $id: 'hummer.capability-team-share.v1', additionalProperties: false },
);

const InstallGateFindingSchema = Type.Object(
  {
    code: Identifier,
    message: LongText,
  },
  { additionalProperties: false },
);

/** The complete Agent Skills export surface required by prompt section 6.9. */
export const AgentSkillsExportDescriptorSchema = Type.Object(
  {
    format: Type.Literal('agent-skills'),
    installEntry: Type.Literal('manifest.json'),
    fileDigests: Type.Object(
      {
        'SKILL.md': Sha256,
        'work.md': Sha256,
        'behavior.md': Sha256,
        'work_skill.md': Sha256,
        'behavior_skill.md': Sha256,
        'manifest.json': Sha256,
        'meta.json': Sha256,
        'receipt.json': Sha256,
      },
      { additionalProperties: false },
    ),
    containsRawRecording: Type.Literal(false),
    containsCredentials: Type.Literal(false),
    containsUnredactedCustomerData: Type.Literal(false),
  },
  { additionalProperties: false },
);

export const CapabilityInstallGateInputSchema = Type.Object(
  {
    schema: Type.Literal('hummer.capability-install-gate-input'),
    version: Type.Literal(1),
    gateId: Identifier,
    share: TeamReadOnlyShareSchema,
    recordedBy: Type.Literal('system:capability-install-gate'),
    requestDigest: Sha256,
    shareDigest: Sha256,
    exportDescriptor: AgentSkillsExportDescriptorSchema,
    targetTenantId: Identifier,
    requestedByActorRef: ActorRef,
    staticCheck: Type.Object(
      {
        status: Type.Union([Type.Literal('passed'), Type.Literal('failed')]),
        evidenceDigest: Sha256,
        findings: Type.Array(InstallGateFindingSchema, { maxItems: 256 }),
      },
      { additionalProperties: false },
    ),
    permissionReview: Type.Object(
      {
        approvedPermissions: Type.Array(DeclaredPermissionSchema, { maxItems: 256, uniqueItems: true }),
        deniedPermissions: Type.Array(DeclaredPermissionSchema, { maxItems: 256, uniqueItems: true }),
        evidenceDigest: Sha256,
      },
      { additionalProperties: false },
    ),
    sourceVerification: Type.Object(
      {
        provenance: Type.Object({ status: Type.Union([Type.Literal('passed'), Type.Literal('failed')]), evidenceDigest: Sha256 }, { additionalProperties: false }),
        receipt: Type.Object({ status: Type.Union([Type.Literal('passed'), Type.Literal('failed')]), evidenceDigest: Sha256 }, { additionalProperties: false }),
        packageDigest: Type.Object({ status: Type.Union([Type.Literal('passed'), Type.Literal('failed')]), evidenceDigest: Sha256 }, { additionalProperties: false }),
        invitation: Type.Optional(Type.Object({ status: Type.Union([Type.Literal('passed'), Type.Literal('failed')]), evidenceDigest: Sha256 }, { additionalProperties: false })),
        regression: Type.Object({ status: Type.Union([Type.Literal('passed'), Type.Literal('failed')]), evidenceDigest: Sha256 }, { additionalProperties: false }),
      },
      { additionalProperties: false },
    ),
    evaluatedAt: IsoUtc,
  },
  { $id: 'hummer.capability-install-gate-input.v1', additionalProperties: false },
);

export const CapabilityInstallGateDecisionSchema = Type.Object(
  {
    schema: Type.Literal('hummer.capability-install-gate-decision'),
    version: Type.Literal(1),
    gateId: Identifier,
    shareId: Identifier,
    targetTenantId: Identifier,
    decision: Type.Union([Type.Literal('approved'), Type.Literal('denied')]),
    reasons: Type.Array(Identifier, { minItems: 1, maxItems: 64, uniqueItems: true }),
    packageDigest: Sha256,
    shareDigest: Sha256,
    requestDigest: Sha256,
    decidedBy: Type.Literal('system:capability-install-gate'),
    evaluatedAt: IsoUtc,
  },
  { $id: 'hummer.capability-install-gate-decision.v1', additionalProperties: false },
);

export const CapabilityContractSchemas = {
  CapabilityPackageAuthorInput: CapabilityPackageAuthorInputSchema,
  SkillTrialSystemRecordInput: SkillTrialSystemRecordInputSchema,
  CapabilityPackageV1: CapabilityPackageV1Schema,
  TeamReadOnlyShare: TeamReadOnlyShareSchema,
  CapabilityInstallGateInput: CapabilityInstallGateInputSchema,
  CapabilityInstallGateDecision: CapabilityInstallGateDecisionSchema,
} as const satisfies Record<string, TSchema>;

export type CapabilityPackageAuthorInput = Static<typeof CapabilityPackageAuthorInputSchema>;
export type SkillTrialSystemRecordInput = Static<typeof SkillTrialSystemRecordInputSchema>;
export type CapabilityPackageV1 = Static<typeof CapabilityPackageV1Schema>;
export type TrialRecord = Static<typeof TrialRecordSchema>;
export type TeamReadOnlyShare = Static<typeof TeamReadOnlyShareSchema>;
export type CapabilityShareInvitation = Static<typeof CapabilityShareInvitationSchema>;
export type CapabilityInstallGateInput = Static<typeof CapabilityInstallGateInputSchema>;
export type CapabilityInstallGateDecision = Static<typeof CapabilityInstallGateDecisionSchema>;
export type CapabilityContractName = keyof typeof CapabilityContractSchemas;
