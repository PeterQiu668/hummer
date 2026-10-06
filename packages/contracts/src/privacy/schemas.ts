import { Type, type Static } from '@sinclair/typebox';

const Identifier = Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' });
const HumanActorRef = Type.String({ pattern: '^human:[A-Za-z0-9_-]+$', maxLength: 160 });
const ShortText = Type.String({ minLength: 1, maxLength: 512 });
const IsoUtc = Type.String({
  pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?Z$',
  maxLength: 24,
});
const Sha256 = Type.String({ pattern: '^[a-f0-9]{64}$' });
const StringList = (maxItems: number, minItems = 0) => Type.Array(ShortText, {
  minItems,
  maxItems,
  uniqueItems: true,
});

export const DemoSourceBoundarySchema = Type.Object(
  {
    apps: StringList(128, 1),
    windows: StringList(128, 1),
    excluded: StringList(256),
  },
  { additionalProperties: false },
);

export const DemoSessionSegmentSchema = Type.Object(
  {
    segId: Identifier,
    sequence: Type.Integer({ minimum: 1, maximum: 1_000_000 }),
    from: IsoUtc,
    to: Type.Optional(IsoUtc),
    deletedAt: Type.Optional(IsoUtc),
    recordCount: Type.Integer({ minimum: 0, maximum: 1_000_000 }),
    previousDigest: Type.Union([Sha256, Type.Null()]),
    digest: Sha256,
  },
  { additionalProperties: false },
);

export const DemoDeletionAuditEntrySchema = Type.Object(
  {
    segId: Identifier,
    requestedAt: IsoUtc,
    by: HumanActorRef,
    purgedAt: IsoUtc,
    previousDigest: Sha256,
    replacementDigest: Sha256,
  },
  { additionalProperties: false },
);

export const DemoSessionV1Schema = Type.Object(
  {
    schema: Type.Literal('hummer.demo-session'),
    version: Type.Literal(1),
    sessionId: Identifier,
    tenantId: Identifier,
    expertActorRef: HumanActorRef,
    nodeId: Identifier,
    sourceBoundary: DemoSourceBoundarySchema,
    startedAt: IsoUtc,
    endedAt: Type.Optional(IsoUtc),
    pausedCount: Type.Integer({ minimum: 0, maximum: 1_000_000 }),
    segments: Type.Array(DemoSessionSegmentSchema, { minItems: 1, maxItems: 10_000 }),
    captureMode: Type.Union([Type.Literal('ax-tree+keyframes'), Type.Literal('events-only')]),
    status: Type.Union([Type.Literal('capturing'), Type.Literal('paused'), Type.Literal('ended')]),
    localOnly: Type.Literal(true),
    redactionApplied: Type.Boolean(),
    redactionPolicyRef: Type.Optional(Identifier),
    evidenceRefs: Type.Array(Identifier, { maxItems: 512, uniqueItems: true }),
    chainHead: Sha256,
    deletionAudit: Type.Array(DemoDeletionAuditEntrySchema, { maxItems: 10_000 }),
  },
  { $id: 'hummer.demo-session.v1', additionalProperties: false },
);

export const PrivacyContractSchemas = {
  DemoSessionV1: DemoSessionV1Schema,
} as const;

export type DemoSourceBoundary = Static<typeof DemoSourceBoundarySchema>;
export type DemoSessionSegment = Static<typeof DemoSessionSegmentSchema>;
export type DemoDeletionAuditEntry = Static<typeof DemoDeletionAuditEntrySchema>;
export type DemoSessionV1 = Static<typeof DemoSessionV1Schema>;
export type PrivacyContractName = keyof typeof PrivacyContractSchemas;
