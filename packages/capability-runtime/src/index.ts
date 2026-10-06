import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import {
  assessCapabilityInstallGate,
  computeCapabilityInstallRequestDigest,
  computeCapabilityPackageDigest,
  createCapabilityInstallGateDecision,
  validateCapabilityContract,
  type CapabilityInstallGateDecision,
  type CapabilityInstallGateInput,
  type CapabilityPackageV1,
  type TeamReadOnlyShare,
} from '@hummer/contracts';

export const AGENT_SKILLS_FILES = [
  'SKILL.md',
  'work.md',
  'behavior.md',
  'work_skill.md',
  'behavior_skill.md',
  'manifest.json',
  'meta.json',
  'receipt.json',
] as const;

export type AgentSkillsFileName = (typeof AGENT_SKILLS_FILES)[number];

export interface CapabilityExportBundle {
  readonly package: CapabilityPackageV1;
  readonly packageDigest: string;
  readonly files: Readonly<Record<AgentSkillsFileName, string>>;
  readonly fileDigests: Readonly<Record<AgentSkillsFileName, string>>;
  readonly rootHash: string;
  readonly descriptor: {
    readonly format: 'agent-skills';
    readonly installEntry: 'manifest.json';
    readonly fileDigests: Readonly<Record<AgentSkillsFileName, string>>;
    readonly containsRawRecording: false;
    readonly containsCredentials: false;
    readonly containsUnredactedCustomerData: false;
  };
}

export interface CapabilityExportVerification {
  readonly ok: boolean;
  readonly issues: readonly string[];
}

interface ReceiptDomainEvent {
  readonly id: string;
  readonly tenantId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly aggregateVersion: number;
  readonly type: string;
  readonly occurredAt: string;
  readonly actorRef: string;
  readonly correlationId: string;
  readonly canonicalPayload: string;
  readonly previousHash: string | null;
  readonly hash: string;
  readonly opaque?: false;
}

interface CapabilityReceiptEnvelope {
  readonly schema: 'hummer.outcome-receipt';
  readonly version: 1;
  readonly receipt: {
    readonly receiptRef: string;
    readonly tenantId: string;
    readonly chainIntegrity: { readonly valid: true; readonly checked: number };
    readonly capability: {
      readonly packageId: string;
      readonly packageVersion: number;
      readonly packageDigest: string;
      readonly evidenceRefs: readonly string[];
      readonly trialRecord: CapabilityPackageV1['trialRecord'];
      readonly regressionSuiteRef: string;
    };
    readonly [key: string]: unknown;
  };
  readonly domainEvents: readonly ReceiptDomainEvent[];
  readonly manifest: {
    readonly algorithm: 'SHA-256';
    readonly rootHash: string;
    readonly fieldHashes: Readonly<Record<string, string>>;
  };
}

export interface InstallCapabilityInput {
  readonly bundle: CapabilityExportBundle;
  readonly share: TeamReadOnlyShare;
  readonly installRoot: string;
  readonly targetTenantId: string;
  readonly validInvitationEvidenceDigests: readonly string[];
  readonly approvedPermissions: CapabilityPackageV1['declaredPermissions'];
  readonly deniedPermissions?: CapabilityPackageV1['declaredPermissions'];
  readonly gateId: string;
  readonly requestedByActorRef: string;
  readonly evaluatedAt: string;
}

export interface InstallCapabilityDirectoryInput extends Omit<InstallCapabilityInput, 'bundle'> {
  readonly sourceDirectory: string;
}

export interface InstalledCapability {
  readonly targetDirectory: string;
  readonly readOnly: true;
  readonly sourceTenantId: string;
  readonly targetTenantId: string;
  readonly packageDigest: string;
  readonly rootHash: string;
  readonly decision: CapabilityInstallGateDecision;
}

export type CapabilityInstallEvaluationInput = Omit<InstallCapabilityInput, 'installRoot'>;

export interface CapabilityInstallEvaluation {
  readonly status: 'approved' | 'denied';
  readonly reasons: readonly string[];
  readonly gateInput?: CapabilityInstallGateInput;
  readonly decision?: CapabilityInstallGateDecision;
  readonly evidence: {
    readonly bundleIssues: readonly string[];
    readonly actualFileDigests?: Readonly<Record<AgentSkillsFileName, string>>;
    readonly actualRootHash?: string;
  };
}

export interface CapabilityInstallGateVerification {
  readonly status: 'approved' | 'denied';
  readonly reasons: readonly string[];
  readonly gateInput?: CapabilityInstallGateInput;
  readonly decision?: CapabilityInstallGateDecision;
}

const forbiddenContentPatterns = [
  { code: 'credential.private_key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i },
  { code: 'credential.openai_key', pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/ },
  { code: 'credential.aws_key', pattern: /\bAKIA[A-Z0-9]{16}\b/ },
  {
    code: 'credential.assignment',
    pattern: /(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|client[_-]?secret)\s*[:=][^\r\n]{0,4}[A-Za-z0-9_+/=.-]{8,}/i,
  },
  { code: 'raw_recording.embedded_video', pattern: /data:video\/[a-z0-9.+-]+;base64,/i },
  { code: 'unredacted.marker', pattern: /\bUNREDACTED\b|["']redactionApplied["']\s*:\s*false/i },
] as const;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashLeaves(value: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  const visit = (item: unknown, path: string): void => {
    if (Array.isArray(item)) {
      if (item.length === 0) result[path || '/'] = sha256(canonicalJson(item));
      item.forEach((entry, index) => visit(entry, `${path}/${index}`));
      return;
    }
    if (item && typeof item === 'object') {
      const entries = Object.entries(item);
      if (entries.length === 0) result[path || '/'] = sha256(canonicalJson(item));
      entries.forEach(([key, entry]) => visit(entry, `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`));
      return;
    }
    result[path || '/'] = sha256(canonicalJson(item));
  };
  visit(value, '');
  return result;
}

function prettyJson(value: unknown): string {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, sortKeys(record[key])]));
  }
  return value;
}

function normalizeText(value: string): string {
  return value.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}

function normalizeBoundaryPath(value: string): string {
  const normalized = value.replaceAll('\\', '/').replace(/\/{2,}/g, '/').replace(/^\.\//, '');
  if (!normalized || normalized.includes('\0') || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
    throw new Error('CAPABILITY_PATH_INVALID:absolute or empty path');
  }
  const segments = normalized.split('/');
  if (segments.some((segment) => segment === '..' || segment === '')) {
    throw new Error('CAPABILITY_PATH_INVALID:traversal or empty segment');
  }
  const result = segments.filter((segment) => segment !== '.').join('/');
  if (!result) throw new Error('CAPABILITY_PATH_INVALID:empty normalized path');
  return result;
}

function safeSegment(value: string, label: string): string {
  const windowsDeviceName = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) || value === '.' || value === '..' ||
      value.endsWith('.') || value.endsWith(' ') || windowsDeviceName.test(value)) {
    throw new Error(`CAPABILITY_INSTALL_PATH_INVALID:${label}`);
  }
  return value;
}

function normalizedPackage(input: CapabilityPackageV1): CapabilityPackageV1 {
  const clone = structuredClone(input);
  clone.sourceBoundary.includePaths = clone.sourceBoundary.includePaths.map(normalizeBoundaryPath);
  clone.sourceBoundary.excludePaths = clone.sourceBoundary.excludePaths.map(normalizeBoundaryPath);
  clone.declaredPermissions = clone.declaredPermissions.map((permission) => ({
    ...permission,
    paths: permission.paths.map(normalizeBoundaryPath),
  }));
  return clone;
}

function validateExportablePackage(value: unknown): CapabilityPackageV1 {
  const result = validateCapabilityContract('CapabilityPackageV1', value);
  if (result.issues) throw new Error(`CAPABILITY_PACKAGE_INVALID:${result.issues[0]?.message}`);
  if (!['verified', 'private', 'team', 'shared'].includes(result.value.status)) {
    throw new Error(`CAPABILITY_PACKAGE_NOT_EXPORTABLE:${result.value.status}`);
  }
  const pkg = normalizedPackage(result.value);
  const declared = new Set(pkg.declaredPermissions.map((permission) => permission.capability));
  const undeclared = pkg.requiredCapabilities.filter((capability) => !declared.has(capability));
  if (undeclared.length > 0) {
    throw new Error(`CAPABILITY_PERMISSION_UNDECLARED:${undeclared.join(',')}`);
  }
  return pkg;
}

function validateSourceReceipt(
  value: unknown,
  pkg: CapabilityPackageV1,
  packageDigest: string,
): CapabilityReceiptEnvelope {
  if (!value || typeof value !== 'object') throw new Error('CAPABILITY_RECEIPT_INVALID:envelope');
  const envelope = value as Partial<CapabilityReceiptEnvelope>;
  if (envelope.schema !== 'hummer.outcome-receipt' || envelope.version !== 1 ||
      !envelope.receipt || !Array.isArray(envelope.domainEvents) || !envelope.manifest) {
    throw new Error('CAPABILITY_RECEIPT_INVALID:schema');
  }
  const content = { receipt: envelope.receipt, domainEvents: envelope.domainEvents };
  const actualLeaves = hashLeaves(content);
  if (canonicalJson(actualLeaves) !== canonicalJson(envelope.manifest.fieldHashes)) {
    throw new Error('CAPABILITY_RECEIPT_INVALID:field_hashes');
  }
  if (envelope.manifest.algorithm !== 'SHA-256' || sha256(canonicalJson(content)) !== envelope.manifest.rootHash) {
    throw new Error('CAPABILITY_RECEIPT_INVALID:root_hash');
  }
  if (envelope.receipt.chainIntegrity?.valid !== true || envelope.domainEvents.length === 0) {
    throw new Error('CAPABILITY_RECEIPT_INVALID:chain_integrity');
  }
  let previousHash: string | null = null;
  let verificationPayload: Record<string, unknown> | undefined;
  for (const event of envelope.domainEvents) {
    if (!event || typeof event !== 'object' || event.opaque === true) {
      throw new Error('CAPABILITY_RECEIPT_INVALID:capability receipt requires non-opaque events');
    }
    let payload: unknown;
    try {
      payload = JSON.parse(event.canonicalPayload);
    } catch {
      throw new Error('CAPABILITY_RECEIPT_INVALID:event_payload');
    }
    if (canonicalJson(payload) !== event.canonicalPayload || event.previousHash !== previousHash) {
      throw new Error('CAPABILITY_RECEIPT_INVALID:event_chain');
    }
    const material = {
      actorRef: event.actorRef,
      aggregateId: event.aggregateId,
      aggregateType: event.aggregateType,
      aggregateVersion: event.aggregateVersion,
      correlationId: event.correlationId,
      id: event.id,
      occurredAt: event.occurredAt,
      payload,
      previousHash: event.previousHash,
      tenantId: event.tenantId,
      type: event.type,
    };
    if (sha256(canonicalJson(material)) !== event.hash) {
      throw new Error('CAPABILITY_RECEIPT_INVALID:event_hash');
    }
    if (event.type === 'capability.verified' && payload && typeof payload === 'object' && !Array.isArray(payload)) {
      verificationPayload = payload as Record<string, unknown>;
    }
    previousHash = event.hash;
  }
  const capability = envelope.receipt.capability;
  if (envelope.receipt.receiptRef !== pkg.receiptRef || envelope.receipt.tenantId !== pkg.tenantId ||
      capability?.packageId !== pkg.packageId || capability.packageVersion !== pkg.packageVersion ||
      capability.packageDigest !== packageDigest ||
      canonicalJson(capability.evidenceRefs) !== canonicalJson(pkg.evidenceRefs) ||
      canonicalJson(capability.trialRecord) !== canonicalJson(pkg.trialRecord) ||
      capability.regressionSuiteRef !== pkg.regressionSuiteRef) {
    throw new Error('CAPABILITY_RECEIPT_INVALID:package_binding');
  }
  if (!verificationPayload || verificationPayload.packageDigest !== packageDigest ||
      verificationPayload.provenanceDigest !== sha256(canonicalJson(pkg.provenance))) {
    throw new Error('CAPABILITY_RECEIPT_INVALID:source_evidence');
  }
  if (verificationPayload.regressionPassed !== true ||
      verificationPayload.regressionEvidenceDigest !== pkg.trialRecord.regressionEvidenceDigest ||
      canonicalJson(verificationPayload.successfulShadowTrialIds) !== canonicalJson([...pkg.trialRecord.trialIds].sort())) {
    throw new Error('CAPABILITY_RECEIPT_INVALID:trial_regression_evidence');
  }
  return envelope as CapabilityReceiptEnvelope;
}

/** @deprecated External bundle claims are deliberately rejected by the loader. */
export interface LegacyLoadCapabilityExportDirectoryInput {
  readonly sourceDirectory: string;
  readonly package: CapabilityPackageV1;
  readonly descriptor: CapabilityExportBundle['descriptor'];
  readonly rootHash: string;
}

function slug(value: string): string {
  const result = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  if (!result) throw new Error('CAPABILITY_PACKAGE_INVALID:packageId cannot form an Agent Skills name');
  return result;
}

function yamlString(value: string): string {
  return JSON.stringify(normalizeText(value).replace(/\s+/g, ' ').trim());
}

function markdownList(items: readonly string[]): string {
  return items.length === 0 ? '- None declared' : items.map((item) => `- ${normalizeText(item).replaceAll('\n', '\n  ')}`).join('\n');
}

function workMarkdown(pkg: CapabilityPackageV1): string {
  return normalizeText(`# ${pkg.title}: work\n\n## Goal\n\n${pkg.goal}\n\n## Responsibilities\n\n${markdownList(pkg.capabilityTrack.responsibilities)}\n\n## Workflows\n\n${markdownList(pkg.capabilityTrack.workflows)}\n\n## Standards\n\n${markdownList(pkg.capabilityTrack.standards)}\n\n## Heuristics\n\n${markdownList(pkg.capabilityTrack.heuristics)}\n\n## Pitfalls\n\n${markdownList(pkg.capabilityTrack.pitfalls)}\n\n## Examples\n\n${markdownList(pkg.capabilityTrack.examples)}\n`);
}

function behaviorMarkdown(pkg: CapabilityPackageV1): string {
  const corrections = pkg.behaviorTrack.corrections.length === 0
    ? '- None recorded'
    : pkg.behaviorTrack.corrections.map((item) =>
      `### ${normalizeText(item.scene)}\n\n- Wrong: ${normalizeText(item.wrong)}\n- Correct: ${normalizeText(item.correct)}`
    ).join('\n\n');
  return normalizeText(`# ${pkg.title}: bounded behavior\n\n## Expression preferences\n\n${markdownList(pkg.behaviorTrack.expressionPreferences)}\n\n## Interaction rules\n\n${markdownList(pkg.behaviorTrack.interactionRules)}\n\n## Correction history\n\n${corrections}\n`);
}

function scanForbiddenContents(files: Readonly<Record<AgentSkillsFileName, string>>): string[] {
  const issues: string[] = [];
  for (const name of AGENT_SKILLS_FILES) {
    const content = files[name];
    for (const { code, pattern } of forbiddenContentPatterns) {
      if (pattern.test(content)) issues.push(`${code}:${name}`);
    }
  }
  return issues;
}

function describeActualFiles(files: Readonly<Record<AgentSkillsFileName, string>>): {
  descriptor: CapabilityExportBundle['descriptor'];
  fileDigests: Record<AgentSkillsFileName, string>;
  rootHash: string;
} {
  const fileDigests = {} as Record<AgentSkillsFileName, string>;
  for (const name of AGENT_SKILLS_FILES) {
    if (typeof files[name] !== 'string') throw new Error(`CAPABILITY_EXPORT_FILE_MISSING:${name}`);
    fileDigests[name] = sha256(files[name]);
  }
  const rootHash = sha256(AGENT_SKILLS_FILES.slice().sort().map((file) =>
    `${file}\u0000${fileDigests[file]}\n`).join(''));
  return {
    fileDigests,
    rootHash,
    descriptor: {
      format: 'agent-skills',
      installEntry: 'manifest.json',
      fileDigests,
      containsRawRecording: false,
      containsCredentials: false,
      containsUnredactedCustomerData: false,
    },
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}

function renderCapabilityExport(input: unknown, receiptInput: unknown): CapabilityExportBundle {
  const pkg = validateExportablePackage(input);
  const packageDigest = computeCapabilityPackageDigest(pkg);
  const receipt = validateSourceReceipt(receiptInput, pkg, packageDigest);
  const work = workMarkdown(pkg);
  const behavior = behaviorMarkdown(pkg);
  const name = slug(pkg.packageId);
  const artifacts = [...AGENT_SKILLS_FILES];

  const files: Record<AgentSkillsFileName, string> = {
    'SKILL.md': normalizeText(`---\nname: ${name}\ndescription: ${yamlString(pkg.goal)}\nuser-invocable: true\n---\n\n# ${pkg.title}\n\n${pkg.goal}\n\n## Work capability\n\nSee [work.md](work.md) and [work_skill.md](work_skill.md).\n\n## Bounded behavior\n\nSee [behavior.md](behavior.md) and [behavior_skill.md](behavior_skill.md).\n\n## Use boundary\n\n- Runtime profile: ${pkg.runtimeProfile}\n- Source boundary is declared in manifest.json.\n- Permissions are declarations only; installation requires an approved gate.\n`),
    'work.md': work,
    'behavior.md': behavior,
    'work_skill.md': normalizeText(`---\nname: ${name}-work\ndescription: ${yamlString(`Work track for ${pkg.title}`)}\nuser-invocable: false\n---\n\n${work}`),
    'behavior_skill.md': normalizeText(`---\nname: ${name}-behavior\ndescription: ${yamlString(`Bounded behavior track for ${pkg.title}`)}\nuser-invocable: false\n---\n\n${behavior}`),
    'manifest.json': prettyJson({
      schema: 'hummer.capability-agent-skills-manifest',
      version: 1,
      packageId: pkg.packageId,
      packageVersion: pkg.packageVersion,
      packageDigest,
      entrypoint: 'SKILL.md',
      installEntry: 'manifest.json',
      artifacts,
      compatibleRuntime: {
        runtime: pkg.provenance.runtime,
        runtimeVersion: pkg.provenance.runtimeVersion,
        profile: pkg.runtimeProfile,
      },
      toolchain: { toolIds: pkg.toolIds, agentVersion: pkg.provenance.agentVersion },
      declaredPermissions: pkg.declaredPermissions,
      sourceBoundary: pkg.sourceBoundary,
      regressionSuiteRef: pkg.regressionSuiteRef,
    }),
    'meta.json': prettyJson({
      schema: 'hummer.capability-agent-skills-meta',
      version: 1,
      package: pkg,
    }),
    'receipt.json': prettyJson(receipt),
  };

  const forbidden = scanForbiddenContents(files);
  if (forbidden.length > 0) throw new Error(`CAPABILITY_EXPORT_FORBIDDEN_CONTENT:${forbidden.join(',')}`);
  const { fileDigests, rootHash, descriptor } = describeActualFiles(files);
  return deepFreeze({ package: pkg, packageDigest, files, fileDigests, rootHash, descriptor });
}

export function createCapabilityExport(input: unknown, verifiedReceipt: unknown): CapabilityExportBundle {
  return renderCapabilityExport(input, verifiedReceipt);
}

export function verifyCapabilityExport(bundle: unknown): CapabilityExportVerification {
  const issues: string[] = [];
  if (!bundle || typeof bundle !== 'object') return { ok: false, issues: ['bundle.invalid'] };
  const candidate = bundle as Partial<CapabilityExportBundle>;
  if (!candidate.package || !candidate.files || !candidate.fileDigests || !candidate.descriptor) {
    return { ok: false, issues: ['bundle.incomplete'] };
  }
  let expected: CapabilityExportBundle;
  try {
    const receipt = JSON.parse(candidate.files['receipt.json']);
    expected = renderCapabilityExport(candidate.package, receipt);
  } catch (error) {
    return { ok: false, issues: [`package.invalid:${error instanceof Error ? error.message : 'unknown'}`] };
  }
  const actualNames = Object.keys(candidate.files).sort();
  const expectedNames = [...AGENT_SKILLS_FILES].sort();
  if (canonicalJson(actualNames) !== canonicalJson(expectedNames)) issues.push('files.exact_set_mismatch');
  for (const name of AGENT_SKILLS_FILES) {
    if (candidate.files[name] !== expected.files[name]) issues.push(`file.content_mismatch:${name}`);
    if (candidate.fileDigests[name] !== expected.fileDigests[name]) issues.push(`file.digest_mismatch:${name}`);
  }
  if (candidate.packageDigest !== expected.packageDigest) issues.push('package.digest_mismatch');
  if (candidate.rootHash !== expected.rootHash) issues.push('bundle.root_hash_mismatch');
  if (canonicalJson(candidate.descriptor) !== canonicalJson(expected.descriptor)) issues.push('bundle.descriptor_mismatch');
  for (const forbidden of scanForbiddenContents(candidate.files as Record<AgentSkillsFileName, string>)) {
    issues.push(`forbidden_content:${forbidden}`);
  }
  return { ok: issues.length === 0, issues: [...new Set(issues)] };
}

export async function writeCapabilityExport(
  bundle: CapabilityExportBundle,
  targetDirectory: string,
): Promise<string> {
  const verification = verifyCapabilityExport(bundle);
  if (!verification.ok) throw new Error(`CAPABILITY_EXPORT_INVALID:${verification.issues.join(',')}`);
  const target = resolve(targetDirectory);
  try {
    await mkdir(target, { recursive: false });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('CAPABILITY_EXPORT_TARGET_EXISTS');
    throw error;
  }
  for (const name of AGENT_SKILLS_FILES) {
    const targetFile = resolve(target, name);
    await writeFile(targetFile, bundle.files[name], { encoding: 'utf8', flag: 'wx', mode: 0o444 });
    await chmod(targetFile, 0o444);
  }
  return target;
}

export async function loadCapabilityExportDirectory(
  sourceDirectory: string | LegacyLoadCapabilityExportDirectoryInput,
): Promise<CapabilityExportBundle> {
  if (typeof sourceDirectory !== 'string') {
    throw new Error('CAPABILITY_EXPORT_EXTERNAL_CLAIMS_REJECTED');
  }
  const source = resolve(sourceDirectory);
  const entries = await readdir(source, { withFileTypes: true });
  const names = entries.map((entry) => entry.name).sort();
  const expectedNames = [...AGENT_SKILLS_FILES].sort();
  if (canonicalJson(names) !== canonicalJson(expectedNames)) {
    throw new Error('CAPABILITY_EXPORT_FILE_SET_INVALID');
  }
  if (entries.some((entry) => !entry.isFile() || entry.isSymbolicLink())) {
    throw new Error('CAPABILITY_EXPORT_NON_REGULAR_FILE');
  }

  const decoder = new TextDecoder('utf-8', { fatal: true });
  const files = {} as Record<AgentSkillsFileName, string>;
  for (const name of AGENT_SKILLS_FILES) {
    let text: string;
    try {
      text = decoder.decode(await readFile(resolve(source, name)));
    } catch {
      throw new Error(`CAPABILITY_EXPORT_FILE_ENCODING_INVALID:${name}`);
    }
    if (text.startsWith('\uFEFF') || text.includes('\r')) {
      throw new Error(`CAPABILITY_EXPORT_FILE_NORMALIZATION_INVALID:${name}`);
    }
    files[name] = text;
  }
  let meta: unknown;
  try {
    meta = JSON.parse(files['meta.json']);
  } catch {
    throw new Error('CAPABILITY_EXPORT_META_INVALID:json');
  }
  if (!meta || typeof meta !== 'object' || Array.isArray(meta) ||
      (meta as Record<string, unknown>).schema !== 'hummer.capability-agent-skills-meta' ||
      (meta as Record<string, unknown>).version !== 1 ||
      !('package' in (meta as Record<string, unknown>))) {
    throw new Error('CAPABILITY_EXPORT_META_INVALID:schema');
  }
  const packageValidation = validateCapabilityContract(
    'CapabilityPackageV1',
    (meta as { package: unknown }).package,
  );
  if (packageValidation.issues) {
    throw new Error(`CAPABILITY_EXPORT_META_INVALID:${packageValidation.issues[0]?.message}`);
  }
  const pkg = packageValidation.value;
  const actual = describeActualFiles(files);
  const candidate: CapabilityExportBundle = {
    package: pkg,
    packageDigest: pkg.packageDigest,
    files,
    fileDigests: actual.fileDigests,
    rootHash: actual.rootHash,
    descriptor: actual.descriptor,
  };
  const verification = verifyCapabilityExport(candidate);
  if (!verification.ok) throw new Error(`CAPABILITY_EXPORT_INVALID:${verification.issues.join(',')}`);
  return deepFreeze(candidate);
}

export function createInstallGateInput(
  input: CapabilityInstallEvaluationInput,
): CapabilityInstallEvaluation {
  const verification = verifyCapabilityExport(input.bundle);
  let actual: ReturnType<typeof describeActualFiles> | undefined;
  try {
    actual = describeActualFiles(input.bundle.files);
  } catch (error) {
    return deepFreeze({
      status: 'denied' as const,
      reasons: [error instanceof Error ? error.message : 'bundle_actual_bytes_unavailable'],
      evidence: { bundleIssues: verification.issues },
    });
  }

  const shareValidation = validateCapabilityContract('TeamReadOnlyShare', input.share);
  if (shareValidation.issues) {
    return deepFreeze({
      status: 'denied' as const,
      reasons: ['share_contract_invalid'],
      evidence: {
        bundleIssues: verification.issues,
        actualFileDigests: actual.fileDigests,
        actualRootHash: actual.rootHash,
      },
    });
  }
  const share = shareValidation.value;
  const packageDigest = computeCapabilityPackageDigest(input.bundle.package);
  let receiptPassed = false;
  try {
    validateSourceReceipt(JSON.parse(input.bundle.files['receipt.json']), input.bundle.package, packageDigest);
    receiptPassed = true;
  } catch {
    receiptPassed = false;
  }
  const packageDigestPassed = packageDigest === input.bundle.packageDigest &&
    packageDigest === share.packageDigest && share.package.packageDigest === packageDigest;
  const packageBindingPassed = canonicalJson(share.package) === canonicalJson(input.bundle.package);
  const targetPassed = share.targetTenantId === input.targetTenantId;
  const crossTenant = share.sourceTenantId !== share.targetTenantId;
  const invitationPassed = !crossTenant || Boolean(share.invitation &&
    input.validInvitationEvidenceDigests.includes(share.invitation.evidenceDigest));
  const bundleIssues = [...verification.issues];
  if (!packageBindingPassed) bundleIssues.push('share.package_mismatch');
  if (!targetPassed) bundleIssues.push('share.target_mismatch');
  const findings = [...new Set(bundleIssues)].map((message) => ({
    code: 'bundle_verification_failed',
    message,
  }));
  const deniedPermissions = input.deniedPermissions ?? [];
  const gateInput: CapabilityInstallGateInput = {
    schema: 'hummer.capability-install-gate-input',
    version: 1,
    gateId: input.gateId,
    share,
    recordedBy: 'system:capability-install-gate',
    requestDigest: '0'.repeat(64),
    shareDigest: share.shareDigest,
    exportDescriptor: actual.descriptor,
    targetTenantId: input.targetTenantId,
    requestedByActorRef: input.requestedByActorRef,
    staticCheck: {
      status: findings.length === 0 ? 'passed' : 'failed',
      evidenceDigest: sha256(canonicalJson({
        exactFiles: [...AGENT_SKILLS_FILES],
        fileDigests: actual.fileDigests,
        rootHash: actual.rootHash,
        claimedRootHash: input.bundle.rootHash,
        findings,
      })),
      findings,
    },
    permissionReview: {
      approvedPermissions: input.approvedPermissions,
      deniedPermissions,
      evidenceDigest: sha256(canonicalJson({
        approvedPermissions: input.approvedPermissions,
        deniedPermissions,
      })),
    },
    sourceVerification: {
      provenance: {
        status: receiptPassed ? 'passed' : 'failed',
        evidenceDigest: sha256(canonicalJson(share.package.provenance)),
      },
      receipt: {
        status: receiptPassed ? 'passed' : 'failed',
        evidenceDigest: actual.fileDigests['receipt.json'],
      },
      packageDigest: {
        status: packageDigestPassed && packageBindingPassed ? 'passed' : 'failed',
        evidenceDigest: sha256(canonicalJson({
          computed: packageDigest,
          exported: input.bundle.packageDigest,
          shared: share.packageDigest,
        })),
      },
      ...(crossTenant ? {
        invitation: {
          status: invitationPassed ? 'passed' as const : 'failed' as const,
          evidenceDigest: share.invitation?.evidenceDigest ?? sha256('missing-invitation'),
        },
      } : {}),
      regression: {
        status: receiptPassed && share.package.trialRecord.regressionPassed ? 'passed' : 'failed',
        evidenceDigest: share.package.trialRecord.regressionEvidenceDigest,
      },
    },
    evaluatedAt: input.evaluatedAt,
  };
  gateInput.requestDigest = computeCapabilityInstallRequestDigest(gateInput);
  const gateValidation = validateCapabilityContract('CapabilityInstallGateInput', gateInput);
  if (gateValidation.issues) {
    return deepFreeze({
      status: 'denied' as const,
      reasons: ['install_gate_contract_invalid'],
      evidence: {
        bundleIssues: [...new Set(bundleIssues)],
        actualFileDigests: actual.fileDigests,
        actualRootHash: actual.rootHash,
      },
    });
  }
  const assessment = assessCapabilityInstallGate(gateInput);
  const decision = createCapabilityInstallGateDecision(gateInput);
  return deepFreeze({
    status: assessment.allowed ? 'approved' as const : 'denied' as const,
    reasons: assessment.reasons,
    gateInput,
    decision,
    evidence: {
      bundleIssues: [...new Set(bundleIssues)],
      actualFileDigests: actual.fileDigests,
      actualRootHash: actual.rootHash,
    },
  });
}

/** Verifies a complete persisted/transported gate input without inventing evidence. */
export function verifyInstallGateInput(input: unknown): CapabilityInstallGateVerification {
  const validated = validateCapabilityContract('CapabilityInstallGateInput', input);
  if (validated.issues) {
    return deepFreeze({ status: 'denied' as const, reasons: ['install_gate_contract_invalid'] });
  }
  const gateInput = validated.value;
  const assessment = assessCapabilityInstallGate(gateInput);
  return deepFreeze({
    status: assessment.allowed ? 'approved' as const : 'denied' as const,
    reasons: assessment.reasons,
    gateInput,
    decision: createCapabilityInstallGateDecision(gateInput),
  });
}

/** Compatibility name for callers that want a create-and-assess operation. */
export const evaluateCapabilityInstallRequest = createInstallGateInput;

function normalizedRealPath(value: string): string {
  const normalized = resolve(value).replaceAll('\\', '/');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

async function assertPlainDirectory(value: string, label: string): Promise<void> {
  let status;
  try {
    status = await lstat(value);
  } catch {
    throw new Error(`CAPABILITY_INSTALL_PATH_MISSING:${label}`);
  }
  if (status.isSymbolicLink() || !status.isDirectory()) {
    throw new Error(`CAPABILITY_INSTALL_PATH_SYMLINK:${label}`);
  }
  const actual = await realpath(value);
  if (normalizedRealPath(actual) !== normalizedRealPath(value)) {
    throw new Error(`CAPABILITY_INSTALL_PATH_REPARSE_ESCAPE:${label}`);
  }
}

async function ensurePlainChild(parent: string, segment: string, label: string): Promise<string> {
  const candidate = resolve(parent, segment);
  const childRelative = relative(parent, candidate);
  if (!childRelative || childRelative.startsWith(`..${sep}`) || isAbsolute(childRelative)) {
    throw new Error(`CAPABILITY_INSTALL_PATH_INVALID:${label}`);
  }
  try {
    await mkdir(candidate, { recursive: false, mode: 0o755 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  await assertPlainDirectory(candidate, label);
  return candidate;
}

export async function installCapabilityExport(input: InstallCapabilityInput): Promise<InstalledCapability> {
  const evaluation = createInstallGateInput(input);
  if (evaluation.status !== 'approved' || !evaluation.decision) {
    throw new Error(`CAPABILITY_INSTALL_GATE_DENIED:${evaluation.reasons.join(',')}`);
  }
  const share = input.share;
  const root = resolve(input.installRoot);
  await assertPlainDirectory(root, 'installRoot');
  const tenantSegment = safeSegment(input.targetTenantId, 'targetTenantId');
  const packageSegment = safeSegment(input.bundle.package.packageId, 'packageId');
  const versionSegment = safeSegment(`v${input.bundle.package.packageVersion}`, 'packageVersion');
  const tenantDirectory = await ensurePlainChild(root, tenantSegment, 'targetTenantDirectory');
  const packageDirectory = await ensurePlainChild(tenantDirectory, packageSegment, 'packageDirectory');
  const targetDirectory = resolve(packageDirectory, versionSegment);
  const relativeTarget = relative(root, targetDirectory);
  if (!relativeTarget || relativeTarget.startsWith(`..${sep}`) || isAbsolute(relativeTarget)) {
    throw new Error('CAPABILITY_INSTALL_PATH_INVALID:target escaped installRoot');
  }

  try {
    await mkdir(targetDirectory, { recursive: false, mode: 0o755 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('CAPABILITY_INSTALL_TARGET_EXISTS');
    throw error;
  }
  await assertPlainDirectory(targetDirectory, 'targetDirectory');
  for (const name of AGENT_SKILLS_FILES) {
    const targetFile = resolve(targetDirectory, name);
    await writeFile(targetFile, input.bundle.files[name], { encoding: 'utf8', flag: 'wx', mode: 0o644 });
    await chmod(targetFile, 0o444);
  }
  await chmod(targetDirectory, 0o555);

  return deepFreeze({
    targetDirectory,
    readOnly: true as const,
    sourceTenantId: share.sourceTenantId,
    targetTenantId: share.targetTenantId,
    packageDigest: input.bundle.packageDigest,
    rootHash: input.bundle.rootHash,
    decision: evaluation.decision,
  });
}

/** Loads a self-describing eight-file directory, verifies its actual bytes, then installs it. */
export async function installCapabilityExportDirectory(
  input: InstallCapabilityDirectoryInput,
): Promise<InstalledCapability> {
  const { sourceDirectory, ...installInput } = input;
  const bundle = await loadCapabilityExportDirectory(sourceDirectory);
  return installCapabilityExport({ ...installInput, bundle });
}
