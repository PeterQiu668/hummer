import { createHash } from 'node:crypto';
import {
  computeCapabilityInstallRequestDigest,
  computeCapabilityPackageDigest,
  computeTeamReadOnlyShareDigest,
  createCapabilityInstallGateDecision,
  createTrialRecordFromSystemTrials,
  validateCapabilityContract,
  type CapabilityInstallGateDecision,
  type CapabilityInstallGateInput,
  type CapabilityPackageAuthorInput,
  type CapabilityPackageV1,
  type CapabilityShareInvitation,
  type SkillTrialSystemRecordInput,
  type TeamReadOnlyShare,
  type TrialRecord,
} from '@hummer/contracts';
import { canonicalJson } from './canonical-json.js';
import {
  FleetRejectedError,
  type CapabilityRegistryRecord,
  type CapabilityTrialRecordInput,
  type CapabilityVersionCreateInput,
} from './ports.js';

export function parseCapabilityVersionCreateInput(input: unknown): CapabilityVersionCreateInput {
  const body = exactRecord(input, ['author', 'sourceTaskId', 'artifactEventId', 'completedEventId'], 'capability version');
  const author = validateCapabilityContract('CapabilityPackageAuthorInput', body.author);
  if (author.issues) invalid(`invalid capability author input: ${author.issues[0]?.message}`);
  return {
    author: author.value,
    sourceTaskId: identifier(body.sourceTaskId, 'sourceTaskId'),
    artifactEventId: identifier(body.artifactEventId, 'artifactEventId'),
    completedEventId: identifier(body.completedEventId, 'completedEventId'),
  };
}

export function parseCapabilityTrialRecordInput(input: unknown): CapabilityTrialRecordInput {
  const body = exactRecord(input, ['trial', 'regression'], 'capability trial');
  const trial = validateCapabilityContract('SkillTrialSystemRecordInput', body.trial);
  if (trial.issues) invalid(`invalid SkillTrial record: ${trial.issues[0]?.message}`);
  const regression = exactRecord(body.regression, ['passed', 'evidenceDigest'], 'regression result');
  if (typeof regression.passed !== 'boolean' || typeof regression.evidenceDigest !== 'string'
    || !/^[a-f0-9]{64}$/.test(regression.evidenceDigest)) {
    invalid('regression result must contain passed and a lowercase SHA-256 evidenceDigest');
  }
  return { trial: trial.value, regression: { passed: regression.passed, evidenceDigest: regression.evidenceDigest } };
}

export function parseCapabilityShareCreateInput(input: unknown) {
  const body = exactRecord(input, ['shareId', 'packageId', 'packageVersion', 'targetTenantId'], 'capability share');
  return {
    shareId: identifier(body.shareId, 'shareId'),
    packageId: identifier(body.packageId, 'packageId'),
    packageVersion: positiveInteger(body.packageVersion, 'packageVersion'),
    targetTenantId: identifier(body.targetTenantId, 'targetTenantId'),
  };
}

export function parseCapabilityInstallEvaluateInput(input: unknown) {
  const validated = validateCapabilityContract('CapabilityInstallGateInput', input);
  if (validated.issues) invalid(`invalid install-gate evidence: ${validated.issues[0]?.message}`);
  return validated.value;
}

export function assertCapabilityHistory(records: readonly CapabilityRegistryRecord[], author: CapabilityPackageAuthorInput): string {
  const ordered = [...records].sort((left, right) => left.packageVersion - right.packageVersion);
  if (ordered.some((record, index) => record.packageVersion !== index + 1
    || record.tenantId !== author.tenantId || record.packageId !== author.packageId
    || (index === 0 ? record.author.previousPackageDigest !== undefined
      : record.author.previousPackageDigest !== ordered[index - 1]!.packageDigest))) {
    throw new FleetRejectedError('capability_conflict', 'capability version history is invalid');
  }
  const latest = ordered.at(-1);
  if (author.packageVersion !== ordered.length + 1
    || (latest && (author.supersedesVersion !== latest.packageVersion
      || author.previousPackageDigest !== latest.packageDigest))) {
    throw new FleetRejectedError('capability_conflict', 'capability version must append to the current digest head');
  }
  return computeCapabilityPackageDigest(author);
}

export function createTrialAggregate(
  trials: readonly SkillTrialSystemRecordInput[],
  regression: CapabilityTrialRecordInput['regression'],
): TrialRecord {
  try {
    return createTrialRecordFromSystemTrials(trials, regression);
  } catch (error) {
    throw new FleetRejectedError('capability_conflict', error instanceof Error ? error.message : 'invalid trial aggregate');
  }
}

export function finalCapabilityPackage(record: CapabilityRegistryRecord, status: CapabilityPackageV1['status']): CapabilityPackageV1 {
  if (!record.trialRecord) throw new FleetRejectedError('capability_conflict', 'capability has no trusted trial aggregate');
  const pkg = {
    ...record.author,
    schema: 'hummer.capability-package' as const,
    status,
    packageDigest: record.packageDigest,
    trialRecord: record.trialRecord,
  };
  const checked = validateCapabilityContract('CapabilityPackageV1', pkg);
  if (checked.issues) throw new FleetRejectedError('capability_conflict', checked.issues[0]?.message ?? 'invalid capability package');
  return checked.value;
}

export function buildCapabilityInvitation(args: {
  invitationId: string;
  sourceTenantId: string;
  targetTenantId: string;
  packageId: string;
  packageVersion: number;
  packageDigest: string;
  expiresAt: string;
}): CapabilityShareInvitation {
  return {
    ...args,
    status: 'accepted',
    evidenceDigest: sha256(canonicalJson(args)),
  };
}

export function buildCapabilityShare(args: {
  shareId: string;
  record: CapabilityRegistryRecord;
  targetTenantId: string;
  invitation?: CapabilityShareInvitation;
  actorRef: string;
  now: string;
}): TeamReadOnlyShare {
  const pkg = finalCapabilityPackage(args.record, 'shared');
  const withoutDigest = {
    schema: 'hummer.capability-team-share' as const,
    version: 1 as const,
    shareId: args.shareId,
    sourceTenantId: args.record.tenantId,
    targetTenantId: args.targetTenantId,
    packageId: args.record.packageId,
    packageVersion: args.record.packageVersion,
    ...(args.invitation ? { invitation: args.invitation } : {}),
    access: 'read_only' as const,
    allowEdit: false as const,
    allowCopyToTenant: false as const,
    packageDigest: args.record.packageDigest,
    package: pkg,
    sharedByActorRef: args.actorRef,
    sharedAt: args.now,
  };
  const share = { ...withoutDigest, shareDigest: sha256(canonicalJson(withoutDigest)) };
  // Keep the contract implementation authoritative for canonical digest rules.
  share.shareDigest = computeTeamReadOnlyShareDigest(share);
  const checked = validateCapabilityContract('TeamReadOnlyShare', share);
  if (checked.issues) throw new FleetRejectedError('capability_conflict', checked.issues[0]?.message ?? 'invalid capability share');
  return checked.value;
}

export function rebindCapabilityInstallDecision(args: {
  share: TeamReadOnlyShare;
  targetTenantId: string;
  input: CapabilityInstallGateInput;
  now: string;
}): CapabilityInstallGateDecision {
  if (args.input.share.shareId !== args.share.shareId
    || args.input.shareDigest !== args.share.shareDigest
    || args.input.share.shareDigest !== args.share.shareDigest
    || args.input.share.packageDigest !== args.share.packageDigest
    || args.input.share.targetTenantId !== args.share.targetTenantId
    || args.input.targetTenantId !== args.targetTenantId) {
    throw new FleetRejectedError('capability_trust_denied', 'install evidence is not bound to the persisted tenant share');
  }
  const rebound: CapabilityInstallGateInput = {
    ...args.input,
    share: args.share,
    shareDigest: args.share.shareDigest,
    targetTenantId: args.targetTenantId,
    evaluatedAt: args.now,
    requestDigest: '0'.repeat(64),
  };
  rebound.requestDigest = computeCapabilityInstallRequestDigest(rebound);
  try {
    return createCapabilityInstallGateDecision(rebound);
  } catch (error) {
    throw new FleetRejectedError('capability_trust_denied', error instanceof Error ? error.message : 'install gate rejected');
  }
}

export function capabilityRecordFromShare(source: CapabilityRegistryRecord, share: TeamReadOnlyShare): CapabilityRegistryRecord {
  const { schema: _schema, trialRecord, packageDigest, status: _status, ...author } = share.package;
  return {
    ...source,
    author: { ...author, schema: 'hummer.capability-package-author-input', status: source.author.status },
    packageDigest,
    trialRecord,
    status: 'shared',
  };
}

function exactRecord(input: unknown, allowed: readonly string[], subject: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid(`${subject} must be an object`);
  const record = input as Record<string, unknown>;
  if (Object.keys(record).some((key) => !allowed.includes(key))) invalid(`${subject} contains an unknown field`);
  return record;
}

function identifier(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) invalid(`${field} is invalid`);
  return value;
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 1_000_000) invalid(`${field} is invalid`);
  return value as number;
}

function invalid(message: string): never {
  throw new FleetRejectedError('invalid_contract', message);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
