import { randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, realpath, rename, rmdir, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { TRUSTED_BUNDLE_FILES, decodeTrustedBundleFiles, validateTrustedBundleContract } from '@hummer/contracts';
import { verifyCapabilityExport } from '@hummer/capability-runtime';
import { NodeAgentError } from './errors.mjs';

const ROOT_MARKER = '.hummer-synthetic-install-root.json';
const ROOT_MARKER_BYTES = '{"purpose":"trusted-bundle-e2e-synthetic-only","schema":"hummer.synthetic-install-root","version":1}\n';

function safeSegment(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(value)) {
    throw new NodeAgentError('install_path_invalid', `${label} is not a safe path segment`);
  }
  return value;
}
function normalized(value) { const result = resolve(value).replaceAll('\\', '/'); return process.platform === 'win32' ? result.toLowerCase() : result; }
async function assertPlainDirectory(value, label) {
  const status = await lstat(value).catch(() => null);
  if (!status || status.isSymbolicLink() || !status.isDirectory()) throw new NodeAgentError('install_root_invalid', `${label} must be an existing plain directory`);
  if (normalized(await realpath(value)) !== normalized(value)) throw new NodeAgentError('install_root_invalid', `${label} must not resolve through a reparse or symlink path`);
}
async function assertSyntheticRoot(root) {
  await assertPlainDirectory(root, 'installRoot');
  const content = await readFile(resolve(root, ROOT_MARKER), 'utf8').catch(() => '');
  if (content !== ROOT_MARKER_BYTES) throw new NodeAgentError('install_root_invalid', 'install root is not marked synthetic-only');
}

/** Creates the only root this kernel is authorized to mutate. */
export async function initializeSyntheticTrustedBundleRoot(installRoot) {
  const root = resolve(installRoot);
  await mkdir(root, { recursive: false, mode: 0o700 });
  await assertPlainDirectory(root, 'installRoot');
  await writeFile(resolve(root, ROOT_MARKER), ROOT_MARKER_BYTES, { encoding: 'utf8', flag: 'wx', mode: 0o400 });
  return root;
}
async function cleanupStage(stage) {
  await chmod(stage, 0o700).catch(() => undefined);
  for (const name of TRUSTED_BUNDLE_FILES) {
    await chmod(resolve(stage, name), 0o600).catch(() => undefined);
    await unlink(resolve(stage, name)).catch(() => undefined);
  }
  await rmdir(stage).catch(() => undefined);
}

/** Revalidates Relay bytes and uses an atomic directory rename after a separate human approval. */
export async function installTrustedBundleToSyntheticRoot(input, platform = {}) {
  const bundleResult = validateTrustedBundleContract('TrustedBundleEnvelopeV1', input?.bundle);
  if (bundleResult.issues) throw new NodeAgentError('invalid_trusted_bundle', bundleResult.issues[0]?.message ?? 'trusted bundle is invalid');
  const approvalResult = validateTrustedBundleContract('TrustedBundleHumanApprovalV1', input?.humanApproval);
  if (approvalResult.issues) throw new NodeAgentError('human_approval_required', approvalResult.issues[0]?.message ?? 'human approval is invalid');
  const bundle = bundleResult.value;
  const approval = approvalResult.value;
  if (approval.tenantId !== bundle.tenantId || approval.nodeId !== bundle.targetNodeId || approval.bundleId !== bundle.bundleId || approval.gateId !== bundle.gateId || approval.bundleRootHash !== bundle.bundleRootHash) {
    throw new NodeAgentError('human_approval_mismatch', 'human approval is not bound to this tenant, node, gate, bundle, and root hash');
  }
  const bytes = decodeTrustedBundleFiles(bundle);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const files = Object.fromEntries(TRUSTED_BUNDLE_FILES.map((name) => [name, decoder.decode(bytes[name])]));
  const meta = JSON.parse(files['meta.json']);
  const runtimeBundle = {
    package: meta.package,
    packageDigest: bundle.packageDigest,
    files,
    fileDigests: Object.fromEntries(bundle.descriptor.files.map((file) => [file.path, file.sha256])),
    rootHash: bundle.bundleRootHash,
    descriptor: {
      format: 'agent-skills', installEntry: 'manifest.json',
      fileDigests: Object.fromEntries(bundle.descriptor.files.map((file) => [file.path, file.sha256])),
      containsRawRecording: false, containsCredentials: false, containsUnredactedCustomerData: false,
    },
  };
  const exportVerification = verifyCapabilityExport(runtimeBundle);
  if (!exportVerification.ok) throw new NodeAgentError('invalid_trusted_bundle', `Agent Skills verification failed: ${exportVerification.issues.join(',')}`);
  const root = resolve(input.installRoot);
  await assertSyntheticRoot(root);
  const targetName = `${safeSegment(bundle.tenantId, 'tenantId')}--${safeSegment(bundle.packageId, 'packageId')}--v${bundle.packageVersion}`;
  const target = resolve(root, targetName);
  const targetRel = relative(root, target);
  if (!targetRel || targetRel.startsWith(`..${sep}`) || isAbsolute(targetRel)) throw new NodeAgentError('install_path_invalid', 'target escaped the synthetic install root');
  if (await lstat(target).then(() => true, () => false)) throw new NodeAgentError('install_target_exists', 'trusted bundle target already exists; overwrite is forbidden');
  const installLock = resolve(root, `.hummer-lock-${targetName}`);
  try {
    await writeFile(installLock, `${bundle.envelopeDigest}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o400 });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') throw new NodeAgentError('install_in_progress', 'another installer already owns this immutable target');
    throw error;
  }
  const stage = resolve(root, `.hummer-stage-${randomUUID()}`);
  const stageRel = relative(root, stage);
  if (!stageRel || stageRel.startsWith(`..${sep}`) || isAbsolute(stageRel)) throw new NodeAgentError('install_path_invalid', 'stage escaped the synthetic install root');
  try {
    if (await lstat(target).then(() => true, () => false)) throw new NodeAgentError('install_target_exists', 'trusted bundle target already exists; overwrite is forbidden');
    await mkdir(stage, { recursive: false, mode: 0o700 });
    for (const name of TRUSTED_BUNDLE_FILES) {
      await writeFile(resolve(stage, name), bytes[name], { flag: 'wx', mode: 0o400 });
      await chmod(resolve(stage, name), 0o400);
    }
    await chmod(stage, 0o500);
    await (platform.atomicRename ?? rename)(stage, target);
  } catch (error) {
    await cleanupStage(stage);
    if (await lstat(target).then(() => true, () => false)) throw new NodeAgentError('install_target_exists', 'trusted bundle target already exists; overwrite is forbidden');
    throw error;
  } finally {
    await chmod(installLock, 0o600).catch(() => undefined);
    await unlink(installLock).catch(() => undefined);
  }
  return Object.freeze({ targetDirectory: target, bundleId: bundle.bundleId, packageDigest: bundle.packageDigest, bundleRootHash: bundle.bundleRootHash, readOnly: true });
}
