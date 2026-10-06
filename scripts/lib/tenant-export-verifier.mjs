import { createHash, randomBytes } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_JSON_BYTES = 4 * 1024 * 1024;
const CHAIN_HEAD_KEYS = ['at', 'device_id', 'hash', 'position', 'tenant_id'];
const AUDIT_MANIFEST_KEYS = ['chainHead', 'createdAt', 'eventRefs', 'exportId', 'files', 'range', 'schema', 'tenantId', 'version'];

export function verifyChainHead(value, expected) {
  assertPlainObject(value, 'chain head');
  assertExactKeys(value, CHAIN_HEAD_KEYS, 'chain head');
  assertIdentifier(value.device_id, 'chain head device_id');
  assertIdentifier(value.tenant_id, 'chain head tenant_id');
  assertPositiveInteger(value.position, 'chain head position');
  assertSha256(value.hash, 'chain head hash');
  assertUtcTimestamp(value.at, 'chain head at');
  assertExpectedIdentifier(value.tenant_id, expected.tenantId, 'tenant');
  if (expected.deviceId !== undefined) assertExpectedIdentifier(value.device_id, expected.deviceId, 'device');
  if (expected.position !== undefined && value.position !== expected.position) {
    throw new Error('Chain head position does not match the expected position');
  }
  if (expected.hash !== undefined) {
    assertSha256(expected.hash, 'expected chain head hash');
    if (value.hash !== expected.hash) throw new Error('Chain head hash does not match the expected hash');
  }
  return {
    device_id: value.device_id,
    tenant_id: value.tenant_id,
    position: value.position,
    hash: value.hash,
    at: value.at,
  };
}

export function verifyAuditManifest(value, expected) {
  assertPlainObject(value, 'audit manifest');
  assertExactKeys(value, AUDIT_MANIFEST_KEYS, 'audit manifest');
  if (value.schema !== 'hummer.audit-export' || value.version !== 1) {
    throw new Error('Audit manifest schema or version is unsupported');
  }
  assertIdentifier(value.exportId, 'audit manifest exportId');
  assertIdentifier(value.tenantId, 'audit manifest tenantId');
  assertExpectedIdentifier(value.tenantId, expected.tenantId, 'tenant');
  assertUtcTimestamp(value.createdAt, 'audit manifest createdAt');

  assertPlainObject(value.range, 'audit manifest range');
  assertExactKeys(value.range, ['from', 'to'], 'audit manifest range');
  assertPositiveInteger(value.range.from, 'audit manifest range.from');
  assertPositiveInteger(value.range.to, 'audit manifest range.to');
  if (value.range.to < value.range.from) throw new Error('Audit manifest range is invalid');

  assertPlainObject(value.chainHead, 'audit manifest chainHead');
  assertExactKeys(value.chainHead, ['hash', 'position'], 'audit manifest chainHead');
  assertPositiveInteger(value.chainHead.position, 'audit manifest chainHead.position');
  assertSha256(value.chainHead.hash, 'audit manifest chainHead.hash');

  if (!Array.isArray(value.eventRefs)) throw new Error('Audit manifest eventRefs must be an array');
  const expectedCount = value.range.to - value.range.from + 1;
  if (value.eventRefs.length !== expectedCount) throw new Error('Audit manifest event range is incomplete');
  const eventIds = new Set();
  const eventRefs = value.eventRefs.map((eventRef, index) => {
    assertPlainObject(eventRef, `audit manifest eventRefs[${index}]`);
    assertExactKeys(eventRef, ['eventId', 'hash', 'position'], `audit manifest eventRefs[${index}]`);
    assertIdentifier(eventRef.eventId, `audit manifest eventRefs[${index}].eventId`);
    assertSha256(eventRef.hash, `audit manifest eventRefs[${index}].hash`);
    const position = value.range.from + index;
    if (eventRef.position !== position) throw new Error('Audit manifest event positions are not contiguous');
    if (eventIds.has(eventRef.eventId)) throw new Error('Audit manifest event ids must be unique');
    eventIds.add(eventRef.eventId);
    return { eventId: eventRef.eventId, position: eventRef.position, hash: eventRef.hash };
  });
  const finalEvent = eventRefs.at(-1);
  if (!finalEvent || value.chainHead.position !== finalEvent.position || value.chainHead.hash !== finalEvent.hash) {
    throw new Error('Audit manifest chain head does not match the exported range');
  }

  if (!Array.isArray(value.files)) throw new Error('Audit manifest files must be an array');
  const paths = new Set();
  const files = value.files.map((file, index) => {
    assertPlainObject(file, `audit manifest files[${index}]`);
    assertExactKeys(file, ['path', 'sha256', 'sizeBytes'], `audit manifest files[${index}]`);
    const path = assertRelativeArtifactPath(file.path, `audit manifest files[${index}].path`);
    assertSha256(file.sha256, `audit manifest files[${index}].sha256`);
    if (!Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 0) {
      throw new Error(`audit manifest files[${index}].sizeBytes must be a non-negative safe integer`);
    }
    if (paths.has(path)) throw new Error('Audit manifest file paths must be unique');
    paths.add(path);
    return { path, sha256: file.sha256, sizeBytes: file.sizeBytes };
  });
  const sortedPaths = [...paths].sort((left, right) => left.localeCompare(right));
  if (files.some((file, index) => file.path !== sortedPaths[index])) {
    throw new Error('Audit manifest files must be sorted by normalized path');
  }

  assertSha256(expected.sha256, 'expected audit manifest sha256');
  const normalized = {
    schema: 'hummer.audit-export',
    version: 1,
    exportId: value.exportId,
    tenantId: value.tenantId,
    range: { from: value.range.from, to: value.range.to },
    chainHead: { position: value.chainHead.position, hash: value.chainHead.hash },
    eventRefs,
    files,
    createdAt: value.createdAt,
  };
  const manifestSha256 = sha256Hex(canonicalJson(normalized));
  if (manifestSha256 !== expected.sha256) throw new Error('Audit manifest sha256 does not match the expected digest');
  return { manifest: normalized, manifestSha256 };
}

export function verifyArtifactFiles(manifest, artifactsRoot) {
  const root = requireSafeDirectory(artifactsRoot, 'artifacts root');
  const verified = [];
  for (const file of manifest.files) {
    const candidate = resolve(root, ...file.path.split('/'));
    assertWithin(root, candidate, 'Audit artifact path escapes the artifacts root');
    if (!existsSync(candidate)) throw new Error(`Audit artifact is missing: ${file.path}`);
    const info = lstatSync(candidate);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Audit artifact is not a regular file: ${file.path}`);
    const real = realpathSync(candidate);
    assertWithin(root, real, 'Audit artifact resolves outside the artifacts root');
    if (normalizePath(real) !== normalizePath(candidate)) {
      throw new Error(`Audit artifact path uses a link or alias: ${file.path}`);
    }
    if (info.size !== file.sizeBytes) throw new Error(`Audit artifact size mismatch: ${file.path}`);
    const digest = sha256Hex(readFileSync(candidate));
    if (digest !== file.sha256) throw new Error(`Audit artifact hash mismatch: ${file.path}`);
    verified.push({ path: file.path, sha256: digest, sizeBytes: info.size });
  }
  return verified;
}

export function readJsonExport(inputPath, stdinBytes) {
  let bytes;
  if (inputPath === '-') {
    if (!(stdinBytes instanceof Uint8Array)) throw new Error('JSON stdin input is required');
    bytes = stdinBytes;
  } else {
    assertJsonPath(inputPath, 'input');
    const resolved = resolve(inputPath);
    if (!existsSync(resolved)) throw new Error('JSON input file does not exist');
    const info = lstatSync(resolved);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('JSON input must be a regular non-symlink file');
    if (info.size > MAX_JSON_BYTES) throw new Error('JSON input exceeds the 4 MiB limit');
    bytes = readFileSync(resolved);
  }
  if (bytes.byteLength > MAX_JSON_BYTES) throw new Error('JSON input exceeds the 4 MiB limit');
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new Error('Input is not valid UTF-8 JSON');
  }
}

export function writeJsonProjection(outputPath, value) {
  assertJsonPath(outputPath, 'output');
  const target = resolve(outputPath);
  const parent = dirname(target);
  if (!existsSync(parent)) throw new Error('Projection output parent directory does not exist');
  const safeParent = requireSafeDirectory(parent, 'projection output parent');
  if (normalizePath(parent) !== normalizePath(safeParent)) {
    throw new Error('Projection output parent must not use a symbolic link or alias');
  }
  if (existsSync(target)) throw new Error('Projection output already exists; use a new versioned JSON path');
  const temporary = resolve(parent, `.${randomBytes(12).toString('hex')}.tmp`);
  assertWithin(parent, temporary, 'Projection temporary path escapes its parent');
  const json = `${canonicalJson(value)}\n`;
  writeFileSync(temporary, json, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  renameSync(temporary, target);
  return target;
}

export function updateChainHeadProjection(outputPath, nextHead, options = {}) {
  const verifiedNext = verifyChainHead(nextHead, {
    tenantId: nextHead?.tenant_id,
    deviceId: nextHead?.device_id,
  });
  assertJsonPath(outputPath, 'output');
  const target = resolve(outputPath);
  const parent = dirname(target);
  if (!existsSync(parent)) throw new Error('Projection output parent directory does not exist');
  const safeParent = requireSafeDirectory(parent, 'projection output parent');
  if (normalizePath(parent) !== normalizePath(safeParent)) {
    throw new Error('Projection output parent must not use a symbolic link or alias');
  }
  if (options.expectedCurrentHash !== undefined) {
    assertSha256(options.expectedCurrentHash, 'expected current projection hash');
  }

  const lockPath = `${target}.lock`;
  let lockCreated = false;
  let temporary;
  try {
    writeFileSync(lockPath, `${process.pid}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    lockCreated = true;
    const current = existsSync(target) ? readCurrentChainHeadProjection(target) : undefined;
    if (current) {
      if (current.device_id !== verifiedNext.device_id) {
        throw new Error('Existing projection device does not match the incoming device');
      }
      if (current.tenant_id !== verifiedNext.tenant_id) {
        throw new Error('Existing projection tenant does not match the incoming tenant');
      }
      if (options.expectedCurrentHash !== undefined && current.hash !== options.expectedCurrentHash) {
        throw new Error('Existing projection hash does not match --expected-current-hash');
      }
      if (verifiedNext.position < current.position) {
        throw new Error('Incoming chain-head position is lower than the current projection');
      }
      if (verifiedNext.position === current.position) {
        if (verifiedNext.hash !== current.hash) {
          throw new Error('Incoming chain head conflicts at the current position');
        }
        if (canonicalJson(verifiedNext) !== canonicalJson(current)) {
          throw new Error('Incoming chain head changes metadata at the current position');
        }
        return { path: target, action: 'unchanged', previous: current };
      }
    } else if (options.expectedCurrentHash !== undefined) {
      throw new Error('Cannot apply --expected-current-hash because no current projection exists');
    }

    temporary = resolve(parent, `.${randomBytes(12).toString('hex')}.tmp`);
    assertWithin(parent, temporary, 'Projection temporary path escapes its parent');
    writeFileSync(temporary, `${canonicalJson(verifiedNext)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });

    // Re-read while holding the cooperative lock immediately before replacement.
    // This detects writers that ignored the lock and changed the target during verification.
    if (current) {
      const latest = readCurrentChainHeadProjection(target);
      if (canonicalJson(latest) !== canonicalJson(current)) {
        throw new Error('Projection changed during compare-and-swap');
      }
    } else if (existsSync(target)) {
      throw new Error('Projection appeared during compare-and-swap');
    }
    renameSync(temporary, target);
    temporary = undefined;
    return { path: target, action: current ? 'updated' : 'created', previous: current };
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST' && !lockCreated) {
      throw new Error('Projection update is already in progress');
    }
    throw error;
  } finally {
    if (temporary && existsSync(temporary)) unlinkSync(temporary);
    if (lockCreated && existsSync(lockPath)) unlinkSync(lockPath);
  }
}

export function canonicalJson(value) {
  return JSON.stringify(normalize(value));
}

export function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function assertJsonPath(path, label) {
  if (typeof path !== 'string' || !path.trim()) throw new Error(`${label} path is required`);
  const basename = path.replaceAll('\\', '/').split('/').at(-1)?.toLowerCase() ?? '';
  if (extname(basename) !== '.json' || basename === 'hummer.sqlite3.json') {
    throw new Error(`${label} must be an explicit .json file`);
  }
  if (basename.includes('.sqlite') || basename.includes('.db') || basename.endsWith('-wal.json') || basename.endsWith('-shm.json')) {
    throw new Error(`${label} must not reference a database, WAL, or SHM file`);
  }
}

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} contains missing or unknown fields`);
  }
}

function assertPlainObject(value, label) {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error(`${label} must be a JSON object`);
  }
}

function assertIdentifier(value, label) {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) throw new Error(`${label} is invalid`);
}

function assertExpectedIdentifier(actual, expected, label) {
  assertIdentifier(expected, `expected ${label}`);
  if (actual !== expected) throw new Error(`Export ${label} does not match the expected ${label}`);
}

function assertPositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive safe integer`);
}

function assertSha256(value, label) {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new Error(`${label} must be a lowercase SHA-256 digest`);
}

function assertUtcTimestamp(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new Error(`${label} must be a canonical UTC timestamp`);
  }
}

function assertRelativeArtifactPath(value, label) {
  if (typeof value !== 'string' || !value || value.includes('\\') || isAbsolute(value) || /^[A-Za-z]:/.test(value)) {
    throw new Error(`${label} must be a normalized relative path`);
  }
  const parts = value.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`${label} must be a normalized relative path`);
  }
  return value;
}

function requireSafeDirectory(path, label) {
  const resolved = resolve(path);
  if (!existsSync(resolved)) throw new Error(`${label} does not exist`);
  const info = lstatSync(resolved);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`${label} must be a non-symlink directory`);
  const real = realpathSync(resolved);
  if (normalizePath(real) !== normalizePath(resolved)) throw new Error(`${label} must not use a symbolic link or alias`);
  return real;
}

function readCurrentChainHeadProjection(target) {
  const info = lstatSync(target);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error('Existing projection must be a regular non-symlink JSON file');
  }
  if (info.size > MAX_JSON_BYTES) throw new Error('Existing projection exceeds the 4 MiB limit');
  const parsed = readJsonExport(target);
  return verifyChainHead(parsed, { tenantId: parsed?.tenant_id, deviceId: parsed?.device_id });
}

function assertWithin(root, candidate, message) {
  const path = relative(root, candidate);
  if (path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) throw new Error(message);
}

function normalizePath(path) {
  const normalized = resolve(path);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function normalize(value, insideArray = false) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical JSON only accepts finite numbers');
    return value;
  }
  if (typeof value === 'undefined') {
    if (insideArray) return null;
    throw new TypeError('Canonical JSON does not accept a top-level undefined value');
  }
  if (Array.isArray(value)) return value.map((item) => normalize(item, true));
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const result = {};
    for (const key of Object.keys(value).sort()) {
      if (typeof value[key] !== 'undefined') result[key] = normalize(value[key]);
    }
    return result;
  }
  throw new TypeError(`Canonical JSON cannot encode ${Object.prototype.toString.call(value)}`);
}
