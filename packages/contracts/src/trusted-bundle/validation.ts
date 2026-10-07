import { createHash } from 'node:crypto';
import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Static, TSchema } from '@sinclair/typebox';
import {
  computeCapabilityPackageDigest,
  validateCapabilityContract,
} from '../capability/validation.ts';
import { CapabilityInstallGateDecisionSchema, TeamReadOnlyShareSchema } from '../capability/schemas.ts';
import {
  TRUSTED_BUNDLE_FILES,
  TRUSTED_BUNDLE_MAX_FILE_BYTES,
  TRUSTED_BUNDLE_MAX_TOTAL_BYTES,
  TrustedBundleContractSchemas,
  TrustedBundleEnvelopeV1Schema,
  TrustedBundleHumanApprovalV1Schema,
  type TrustedBundleContractName,
  type TrustedBundleEnvelopeV1,
  type TrustedBundleFileName,
  type TrustedBundleHumanApprovalV1,
} from './schemas.ts';

export type TrustedBundleValidationResult<T> =
  | { value: T; issues?: undefined }
  | { value?: undefined; issues: ReadonlyArray<StandardSchemaV1.Issue> };

const validators = Object.fromEntries(
  Object.entries(TrustedBundleContractSchemas).map(([name, schema]) => {
    const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: false });
    ajv.addSchema(CapabilityInstallGateDecisionSchema);
    ajv.addSchema(TeamReadOnlyShareSchema);
    return [name, ajv.compile(schema)];
  }),
) as Record<TrustedBundleContractName, ValidateFunction>;

const forbiddenPatterns = [
  ['credential.private_key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i],
  ['credential.openai_key', /\bsk-[A-Za-z0-9_-]{16,}\b/],
  ['credential.aws_key', /\bAKIA[A-Z0-9]{16}\b/],
  ['credential.assignment', /(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|client[_-]?secret)\s*[:=][^\r\n]{0,4}[A-Za-z0-9_+/=.-]{8,}/i],
  ['raw_recording.embedded_video', /data:video\/[a-z0-9.+-]+;base64,/i],
  ['unredacted.marker', /\bUNREDACTED\b|["']redactionApplied["']\s*:\s*false/i],
] as const;

function sha256Bytes(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function computeTrustedBundleRootHash(fileDigests: Readonly<Record<TrustedBundleFileName, string>>): string {
  return createHash('sha256').update([...TRUSTED_BUNDLE_FILES].sort().map((path) => `${path}\0${fileDigests[path]}\n`).join(''), 'utf8').digest('hex');
}

export function computeTrustedBundleEnvelopeDigest(value: Omit<TrustedBundleEnvelopeV1, 'envelopeDigest'> | TrustedBundleEnvelopeV1): string {
  const { envelopeDigest: _ignored, ...payload } = value as TrustedBundleEnvelopeV1;
  return createHash('sha256').update(canonicalJson(payload), 'utf8').digest('hex');
}

export function decodeTrustedBundleFiles(value: TrustedBundleEnvelopeV1): Readonly<Record<TrustedBundleFileName, Uint8Array>> {
  const decoded = {} as Record<TrustedBundleFileName, Uint8Array>;
  for (const file of value.files) decoded[file.path] = Buffer.from(file.contentBase64, 'base64');
  return decoded;
}

export function scanTrustedBundleText(files: Readonly<Record<TrustedBundleFileName, Uint8Array>>): readonly string[] {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const issues: string[] = [];
  for (const path of TRUSTED_BUNDLE_FILES) {
    let text: string;
    try { text = decoder.decode(files[path]); } catch { issues.push(`encoding.invalid:${path}`); continue; }
    if (text.startsWith('\uFEFF') || text.includes('\r')) issues.push(`normalization.invalid:${path}`);
    for (const [code, pattern] of forbiddenPatterns) if (pattern.test(text)) issues.push(`${code}:${path}`);
  }
  return issues;
}

export function validateTrustedBundleContract<Name extends TrustedBundleContractName>(
  name: Name,
  value: unknown,
): TrustedBundleValidationResult<Static<(typeof TrustedBundleContractSchemas)[Name]>> {
  const validator = validators[name];
  if (!validator(value)) return { issues: issuesFrom(validator.errors) };
  if (name === 'TrustedBundleHumanApprovalV1') return { value } as TrustedBundleValidationResult<Static<(typeof TrustedBundleContractSchemas)[Name]>>;
  return validateEnvelopeSemantics(value as TrustedBundleEnvelopeV1) as TrustedBundleValidationResult<Static<(typeof TrustedBundleContractSchemas)[Name]>>;
}

function validateEnvelopeSemantics(value: TrustedBundleEnvelopeV1): TrustedBundleValidationResult<TrustedBundleEnvelopeV1> {
  const descriptorPaths = value.descriptor.files.map((file) => file.path);
  const bytePaths = value.files.map((file) => file.path);
  const expected = [...TRUSTED_BUNDLE_FILES].sort();
  if (canonicalJson([...descriptorPaths].sort()) !== canonicalJson(expected) || new Set(descriptorPaths).size !== 8) return issue('/descriptor/files must contain the exact eight Agent Skills paths', ['descriptor', 'files']);
  if (canonicalJson([...bytePaths].sort()) !== canonicalJson(expected) || new Set(bytePaths).size !== 8) return issue('/files must contain the exact eight Agent Skills paths', ['files']);
  if (value.decision.decision !== 'approved' || value.decision.reasons.length !== 1 || value.decision.reasons[0] !== 'install_gate_passed') return issue('/decision must be an approved install gate decision', ['decision']);
  for (const [field, actual, expectedValue] of [
    ['tenantId', value.tenantId, value.decision.targetTenantId],
    ['shareId', value.shareId, value.decision.shareId],
    ['gateId', value.gateId, value.decision.gateId],
    ['requestDigest', value.requestDigest, value.decision.requestDigest],
    ['shareDigest', value.shareDigest, value.decision.shareDigest],
    ['packageDigest', value.packageDigest, value.decision.packageDigest],
  ] as const) if (actual !== expectedValue) return issue(`/${field} does not match /decision`, [field]);
  const shareResult = validateCapabilityContract('TeamReadOnlyShare', value.share);
  if (shareResult.issues) return issue('/share is not a valid read-only capability share', ['share']);
  const share = shareResult.value;
  if (share.targetTenantId !== value.tenantId || share.shareId !== value.shareId || share.shareDigest !== value.shareDigest ||
      share.packageId !== value.packageId || share.packageVersion !== value.packageVersion || share.packageDigest !== value.packageDigest) {
    return issue('/share is not exactly bound to the envelope identity', ['share']);
  }

  const files = decodeTrustedBundleFiles(value);
  let totalBytes = 0;
  const digests = {} as Record<TrustedBundleFileName, string>;
  for (const path of TRUSTED_BUNDLE_FILES) {
    const descriptor = value.descriptor.files.find((file) => file.path === path)!;
    const bytes = files[path];
    if (bytes.byteLength < 1 || bytes.byteLength > TRUSTED_BUNDLE_MAX_FILE_BYTES) return issue(`/files/${path} violates the file size limit`, ['files']);
    if (Buffer.from(bytes).toString('base64') !== value.files.find((file) => file.path === path)!.contentBase64) return issue(`/files/${path} is not canonical base64`, ['files']);
    const digest = sha256Bytes(bytes);
    if (descriptor.bytes !== bytes.byteLength || descriptor.sha256 !== digest) return issue(`/descriptor/files/${path} does not describe the transported bytes`, ['descriptor', 'files']);
    digests[path] = digest;
    totalBytes += bytes.byteLength;
  }
  if (totalBytes > TRUSTED_BUNDLE_MAX_TOTAL_BYTES || value.descriptor.totalBytes !== totalBytes) return issue('/descriptor/totalBytes does not match the transported bytes', ['descriptor', 'totalBytes']);
  if (computeTrustedBundleRootHash(digests) !== value.bundleRootHash) return issue('/bundleRootHash does not match the transported bytes', ['bundleRootHash']);
  const forbidden = scanTrustedBundleText(files);
  if (forbidden.length > 0) return issue(`/files contain prohibited material: ${forbidden.join(',')}`, ['files']);

  const decoder = new TextDecoder('utf-8', { fatal: true });
  let meta: unknown;
  try { meta = JSON.parse(decoder.decode(files['meta.json'])); } catch { return issue('/files/meta.json is not valid JSON', ['files']); }
  if (!meta || typeof meta !== 'object' || Array.isArray(meta) || Object.keys(meta as object).length !== 3 ||
      (meta as Record<string, unknown>).schema !== 'hummer.capability-agent-skills-meta' ||
      (meta as Record<string, unknown>).version !== 1 || !Object.hasOwn(meta, 'package')) return issue('/files/meta.json has an invalid envelope', ['files']);
  const packageResult = validateCapabilityContract('CapabilityPackageV1', (meta as { package: unknown }).package);
  if (packageResult.issues) return issue('/files/meta.json contains an invalid capability package', ['files']);
  const pkg = packageResult.value;
  if (pkg.packageId !== value.packageId || pkg.packageVersion !== value.packageVersion || pkg.packageDigest !== value.packageDigest || computeCapabilityPackageDigest(pkg) !== value.packageDigest || canonicalJson(pkg) !== canonicalJson(share.package)) return issue('/package identity, share binding, or digest does not match meta.json', ['packageDigest']);
  if (computeTrustedBundleEnvelopeDigest(value) !== value.envelopeDigest) return issue('/envelopeDigest does not match the complete envelope', ['envelopeDigest']);
  return { value };
}

function standardSchema<TSchemaValue extends TSchema>(name: TrustedBundleContractName, schema: TSchemaValue): StandardSchemaV1<unknown, Static<TSchemaValue>> & { readonly jsonSchema: TSchemaValue } {
  return { jsonSchema: schema, '~standard': { version: 1, vendor: 'hummer-typebox-ajv', validate(value) { return validateTrustedBundleContract(name, value) as TrustedBundleValidationResult<Static<TSchemaValue>>; } } };
}

export const TrustedBundleEnvelopeV1StandardSchema = standardSchema('TrustedBundleEnvelopeV1', TrustedBundleEnvelopeV1Schema);
export const TrustedBundleHumanApprovalV1StandardSchema = standardSchema('TrustedBundleHumanApprovalV1', TrustedBundleHumanApprovalV1Schema);

function pointerPath(pointer: string): PropertyKey[] | undefined { return pointer ? pointer.slice(1).split('/').map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~')) : undefined; }
function issuesFrom(errors: ErrorObject[] | null | undefined): StandardSchemaV1.Issue[] { return (errors ?? []).map((error) => ({ message: `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`, path: pointerPath(error.instancePath) })); }
function issue(message: string, path?: PropertyKey[]): TrustedBundleValidationResult<never> { return { issues: [{ message, path }] }; }
