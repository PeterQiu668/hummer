import { Type, type Static } from '@sinclair/typebox';
import { CapabilityInstallGateDecisionSchema, TeamReadOnlyShareSchema } from '../capability/schemas.ts';

export const TRUSTED_BUNDLE_FILES = [
  'SKILL.md',
  'work.md',
  'behavior.md',
  'work_skill.md',
  'behavior_skill.md',
  'manifest.json',
  'meta.json',
  'receipt.json',
] as const;

export const TRUSTED_BUNDLE_MAX_FILE_BYTES = 65_536;
export const TRUSTED_BUNDLE_MAX_TOTAL_BYTES = 262_144;

const Identifier = Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' });
const Sha256 = Type.String({ pattern: '^[a-f0-9]{64}$' });
const IsoUtc = Type.String({
  pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?Z$',
  maxLength: 24,
});
const FileName = Type.Union(TRUSTED_BUNDLE_FILES.map((name) => Type.Literal(name)));

export const TrustedBundleFileDescriptorSchema = Type.Object({
  path: FileName,
  bytes: Type.Integer({ minimum: 1, maximum: TRUSTED_BUNDLE_MAX_FILE_BYTES }),
  sha256: Sha256,
}, { additionalProperties: false });

export const TrustedBundleDescriptorSchema = Type.Object({
  format: Type.Literal('agent-skills'),
  fileCount: Type.Literal(8),
  totalBytes: Type.Integer({ minimum: 8, maximum: TRUSTED_BUNDLE_MAX_TOTAL_BYTES }),
  files: Type.Array(TrustedBundleFileDescriptorSchema, { minItems: 8, maxItems: 8 }),
}, { additionalProperties: false });

export const TrustedBundleFileBytesSchema = Type.Object({
  path: FileName,
  contentBase64: Type.String({ minLength: 4, maxLength: 100_000, pattern: '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$' }),
}, { additionalProperties: false });

export const TrustedBundleEnvelopeV1Schema = Type.Object({
  schema: Type.Literal('hummer.trusted-capability-bundle'),
  version: Type.Literal(1),
  bundleId: Identifier,
  tenantId: Identifier,
  targetNodeId: Identifier,
  shareId: Identifier,
  gateId: Identifier,
  requestDigest: Sha256,
  shareDigest: Sha256,
  packageId: Identifier,
  packageVersion: Type.Integer({ minimum: 1, maximum: 1_000_000 }),
  packageDigest: Sha256,
  bundleRootHash: Sha256,
  envelopeDigest: Sha256,
  share: TeamReadOnlyShareSchema,
  decision: CapabilityInstallGateDecisionSchema,
  descriptor: TrustedBundleDescriptorSchema,
  files: Type.Array(TrustedBundleFileBytesSchema, { minItems: 8, maxItems: 8 }),
}, { $id: 'hummer.trusted-capability-bundle.v1', additionalProperties: false });

export const TrustedBundleHumanApprovalV1Schema = Type.Object({
  schema: Type.Literal('hummer.trusted-bundle-human-approval'),
  version: Type.Literal(1),
  approvalId: Identifier,
  tenantId: Identifier,
  nodeId: Identifier,
  bundleId: Identifier,
  gateId: Identifier,
  bundleRootHash: Sha256,
  actorRef: Type.String({ pattern: '^(?:human|account):[A-Za-z0-9_-]+$', maxLength: 160 }),
  decision: Type.Literal('approved'),
  decidedAt: IsoUtc,
}, { $id: 'hummer.trusted-bundle-human-approval.v1', additionalProperties: false });

export const TrustedBundleContractSchemas = {
  TrustedBundleEnvelopeV1: TrustedBundleEnvelopeV1Schema,
  TrustedBundleHumanApprovalV1: TrustedBundleHumanApprovalV1Schema,
} as const;

export type TrustedBundleFileName = (typeof TRUSTED_BUNDLE_FILES)[number];
export type TrustedBundleFileDescriptor = Static<typeof TrustedBundleFileDescriptorSchema>;
export type TrustedBundleDescriptor = Static<typeof TrustedBundleDescriptorSchema>;
export type TrustedBundleFileBytes = Static<typeof TrustedBundleFileBytesSchema>;
export type TrustedBundleEnvelopeV1 = Static<typeof TrustedBundleEnvelopeV1Schema>;
export type TrustedBundleHumanApprovalV1 = Static<typeof TrustedBundleHumanApprovalV1Schema>;
export type TrustedBundleContractName = keyof typeof TrustedBundleContractSchemas;
