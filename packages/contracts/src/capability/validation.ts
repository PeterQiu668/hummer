import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Static, TSchema } from '@sinclair/typebox';
import {
  CapabilityContractSchemas,
  CapabilityInstallGateDecisionSchema,
  CapabilityInstallGateInputSchema,
  CapabilityPackageAuthorInputSchema,
  CapabilityPackageV1Schema,
  SkillTrialSystemRecordInputSchema,
  TeamReadOnlyShareSchema,
  type CapabilityContractName,
  type CapabilityInstallGateDecision,
  type CapabilityInstallGateInput,
  type CapabilityPackageAuthorInput,
  type CapabilityPackageV1,
  type SkillTrialSystemRecordInput,
  type TeamReadOnlyShare,
  type TrialRecord,
} from './schemas.ts';

type CapabilityValidationResult<T> =
  | { value: T; issues?: undefined }
  | { value?: undefined; issues: ReadonlyArray<StandardSchemaV1.Issue> };

const validators = Object.fromEntries(
  Object.entries(CapabilityContractSchemas).map(([name, schema]) => {
    const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: false });
    return [name, ajv.compile(schema)];
  }),
) as Record<CapabilityContractName, ValidateFunction>;

function pointerPath(pointer: string): PropertyKey[] | undefined {
  if (!pointer) return undefined;
  return pointer
    .slice(1)
    .split('/')
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'));
}

function issuesFrom(errors: ErrorObject[] | null | undefined): StandardSchemaV1.Issue[] {
  return (errors ?? []).map((error) => ({
    message: `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`,
    path: pointerPath(error.instancePath),
  }));
}

function issue(message: string, path?: PropertyKey[]): CapabilityValidationResult<never> {
  return { issues: [{ message, path }] };
}

function validateTrialSemantics(trial: SkillTrialSystemRecordInput): CapabilityValidationResult<SkillTrialSystemRecordInput> {
  if (trial.endedAt < trial.startedAt) {
    return issue('/endedAt must not precede /startedAt', ['endedAt']);
  }
  if (trial.mode === 'live' && !trial.liveApprovalRef) {
    return issue('/liveApprovalRef is required for a live trial', ['liveApprovalRef']);
  }
  if (!trial.ok && !trial.failureStepRef) {
    return issue('/failureStepRef is required for a failed trial', ['failureStepRef']);
  }
  if (trial.ok && trial.failureStepRef) {
    return issue('/failureStepRef is forbidden for a successful trial', ['failureStepRef']);
  }
  return { value: trial };
}

function validateDecisionSemantics(
  decision: CapabilityInstallGateDecision,
): CapabilityValidationResult<CapabilityInstallGateDecision> {
  const passed = decision.reasons.length === 1 && decision.reasons[0] === 'install_gate_passed';
  if ((decision.decision === 'approved') !== passed) {
    return issue('/decision and /reasons are inconsistent', ['decision']);
  }
  return { value: decision };
}

function validateVersionSemantics<T extends { packageVersion: number; supersedesVersion?: number }>(
  input: T,
): CapabilityValidationResult<T> {
  if (input.packageVersion === 1 && input.supersedesVersion !== undefined) {
    return issue('/supersedesVersion is forbidden for the first package version', ['supersedesVersion']);
  }
  if (input.packageVersion > 1 && input.supersedesVersion !== input.packageVersion - 1) {
    return issue('/supersedesVersion must identify the immediately preceding version', ['supersedesVersion']);
  }
  return { value: input };
}

function validatePackageSemantics(pkg: CapabilityPackageV1): CapabilityValidationResult<CapabilityPackageV1> {
  if (pkg.trialRecord.success + pkg.trialRecord.failure !== pkg.trialRecord.shadowRuns) {
    return issue('/trialRecord success plus failure must equal shadowRuns', ['trialRecord']);
  }
  const capabilities = pkg.declaredPermissions.map((permission) => permission.capability);
  if (new Set(capabilities).size !== capabilities.length) {
    return issue('/declaredPermissions contains a duplicate capability', ['declaredPermissions']);
  }
  const versionValidation = validateVersionSemantics(pkg);
  return versionValidation.issues ? versionValidation : { value: pkg };
}

function validateShareSemantics(share: TeamReadOnlyShare): CapabilityValidationResult<TeamReadOnlyShare> {
  const packageValidation = validatePackageSemantics(share.package);
  if (packageValidation.issues) return packageValidation;
  if (share.package.status !== 'shared') {
    return issue('/package/status must be shared', ['package', 'status']);
  }
  if (share.package.tenantId !== share.sourceTenantId) {
    return issue('/sourceTenantId must match the package tenant', ['sourceTenantId']);
  }
  if (share.targetTenantId !== share.sourceTenantId && !share.invitationRef) {
    return issue('/invitationRef is required for a cross-tenant team share', ['invitationRef']);
  }
  return { value: share };
}

export function validateCapabilityContract<Name extends CapabilityContractName>(
  name: Name,
  value: unknown,
): CapabilityValidationResult<Static<(typeof CapabilityContractSchemas)[Name]>> {
  const validator = validators[name];
  if (!validator(value)) return { issues: issuesFrom(validator.errors) };

  switch (name) {
    case 'CapabilityPackageAuthorInput':
      return validateVersionSemantics(value as CapabilityPackageAuthorInput) as CapabilityValidationResult<
        Static<(typeof CapabilityContractSchemas)[Name]>
      >;
    case 'SkillTrialSystemRecordInput':
      return validateTrialSemantics(value as SkillTrialSystemRecordInput) as CapabilityValidationResult<
        Static<(typeof CapabilityContractSchemas)[Name]>
      >;
    case 'CapabilityPackageV1':
      return validatePackageSemantics(value as CapabilityPackageV1) as CapabilityValidationResult<
        Static<(typeof CapabilityContractSchemas)[Name]>
      >;
    case 'TeamReadOnlyShare':
      return validateShareSemantics(value as TeamReadOnlyShare) as CapabilityValidationResult<
        Static<(typeof CapabilityContractSchemas)[Name]>
      >;
    case 'CapabilityInstallGateInput': {
      const gate = value as CapabilityInstallGateInput;
      const shareValidation = validateShareSemantics(gate.share);
      if (shareValidation.issues) return shareValidation as CapabilityValidationResult<
        Static<(typeof CapabilityContractSchemas)[Name]>
      >;
      if (gate.targetTenantId !== gate.share.targetTenantId) {
        return issue('/targetTenantId must match the share target tenant', ['targetTenantId']) as CapabilityValidationResult<
          Static<(typeof CapabilityContractSchemas)[Name]>
        >;
      }
      return { value: gate } as CapabilityValidationResult<Static<(typeof CapabilityContractSchemas)[Name]>>;
    }
    case 'CapabilityInstallGateDecision':
      return validateDecisionSemantics(value as CapabilityInstallGateDecision) as CapabilityValidationResult<
        Static<(typeof CapabilityContractSchemas)[Name]>
      >;
  }
}

function standardSchema<TSchemaValue extends TSchema>(
  name: CapabilityContractName,
  schema: TSchemaValue,
): StandardSchemaV1<unknown, Static<TSchemaValue>> & { readonly jsonSchema: TSchemaValue } {
  return {
    jsonSchema: schema,
    '~standard': {
      version: 1,
      vendor: 'hummer-typebox-ajv',
      validate(value) {
        return validateCapabilityContract(name, value) as CapabilityValidationResult<Static<TSchemaValue>>;
      },
    },
  };
}

export const CapabilityPackageAuthorInputStandardSchema = standardSchema(
  'CapabilityPackageAuthorInput',
  CapabilityPackageAuthorInputSchema,
);
export const SkillTrialSystemRecordInputStandardSchema = standardSchema(
  'SkillTrialSystemRecordInput',
  SkillTrialSystemRecordInputSchema,
);
export const CapabilityPackageV1StandardSchema = standardSchema('CapabilityPackageV1', CapabilityPackageV1Schema);
export const TeamReadOnlyShareStandardSchema = standardSchema('TeamReadOnlyShare', TeamReadOnlyShareSchema);
export const CapabilityInstallGateInputStandardSchema = standardSchema(
  'CapabilityInstallGateInput',
  CapabilityInstallGateInputSchema,
);
export const CapabilityInstallGateDecisionStandardSchema = standardSchema(
  'CapabilityInstallGateDecision',
  CapabilityInstallGateDecisionSchema,
);

export type CapabilityVersionAppendDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason: 'invalid_candidate' | 'invalid_existing' | 'identity_mismatch' | 'version_already_exists' | 'version_not_next';
    };

/** Enforces append-only package versions. Existing records are never mutated. */
export function evaluateCapabilityVersionAppend(
  existing: readonly unknown[],
  candidate: unknown,
): CapabilityVersionAppendDecision {
  const candidateValidation = validateCapabilityContract('CapabilityPackageAuthorInput', candidate);
  if (candidateValidation.issues) return { allowed: false, reason: 'invalid_candidate' };

  const acceptedExisting: CapabilityPackageV1[] = [];
  for (const item of existing) {
    const result = validateCapabilityContract('CapabilityPackageV1', item);
    if (result.issues) return { allowed: false, reason: 'invalid_existing' };
    acceptedExisting.push(result.value);
  }

  const next = candidateValidation.value;
  if (acceptedExisting.some((item) => item.packageVersion === next.packageVersion)) {
    return { allowed: false, reason: 'version_already_exists' };
  }
  if (acceptedExisting.some((item) => item.packageId !== next.packageId || item.tenantId !== next.tenantId)) {
    return { allowed: false, reason: 'identity_mismatch' };
  }

  const latest = acceptedExisting.reduce((max, item) => Math.max(max, item.packageVersion), 0);
  const existingVersions = new Set(acceptedExisting.map((item) => item.packageVersion));
  if (existingVersions.size !== acceptedExisting.length ||
      [...Array(latest).keys()].some((index) => !existingVersions.has(index + 1))) {
    return { allowed: false, reason: 'invalid_existing' };
  }
  if (next.packageVersion !== latest + 1 || (latest > 0 && next.supersedesVersion !== latest)) {
    return { allowed: false, reason: 'version_not_next' };
  }
  return { allowed: true };
}

export function createTrialRecordFromSystemTrials(trials: readonly unknown[]): TrialRecord {
  if (trials.length === 0) throw new Error('at least one system-recorded SkillTrial is required');

  const accepted = trials.map((trial) => {
    const result = validateCapabilityContract('SkillTrialSystemRecordInput', trial);
    if (result.issues) throw new Error(`invalid SkillTrial system record: ${result.issues[0]?.message}`);
    return result.value;
  });
  const first = accepted[0]!;
  if (accepted.some((trial) =>
    trial.tenantId !== first.tenantId ||
    trial.packageId !== first.packageId ||
    trial.packageVersion !== first.packageVersion
  )) {
    throw new Error('SkillTrial records must belong to one tenant and package version');
  }
  if (accepted.some((trial) => trial.mode !== 'shadow')) {
    throw new Error('TrialRecord shadowRuns can only aggregate shadow SkillTrial records');
  }

  const environments = [...new Map(
    accepted.map((trial) => [JSON.stringify(trial.environment), trial.environment]),
  ).values()];
  return {
    shadowRuns: accepted.length,
    success: accepted.filter((trial) => trial.ok).length,
    failure: accepted.filter((trial) => !trial.ok).length,
    lastRunAt: accepted.reduce((latest, trial) => trial.endedAt > latest ? trial.endedAt : latest, first.endedAt),
    environments,
  };
}

export type InstallGateAssessment =
  | { allowed: true; reasons: ['install_gate_passed'] }
  | { allowed: false; reasons: string[] };

/** Evaluates evidence only. It grants no permission and performs no installation. */
export function assessCapabilityInstallGate(input: unknown): InstallGateAssessment {
  const validated = validateCapabilityContract('CapabilityInstallGateInput', input);
  if (validated.issues) return { allowed: false, reasons: ['invalid_contract'] };
  const gate = validated.value;
  const reasons: string[] = [];
  if (!gate.staticCheck.passed || gate.staticCheck.findings.length > 0) reasons.push('static_check_failed');
  if (!gate.sourceVerification.provenanceVerified) reasons.push('provenance_unverified');
  if (!gate.sourceVerification.receiptVerified) reasons.push('receipt_unverified');
  if (!gate.sourceVerification.digestVerified) reasons.push('digest_unverified');
  if (gate.permissionReview.deniedPermissions.length > 0) reasons.push('permission_denied');

  const permissionKey = (permission: CapabilityPackageV1['declaredPermissions'][number]) =>
    `${permission.capability}\u0000${permission.access}\u0000${[...permission.paths].sort().join('\u0000')}`;
  const declared = new Set(gate.share.package.declaredPermissions.map(permissionKey));
  const approved = new Set(gate.permissionReview.approvedPermissions.map(permissionKey));
  if (declared.size !== approved.size || [...declared].some((permission) => !approved.has(permission))) {
    reasons.push('permission_declaration_mismatch');
  }

  return reasons.length > 0 ? { allowed: false, reasons: [...new Set(reasons)] } : {
    allowed: true,
    reasons: ['install_gate_passed'],
  };
}

export function createCapabilityInstallGateDecision(input: unknown): CapabilityInstallGateDecision {
  const validated = validateCapabilityContract('CapabilityInstallGateInput', input);
  if (validated.issues) throw new Error(`invalid capability install gate input: ${validated.issues[0]?.message}`);
  const gate = validated.value;
  const assessment = assessCapabilityInstallGate(gate);
  return {
    schema: 'hummer.capability-install-gate-decision',
    version: 1,
    gateId: gate.gateId,
    shareId: gate.share.shareId,
    targetTenantId: gate.targetTenantId,
    decision: assessment.allowed ? 'approved' : 'denied',
    reasons: assessment.reasons,
    packageDigest: gate.share.packageDigest,
    evaluatedAt: gate.evaluatedAt,
  };
}
