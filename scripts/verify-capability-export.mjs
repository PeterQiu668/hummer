import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const FILES = ['SKILL.md', 'work.md', 'behavior.md', 'work_skill.md', 'behavior_skill.md', 'manifest.json', 'meta.json', 'receipt.json'];
const MAX_FILE_BYTES = 64 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024;
const forbidden = [
  ['credential.private_key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i],
  ['credential.openai_key', /\bsk-[A-Za-z0-9_-]{16,}\b/],
  ['credential.aws_key', /\bAKIA[A-Z0-9]{16}\b/],
  ['credential.assignment', /(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|client[_-]?secret)\s*[:=][^\r\n]{0,4}[A-Za-z0-9_+/=.-]{8,}/i],
  ['raw_recording.embedded_video', /data:video\/[a-z0-9.+-]+;base64,/i],
  ['unredacted.marker', /\bUNREDACTED\b|["']redactionApplied["']\s*:\s*false/i],
];

const inputPath = process.argv[2];
if (!inputPath || process.argv.length !== 3) failure('usage', 'node scripts/verify-capability-export.mjs <capability-export.json>');

let bundle;
try { bundle = JSON.parse(readFileSync(inputPath, 'utf8')); } catch (error) { failure('input.invalid_json', error instanceof Error ? error.message : String(error)); }

try {
  const result = verify(bundle);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  failure('verification.failed', error instanceof Error ? error.message : String(error));
}

function verify(value) {
  exactObject(value, ['package', 'packageDigest', 'files', 'fileDigests', 'rootHash', 'descriptor'], 'bundle');
  object(value.package, 'package');
  object(value.files, 'files');
  object(value.fileDigests, 'fileDigests');
  exactSet(Object.keys(value.files), FILES, 'files');
  exactSet(Object.keys(value.fileDigests), FILES, 'fileDigests');
  sha(value.packageDigest, 'packageDigest');
  sha(value.rootHash, 'rootHash');

  exactObject(value.descriptor, ['format', 'installEntry', 'fileDigests', 'containsRawRecording', 'containsCredentials', 'containsUnredactedCustomerData'], 'descriptor');
  if (value.descriptor.format !== 'agent-skills' || value.descriptor.installEntry !== 'manifest.json') throw new Error('descriptor.format_or_entry');
  if (value.descriptor.containsRawRecording !== false || value.descriptor.containsCredentials !== false || value.descriptor.containsUnredactedCustomerData !== false) throw new Error('descriptor.unsafe_claim');
  if (canonical(value.descriptor.fileDigests) !== canonical(value.fileDigests)) throw new Error('descriptor.file_digests_mismatch');

  let totalBytes = 0;
  const actualDigests = {};
  for (const name of FILES) {
    if (typeof value.files[name] !== 'string') throw new Error(`file.not_text:${name}`);
    const bytes = Buffer.byteLength(value.files[name], 'utf8');
    if (bytes < 1 || bytes > MAX_FILE_BYTES) throw new Error(`file.size:${name}`);
    totalBytes += bytes;
    actualDigests[name] = sha256(value.files[name]);
    sha(value.fileDigests[name], `fileDigests.${name}`);
    if (actualDigests[name] !== value.fileDigests[name]) throw new Error(`file.digest_mismatch:${name}`);
    for (const [code, pattern] of forbidden) if (pattern.test(value.files[name])) throw new Error(`${code}:${name}`);
  }
  if (totalBytes > MAX_TOTAL_BYTES) throw new Error('files.total_size');
  const rootHash = sha256([...FILES].sort().map((name) => `${name}\0${actualDigests[name]}\n`).join(''));
  if (rootHash !== value.rootHash) throw new Error('bundle.root_hash_mismatch');

  const packageDigest = capabilityPackageDigest(value.package);
  if (packageDigest !== value.packageDigest || value.package.packageDigest !== packageDigest) throw new Error('package.digest_mismatch');
  if (!['verified', 'private', 'team', 'shared'].includes(value.package.status)) throw new Error('package.not_exportable');
  if (!value.package.trialRecord || value.package.trialRecord.packageDigest !== packageDigest || value.package.trialRecord.packageId !== value.package.packageId || value.package.trialRecord.packageVersion !== value.package.packageVersion || value.package.trialRecord.tenantId !== value.package.tenantId) throw new Error('package.trial_binding');
  if (value.package.status === 'shared' && (value.package.trialRecord.shadowRuns < 5 || value.package.trialRecord.success !== value.package.trialRecord.shadowRuns || value.package.trialRecord.failure !== 0 || value.package.trialRecord.regressionPassed !== true)) throw new Error('package.shared_trial_gate');

  const manifest = jsonFile(value.files, 'manifest.json');
  const meta = jsonFile(value.files, 'meta.json');
  const receipt = jsonFile(value.files, 'receipt.json');
  exactObject(meta, ['schema', 'version', 'package'], 'meta');
  if (meta.schema !== 'hummer.capability-agent-skills-meta' || meta.version !== 1 || canonical(meta.package) !== canonical(value.package)) throw new Error('meta.package_binding');
  exactObject(manifest, ['schema', 'version', 'packageId', 'packageVersion', 'packageDigest', 'entrypoint', 'installEntry', 'artifacts', 'compatibleRuntime', 'toolchain', 'declaredPermissions', 'sourceBoundary', 'regressionSuiteRef'], 'manifest');
  if (manifest.schema !== 'hummer.capability-agent-skills-manifest' || manifest.version !== 1 || manifest.packageId !== value.package.packageId || manifest.packageVersion !== value.package.packageVersion || manifest.packageDigest !== packageDigest || manifest.entrypoint !== 'SKILL.md' || manifest.installEntry !== 'manifest.json') throw new Error('manifest.identity_binding');
  if (canonical(manifest.artifacts) !== canonical(FILES) || canonical(manifest.declaredPermissions) !== canonical(value.package.declaredPermissions) || canonical(manifest.sourceBoundary) !== canonical(value.package.sourceBoundary) || manifest.regressionSuiteRef !== value.package.regressionSuiteRef) throw new Error('manifest.package_binding');

  verifyReceipt(receipt, value.package, packageDigest);
  return { valid: true, packageId: value.package.packageId, packageVersion: value.package.packageVersion, packageDigest, rootHash, files: FILES.length, totalBytes, receiptRootHash: receipt.manifest.rootHash };
}

function verifyReceipt(envelope, pkg, packageDigest) {
  exactObject(envelope, ['schema', 'version', 'receipt', 'domainEvents', 'manifest'], 'receiptEnvelope');
  if (envelope.schema !== 'hummer.outcome-receipt' || envelope.version !== 1 || !Array.isArray(envelope.domainEvents) || envelope.domainEvents.length < 1) throw new Error('receipt.schema');
  object(envelope.receipt, 'receipt'); object(envelope.manifest, 'receipt.manifest');
  const content = { receipt: envelope.receipt, domainEvents: envelope.domainEvents };
  if (envelope.manifest.algorithm !== 'SHA-256' || envelope.manifest.rootHash !== sha256(canonical(content)) || canonical(envelope.manifest.fieldHashes) !== canonical(hashLeaves(content))) throw new Error('receipt.manifest_integrity');
  const capability = envelope.receipt.capability;
  if (envelope.receipt.receiptRef !== pkg.receiptRef || envelope.receipt.tenantId !== pkg.tenantId || envelope.receipt.chainIntegrity?.valid !== true || capability?.packageId !== pkg.packageId || capability.packageVersion !== pkg.packageVersion || capability.packageDigest !== packageDigest || canonical(capability.evidenceRefs) !== canonical(pkg.evidenceRefs) || canonical(capability.trialRecord) !== canonical(pkg.trialRecord) || capability.regressionSuiteRef !== pkg.regressionSuiteRef) throw new Error('receipt.package_binding');

  let previousHash = null;
  let verificationPayload;
  for (const event of envelope.domainEvents) {
    object(event, 'receipt.event');
    if (event.opaque === true || event.previousHash !== previousHash) throw new Error('receipt.event_chain');
    let payload;
    try { payload = JSON.parse(event.canonicalPayload); } catch { throw new Error('receipt.event_payload'); }
    if (canonical(payload) !== event.canonicalPayload) throw new Error('receipt.event_payload_canonical');
    const material = { actorRef: event.actorRef, aggregateId: event.aggregateId, aggregateType: event.aggregateType, aggregateVersion: event.aggregateVersion, correlationId: event.correlationId, id: event.id, occurredAt: event.occurredAt, payload, previousHash: event.previousHash, tenantId: event.tenantId, type: event.type };
    if (event.hash !== sha256(canonical(material))) throw new Error('receipt.event_hash');
    if (event.type === 'capability.verified') verificationPayload = payload;
    previousHash = event.hash;
  }
  if (!verificationPayload || verificationPayload.packageDigest !== packageDigest || verificationPayload.provenanceDigest !== sha256(canonical(pkg.provenance)) || verificationPayload.regressionPassed !== true || verificationPayload.regressionEvidenceDigest !== pkg.trialRecord.regressionEvidenceDigest || canonical(verificationPayload.successfulShadowTrialIds) !== canonical([...pkg.trialRecord.trialIds].sort())) throw new Error('receipt.verification_evidence');
}

function capabilityPackageDigest(pkg) {
  const immutable = Object.fromEntries(Object.entries(pkg).filter(([key]) => !['schema', 'status', 'deletionAudit', 'trialRecord', 'packageDigest'].includes(key)));
  return sha256(canonical(immutable));
}
function jsonFile(files, name) { try { return JSON.parse(files[name]); } catch { throw new Error(`file.invalid_json:${name}`); } }
function hashLeaves(value) { const result = {}; const visit = (item, path) => { if (Array.isArray(item)) { if (item.length === 0) result[path || '/'] = sha256(canonical(item)); item.forEach((entry, index) => visit(entry, `${path}/${index}`)); } else if (item && typeof item === 'object') { const entries = Object.entries(item); if (entries.length === 0) result[path || '/'] = sha256(canonical(item)); entries.forEach(([key, entry]) => visit(entry, `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`)); } else result[path || '/'] = sha256(canonical(item)); }; visit(value, ''); return result; }
function canonical(value) { if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`; if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`; return JSON.stringify(value); }
function sha256(value) { return createHash('sha256').update(value, 'utf8').digest('hex'); }
function sha(value, label) { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`${label}.invalid_sha256`); }
function object(value, label) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}.not_object`); }
function exactObject(value, keys, label) { object(value, label); exactSet(Object.keys(value), keys, label); }
function exactSet(actual, expected, label) { const left = [...actual].sort(); const right = [...expected].sort(); if (canonical(left) !== canonical(right)) throw new Error(`${label}.exact_keys`); }
function failure(code, detail) { process.stderr.write(`${JSON.stringify({ valid: false, code, detail })}\n`); process.exit(1); }
