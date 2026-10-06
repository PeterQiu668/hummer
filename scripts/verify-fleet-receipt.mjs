import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const receiptPath = process.argv[2];
if (!receiptPath) finish(failure('/', 'fleet receipt path is required'));

try {
  const absoluteReceiptPath = realpathSync(resolve(receiptPath));
  const baseDirectory = realpathSync(dirname(absoluteReceiptPath));
  const envelope = JSON.parse(readFileSync(absoluteReceiptPath, 'utf8'));
  finish(verifyFleetEnvelope(envelope, absoluteReceiptPath, baseDirectory));
} catch (error) {
  finish(failure('/', error instanceof Error ? error.message : String(error)));
}

function verifyFleetEnvelope(envelope, absoluteReceiptPath, baseDirectory) {
  let invalid = strictObject(
    envelope,
    '/',
    ['schema', 'version', 'receipt', 'domainEvents', 'manifest', 'fleet'],
    ['schema', 'version', 'receipt', 'domainEvents', 'manifest', 'fleet'],
  );
  if (invalid) return invalid;
  if (envelope.schema !== 'hummer.outcome-receipt' || envelope.version !== 1) {
    return failure('/schema', 'unsupported receipt schema');
  }
  invalid = strictObject(
    envelope.manifest,
    '/manifest',
    ['algorithm', 'rootHash', 'fieldHashes'],
    ['algorithm', 'rootHash', 'fieldHashes'],
  );
  if (invalid) return invalid;
  if (envelope.manifest.algorithm !== 'SHA-256') return failure('/manifest/algorithm', 'unsupported receipt manifest algorithm');
  if (!isSha256(envelope.manifest.rootHash)) return failure('/manifest/rootHash', 'invalid receipt root hash');
  if (!isPlainObject(envelope.manifest.fieldHashes)) return failure('/manifest/fieldHashes', 'receipt field hashes must be an object');

  const parentVerification = runV1Verifier(absoluteReceiptPath);
  if (!parentVerification.valid) return parentVerification.result;

  const fleet = envelope.fleet;
  invalid = strictObject(
    fleet,
    '/fleet',
    ['parentWorkOrderId', 'nodes', 'childReceipts', 'chainHead', 'manifest'],
    ['parentWorkOrderId', 'nodes', 'childReceipts', 'chainHead', 'manifest'],
  );
  if (invalid) return invalid;
  if (!isIdentifier(fleet.parentWorkOrderId, 'wo_')) return failure('/fleet/parentWorkOrderId', 'invalid parent WorkOrder ID');
  if (fleet.parentWorkOrderId !== envelope.receipt?.outcome?.workOrderId) {
    return failure('/fleet/parentWorkOrderId', 'parent WorkOrder does not match receipt outcome');
  }
  if (!Array.isArray(fleet.nodes) || fleet.nodes.length === 0) return failure('/fleet/nodes', 'fleet nodes must be a non-empty array');
  if (!Array.isArray(fleet.childReceipts) || fleet.childReceipts.length === 0) {
    return failure('/fleet/childReceipts', 'child receipts must be a non-empty array');
  }

  invalid = validateFleetManifest(fleet);
  if (invalid) return invalid;

  const nodes = new Map();
  for (let index = 0; index < fleet.nodes.length; index += 1) {
    const node = fleet.nodes[index];
    const path = `/fleet/nodes/${index}`;
    invalid = strictObject(node, path, ['nodeId', 'runtime', 'agentVersion', 'artifactIds'], ['nodeId', 'runtime', 'agentVersion', 'artifactIds']);
    if (invalid) return invalid;
    if (!isIdentifier(node.nodeId)) return failure(`${path}/nodeId`, 'invalid node ID');
    if (nodes.has(node.nodeId)) return failure(`${path}/nodeId`, 'duplicate node ID');
    if (!isRuntime(node.runtime)) return failure(`${path}/runtime`, 'unsupported runtime');
    if (!isNonEmptyString(node.agentVersion)) return failure(`${path}/agentVersion`, 'agent version is required');
    if (!Array.isArray(node.artifactIds)) return failure(`${path}/artifactIds`, 'artifact IDs must be an array');
    const artifactIds = new Set();
    for (let artifactIndex = 0; artifactIndex < node.artifactIds.length; artifactIndex += 1) {
      const artifactId = node.artifactIds[artifactIndex];
      if (!isIdentifier(artifactId)) return failure(`${path}/artifactIds/${artifactIndex}`, 'invalid artifact ID');
      if (artifactIds.has(artifactId)) return failure(`${path}/artifactIds/${artifactIndex}`, 'duplicate artifact ID');
      artifactIds.add(artifactId);
    }
    nodes.set(node.nodeId, { ...node, artifactIds, referencedArtifactIds: new Set() });
  }

  invalid = validateChainHead(fleet.chainHead, nodes, envelope.receipt?.tenantId);
  if (invalid) return invalid;

  const workOrderIds = new Set();
  const receiptPaths = new Set();
  const artifactIds = new Set();
  const artifactPaths = new Set();
  let checkedArtifacts = 0;
  for (let index = 0; index < fleet.childReceipts.length; index += 1) {
    const child = fleet.childReceipts[index];
    const path = `/fleet/childReceipts/${index}`;
    invalid = strictObject(
      child,
      path,
      [
        'workOrderId', 'receiptPath', 'receiptSha256', 'receiptRootHash', 'nodeId', 'agentId',
        'runtime', 'agentVersion', 'completedAt', 'artifactRefs',
      ],
      [
        'workOrderId', 'receiptPath', 'receiptSha256', 'receiptRootHash', 'nodeId', 'agentId',
        'runtime', 'agentVersion', 'completedAt', 'artifactRefs',
      ],
    );
    if (invalid) return invalid;
    if (!isIdentifier(child.workOrderId, 'wo_')) return failure(`${path}/workOrderId`, 'invalid child WorkOrder ID');
    if (workOrderIds.has(child.workOrderId)) return failure(`${path}/workOrderId`, 'duplicate child WorkOrder ID');
    workOrderIds.add(child.workOrderId);
    if (child.workOrderId === fleet.parentWorkOrderId) return failure(`${path}/workOrderId`, 'child cannot equal parent WorkOrder');
    if (!isIdentifier(child.nodeId)) return failure(`${path}/nodeId`, 'invalid node ID');
    const node = nodes.get(child.nodeId);
    if (!node) return failure(`${path}/nodeId`, 'child references an unknown node');
    if (!isIdentifier(child.agentId)) return failure(`${path}/agentId`, 'invalid agent ID');
    if (!isRuntime(child.runtime)) return failure(`${path}/runtime`, 'unsupported runtime');
    if (child.runtime !== node.runtime) return failure(`${path}/runtime`, 'child runtime does not match node');
    if (!isNonEmptyString(child.agentVersion)) return failure(`${path}/agentVersion`, 'agent version is required');
    if (child.agentVersion !== node.agentVersion) return failure(`${path}/agentVersion`, 'child agent version does not match node');
    if (!isIsoDate(child.completedAt)) return failure(`${path}/completedAt`, 'completedAt must be an ISO 8601 UTC timestamp');
    if (!isSha256(child.receiptSha256)) return failure(`${path}/receiptSha256`, 'invalid receipt SHA-256');
    if (!isSha256(child.receiptRootHash)) return failure(`${path}/receiptRootHash`, 'invalid receipt root hash');
    if (!Array.isArray(child.artifactRefs) || child.artifactRefs.length === 0) {
      return failure(`${path}/artifactRefs`, 'artifact refs must be a non-empty array');
    }

    const childPath = resolveContainedFile(baseDirectory, child.receiptPath, `${path}/receiptPath`);
    if (!childPath.valid) return childPath.result;
    if (receiptPaths.has(childPath.path)) return failure(`${path}/receiptPath`, 'duplicate child receipt path');
    receiptPaths.add(childPath.path);
    const childBytes = readFileSync(childPath.path);
    if (sha256(childBytes) !== child.receiptSha256) return failure(`${path}/receiptSha256`, 'child receipt file hash mismatch');

    let childEnvelope;
    try {
      childEnvelope = JSON.parse(childBytes.toString('utf8'));
    } catch {
      return failure(`${path}/receipt`, 'child receipt is invalid JSON');
    }
    const childVerification = runV1Verifier(childPath.path);
    if (!childVerification.valid) {
      return failure(`${path}/receipt`, `child receipt failed v1 verification at ${childVerification.result.field ?? '/'}`);
    }
    if (childEnvelope.manifest?.rootHash !== child.receiptRootHash) {
      return failure(`${path}/receiptRootHash`, 'child receipt root hash mismatch');
    }
    if (childEnvelope.receipt?.outcome?.workOrderId !== child.workOrderId) {
      return failure(`${path}/workOrderId`, 'child WorkOrder does not match child receipt outcome');
    }
    if (childEnvelope.receipt?.tenantId !== envelope.receipt?.tenantId) {
      return failure(`${path}/receipt`, 'child receipt tenant does not match parent tenant');
    }

    for (let artifactIndex = 0; artifactIndex < child.artifactRefs.length; artifactIndex += 1) {
      const artifact = child.artifactRefs[artifactIndex];
      const artifactPath = `${path}/artifactRefs/${artifactIndex}`;
      invalid = strictObject(artifact, artifactPath, ['artifactId', 'path', 'sha256'], ['artifactId', 'path', 'sha256']);
      if (invalid) return invalid;
      if (!isIdentifier(artifact.artifactId)) return failure(`${artifactPath}/artifactId`, 'invalid artifact ID');
      if (artifactIds.has(artifact.artifactId)) return failure(`${artifactPath}/artifactId`, 'duplicate artifact ID');
      artifactIds.add(artifact.artifactId);
      if (!node.artifactIds.has(artifact.artifactId)) return failure(`${artifactPath}/artifactId`, 'artifact is not declared by its node');
      node.referencedArtifactIds.add(artifact.artifactId);
      if (!isSha256(artifact.sha256)) return failure(`${artifactPath}/sha256`, 'invalid artifact SHA-256');
      const resolvedArtifact = resolveContainedFile(baseDirectory, artifact.path, `${artifactPath}/path`);
      if (!resolvedArtifact.valid) return resolvedArtifact.result;
      if (artifactPaths.has(resolvedArtifact.path)) return failure(`${artifactPath}/path`, 'duplicate artifact path');
      artifactPaths.add(resolvedArtifact.path);
      if (sha256(readFileSync(resolvedArtifact.path)) !== artifact.sha256) {
        return failure(`${artifactPath}/sha256`, 'artifact file hash mismatch');
      }
      checkedArtifacts += 1;
    }
  }

  for (const [nodeId, node] of nodes) {
    for (const artifactId of node.artifactIds) {
      if (!node.referencedArtifactIds.has(artifactId)) {
        const nodeIndex = fleet.nodes.findIndex((item) => item.nodeId === nodeId);
        return failure(`/fleet/nodes/${nodeIndex}/artifactIds`, `node artifact ${artifactId} has no child receipt reference`);
      }
    }
  }

  const fleetContent = fleetContentOf(fleet);
  return {
    valid: true,
    checkedChildren: fleet.childReceipts.length,
    checkedArtifacts,
    checkedFleetFields: Object.keys(hashLeaves(fleetContent)).length,
    parentRootHash: envelope.manifest.rootHash,
    fleetRootHash: fleet.manifest.rootHash,
  };
}

function validateFleetManifest(fleet) {
  const path = '/fleet/manifest';
  const invalid = strictObject(fleet.manifest, path, ['algorithm', 'rootHash', 'fieldHashes'], ['algorithm', 'rootHash', 'fieldHashes']);
  if (invalid) return invalid;
  if (fleet.manifest.algorithm !== 'SHA-256') return failure(`${path}/algorithm`, 'unsupported fleet manifest algorithm');
  if (!isSha256(fleet.manifest.rootHash)) return failure(`${path}/rootHash`, 'invalid fleet root hash');
  if (!isPlainObject(fleet.manifest.fieldHashes)) return failure(`${path}/fieldHashes`, 'fleet field hashes must be an object');
  const content = fleetContentOf(fleet);
  const actualLeaves = hashLeaves(content);
  const expectedLeaves = fleet.manifest.fieldHashes;
  for (const fieldPath of [...new Set([...Object.keys(expectedLeaves), ...Object.keys(actualLeaves)])].sort()) {
    if (expectedLeaves[fieldPath] !== actualLeaves[fieldPath]) {
      return failure(`${path}/fieldHashes${fieldPath}`, expectedLeaves[fieldPath] ? 'fleet field hash mismatch' : 'unexpected fleet field');
    }
  }
  if (sha256(canonical(content)) !== fleet.manifest.rootHash) return failure(`${path}/rootHash`, 'fleet root hash mismatch');
  return null;
}

function validateChainHead(chainHead, nodes, tenantId) {
  const path = '/fleet/chainHead';
  let invalid = strictObject(chainHead, path, ['tenantId', 'nodeId', 'position', 'hash', 'at'], ['tenantId', 'nodeId', 'position', 'hash', 'at']);
  if (invalid) return invalid;
  if (!isIdentifier(chainHead.tenantId)) return failure(`${path}/tenantId`, 'invalid tenant ID');
  if (chainHead.tenantId !== tenantId) return failure(`${path}/tenantId`, 'chain head tenant does not match receipt tenant');
  if (!isIdentifier(chainHead.nodeId) || !nodes.has(chainHead.nodeId)) return failure(`${path}/nodeId`, 'chain head references an unknown node');
  if (!Number.isSafeInteger(chainHead.position) || chainHead.position < 0) return failure(`${path}/position`, 'chain head position must be a non-negative integer');
  if (!isSha256(chainHead.hash)) return failure(`${path}/hash`, 'invalid chain head hash');
  if (!isIsoDate(chainHead.at)) return failure(`${path}/at`, 'chain head time must be an ISO 8601 UTC timestamp');
  return null;
}

function runV1Verifier(path) {
  const verifier = resolve(dirname(fileURLToPath(import.meta.url)), 'verify-receipt.mjs');
  const result = spawnSync(process.execPath, [verifier, path], { encoding: 'utf8' });
  let output;
  try {
    output = JSON.parse(result.stdout.trim());
  } catch {
    return { valid: false, result: failure('/receipt', 'v1 verifier did not return JSON') };
  }
  if (result.status !== 0 || output.valid !== true) return { valid: false, result: output };
  return { valid: true, result: output };
}

function resolveContainedFile(baseDirectory, pathValue, fieldPath) {
  if (!isNonEmptyString(pathValue)) return { valid: false, result: failure(fieldPath, 'relative file path is required') };
  if (pathValue.includes('\\') || pathValue.includes('\0') || isAbsolute(pathValue) || /^[A-Za-z]:/.test(pathValue)) {
    return { valid: false, result: failure(fieldPath, 'path must be portable and relative') };
  }
  const segments = pathValue.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return { valid: false, result: failure(fieldPath, 'path traversal is not allowed') };
  }
  const candidate = resolve(baseDirectory, ...segments);
  if (!isWithin(baseDirectory, candidate)) return { valid: false, result: failure(fieldPath, 'path escapes receipt directory') };
  let real;
  try {
    real = realpathSync(candidate);
  } catch {
    return { valid: false, result: failure(fieldPath, 'referenced file does not exist') };
  }
  if (!isWithin(baseDirectory, real)) return { valid: false, result: failure(fieldPath, 'resolved path escapes receipt directory') };
  return { valid: true, path: real };
}

function isWithin(base, candidate) {
  const value = relative(base, candidate);
  return value === '' || (!value.startsWith(`..${sep}`) && value !== '..' && !isAbsolute(value));
}

function strictObject(value, path, allowed, required) {
  if (!isPlainObject(value)) return failure(path, 'object is required');
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) return failure(pointer(path, key), 'unknown field');
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) return failure(pointer(path, key), 'required field is missing');
  }
  return null;
}

function fleetContentOf(fleet) {
  return {
    parentWorkOrderId: fleet.parentWorkOrderId,
    nodes: fleet.nodes,
    childReceipts: fleet.childReceipts,
    chainHead: fleet.chainHead,
  };
}

function hashLeaves(value) {
  const result = {};
  visit(value, '', result);
  return result;
}

function visit(value, path, output) {
  if (Array.isArray(value)) {
    if (!value.length) output[path || '/'] = sha256(canonical(value));
    value.forEach((item, index) => visit(item, `${path}/${index}`, output));
  } else if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (!entries.length) output[path || '/'] = sha256(canonical(value));
    entries.forEach(([key, item]) => visit(item, `${path}/${escapePointer(key)}`, output));
  } else {
    output[path || '/'] = sha256(canonical(value));
  }
}

function canonical(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('non-finite number in receipt');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  throw new TypeError('unsupported receipt value');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function isIdentifier(value, prefix = '') {
  return typeof value === 'string' && value.startsWith(prefix) && /^[A-Za-z0-9._:-]+$/.test(value) && value.length <= 160;
}

function isRuntime(value) {
  return ['codex', 'claude', 'deepseek', 'cli-other', 'gui-exec'].includes(value);
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function isIsoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && !Number.isNaN(Date.parse(value));
}

function escapePointer(value) {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

function pointer(path, key) {
  return `${path === '/' ? '' : path}/${escapePointer(key)}` || '/';
}

function failure(field, reason) {
  return { valid: false, field, reason };
}

function finish(result) {
  console.log(JSON.stringify(result));
  process.exit(result.valid ? 0 : 1);
}
