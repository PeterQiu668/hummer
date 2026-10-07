import { win32 } from 'node:path';

export const PRIVATE_ALPHA_NODE_SCOPES = [
  'node.register',
  'node.heartbeat',
  'task.claim',
  'task.event',
  'stream.connect',
  'approval.request',
  'approval.consume',
];

const SHA256 = /^[a-f0-9]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const WINDOWS_ABSOLUTE = /^[A-Za-z]:\\/u;
const SAFE_TRANSFER_CHANNELS = new Set(['offline_manual', 'approved_password_manager']);
const FORBIDDEN_KEY = /(token|secret|password|credential|private.?key)/iu;

export function validatePrivateAlphaPreflight(value, options = {}) {
  const errors = [];
  const now = options.now instanceof Date ? options.now : new Date();
  const root = object(value, '/', [
    'schema', 'version', 'approval', 'controller', 'node', 'network', 'badge',
    'installer', 'canary', 'evidenceDirectory', 'safeguards',
  ], errors);
  rejectSecretKeys(value, '/', errors);
  rejectPlaceholders(value, '/', errors);
  if (!root) return result(errors);

  equal(root.schema, 'hummer.private-alpha-preflight', '/schema', errors);
  equal(root.version, 1, '/version', errors);

  const approval = object(root.approval, '/approval', [
    'approved', 'approvedByRef', 'approvedAt', 'scope',
  ], errors);
  if (approval) {
    equal(approval.approved, true, '/approval/approved', errors, 'explicit owner approval is required');
    identifier(approval.approvedByRef, '/approval/approvedByRef', errors);
    equal(approval.scope, 'private-alpha-a-fs-read-attest-v1', '/approval/scope', errors);
    const approvedAt = timestamp(approval.approvedAt, '/approval/approvedAt', errors);
    if (approvedAt && approvedAt > now) add(errors, '/approval/approvedAt', 'future', 'approval time cannot be in the future');
  }

  const controller = device(root.controller, '/controller', errors);
  const node = device(root.node, '/node', errors);
  if (controller && node && controller.deviceRef === node.deviceRef) {
    add(errors, '/node/deviceRef', 'same_device', 'controller and node must be two distinct devices');
  }

  const network = object(root.network, '/network', [
    'mode', 'relayUrl', 'allowedNodeAddress', 'certificateSha256', 'certificateNotBefore', 'certificateNotAfter',
  ], errors);
  let certificateNotBefore;
  let certificateNotAfter;
  if (network) {
    if (!['private_tls_gateway', 'existing_private_overlay'].includes(network.mode)) {
      add(errors, '/network/mode', 'invalid_value', 'network mode must be an approved private mode');
    }
    httpsUrl(network.relayUrl, '/network/relayUrl', errors);
    nonEmpty(network.allowedNodeAddress, '/network/allowedNodeAddress', errors);
    digest(network.certificateSha256, '/network/certificateSha256', errors);
    certificateNotBefore = timestamp(network.certificateNotBefore, '/network/certificateNotBefore', errors);
    certificateNotAfter = timestamp(network.certificateNotAfter, '/network/certificateNotAfter', errors);
    if (certificateNotBefore && now < certificateNotBefore) add(errors, '/network/certificateNotBefore', 'not_active', 'TLS certificate is not active yet');
    if (certificateNotAfter && now >= certificateNotAfter) add(errors, '/network/certificateNotAfter', 'expired', 'TLS certificate is expired');
  }

  const badge = object(root.badge, '/badge', [
    'badgeId', 'tenantId', 'nodeId', 'scopes', 'issuedAt', 'expiresAt', 'transferChannel',
  ], errors);
  if (badge) {
    identifier(badge.badgeId, '/badge/badgeId', errors);
    identifier(badge.tenantId, '/badge/tenantId', errors);
    identifier(badge.nodeId, '/badge/nodeId', errors);
    if (node && badge.nodeId !== node.deviceRef) add(errors, '/badge/nodeId', 'node_mismatch', 'badge nodeId must match the approved node deviceRef');
    exactStringSet(badge.scopes, PRIVATE_ALPHA_NODE_SCOPES, '/badge/scopes', errors);
    const issuedAt = timestamp(badge.issuedAt, '/badge/issuedAt', errors);
    const expiresAt = timestamp(badge.expiresAt, '/badge/expiresAt', errors);
    if (issuedAt && issuedAt > now) add(errors, '/badge/issuedAt', 'not_active', 'badge is not active yet');
    if (expiresAt && expiresAt <= now) add(errors, '/badge/expiresAt', 'expired', 'badge is expired');
    if (issuedAt && expiresAt) {
      const duration = expiresAt.getTime() - issuedAt.getTime();
      if (duration <= 0 || duration > 8 * 60 * 60 * 1000) add(errors, '/badge/expiresAt', 'duration', 'badge lifetime must be greater than zero and at most 8 hours');
      if (certificateNotAfter && expiresAt > certificateNotAfter) add(errors, '/badge/expiresAt', 'certificate_window', 'badge must expire before the TLS certificate');
    }
    if (!SAFE_TRANSFER_CHANNELS.has(badge.transferChannel)) {
      add(errors, '/badge/transferChannel', 'unsafe_channel', 'badge transfer must use offline manual entry or an approved password manager');
    }
  }

  const installer = object(root.installer, '/installer', ['path', 'sha256', 'unsignedApproved'], errors);
  if (installer) {
    windowsPath(installer.path, '/installer/path', errors);
    digest(installer.sha256, '/installer/sha256', errors);
    equal(installer.unsignedApproved, true, '/installer/unsignedApproved', errors, 'unsigned internal package use requires explicit approval');
  }

  const canary = object(root.canary, '/canary', [
    'workspaceRoot', 'path', 'sha256', 'bytes', 'containsBusinessData', 'isReparsePoint', 'hardLinkCount',
  ], errors);
  if (canary) {
    windowsPath(canary.workspaceRoot, '/canary/workspaceRoot', errors);
    windowsPath(canary.path, '/canary/path', errors);
    digest(canary.sha256, '/canary/sha256', errors);
    if (!Number.isSafeInteger(canary.bytes) || canary.bytes <= 0 || canary.bytes > 1024 * 1024) {
      add(errors, '/canary/bytes', 'size', 'canary must be between 1 byte and 1 MiB');
    }
    equal(canary.containsBusinessData, false, '/canary/containsBusinessData', errors, 'business data is forbidden');
    equal(canary.isReparsePoint, false, '/canary/isReparsePoint', errors, 'reparse points and links are forbidden');
    equal(canary.hardLinkCount, 1, '/canary/hardLinkCount', errors, 'canary must have exactly one hard link');
    if (typeof canary.workspaceRoot === 'string' && typeof canary.path === 'string'
      && WINDOWS_ABSOLUTE.test(canary.workspaceRoot) && WINDOWS_ABSOLUTE.test(canary.path)) {
      const relative = win32.relative(win32.resolve(canary.workspaceRoot), win32.resolve(canary.path));
      if (!relative || relative === '..' || relative.startsWith(`..${win32.sep}`) || win32.isAbsolute(relative)) {
        add(errors, '/canary/path', 'outside_workspace', 'canary path must be a file strictly inside workspaceRoot');
      }
    }
  }

  windowsPath(root.evidenceDirectory, '/evidenceDirectory', errors);
  const safeguards = object(root.safeguards, '/safeguards', [
    'publicExposure', 'productionData', 'shellExecutor', 'networkExecutor',
    'writeExecutor', 'deleteExecutor', 'realPayment',
  ], errors);
  if (safeguards) {
    for (const field of Object.keys(safeguards)) {
      equal(safeguards[field], false, `/safeguards/${field}`, errors, `${field} must remain disabled`);
    }
  }
  return result(errors);
}

function device(value, path, errors) {
  const record = object(value, path, ['deviceRef', 'os', 'osVersion', 'operatorRef'], errors);
  if (!record) return undefined;
  identifier(record.deviceRef, `${path}/deviceRef`, errors);
  equal(record.os, 'win32', `${path}/os`, errors);
  nonEmpty(record.osVersion, `${path}/osVersion`, errors);
  identifier(record.operatorRef, `${path}/operatorRef`, errors);
  return record;
}

function object(value, path, fields, errors) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    add(errors, path, 'type', 'must be an object');
    return undefined;
  }
  const keys = Object.keys(value);
  for (const key of keys) if (!fields.includes(key)) add(errors, `${path === '/' ? '' : path}/${key}`, 'unknown_field', 'unknown field');
  for (const field of fields) if (!Object.hasOwn(value, field)) add(errors, `${path === '/' ? '' : path}/${field}`, 'required', 'required field is missing');
  return value;
}

function rejectSecretKeys(value, path, errors) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectSecretKeys(item, `${path}/${index}`, errors));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path === '/' ? '' : path}/${key}`;
    if (FORBIDDEN_KEY.test(key)) add(errors, childPath, 'secret_field', 'preflight files must never contain credential or secret fields');
    rejectSecretKeys(child, childPath, errors);
  }
}

function rejectPlaceholders(value, path, errors) {
  if (typeof value === 'string') {
    if (value.includes('REPLACE_')) add(errors, path, 'placeholder', 'all template placeholders must be replaced');
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectPlaceholders(item, `${path}/${index}`, errors));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    rejectPlaceholders(child, `${path === '/' ? '' : path}/${key}`, errors);
  }
}

function exactStringSet(value, expected, path, errors) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    add(errors, path, 'type', 'must be an array of strings');
    return;
  }
  const actual = [...new Set(value)].sort();
  const wanted = [...expected].sort();
  if (actual.length !== value.length || JSON.stringify(actual) !== JSON.stringify(wanted)) {
    add(errors, path, 'least_privilege', `must contain exactly: ${expected.join(', ')}`);
  }
}

function httpsUrl(value, path, errors) {
  if (typeof value !== 'string') return add(errors, path, 'type', 'must be an HTTPS URL string');
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('unsafe');
    if (['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(url.hostname)) throw new Error('loopback');
  } catch {
    add(errors, path, 'https', 'must be a credential-free non-loopback HTTPS URL without query or fragment');
  }
}

function windowsPath(value, path, errors) {
  if (typeof value !== 'string' || !WINDOWS_ABSOLUTE.test(value) || value.includes('..')) {
    add(errors, path, 'absolute_path', 'must be an explicit Windows absolute path without traversal');
  }
}

function identifier(value, path, errors) {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) add(errors, path, 'identifier', 'must be a bounded identifier');
}

function digest(value, path, errors) {
  if (typeof value !== 'string' || !SHA256.test(value)) add(errors, path, 'sha256', 'must be a lowercase SHA-256 digest');
}

function nonEmpty(value, path, errors) {
  if (typeof value !== 'string' || !value.trim() || value.length > 256) add(errors, path, 'text', 'must be non-empty bounded text');
}

function timestamp(value, path, errors) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    add(errors, path, 'timestamp', 'must be an ISO timestamp');
    return undefined;
  }
  return new Date(value);
}

function equal(actual, expected, path, errors, message = `must equal ${JSON.stringify(expected)}`) {
  if (actual !== expected) add(errors, path, 'value', message);
}

function add(errors, path, code, message) {
  errors.push({ path, code, message });
}

function result(errors) {
  return { ok: errors.length === 0, errors };
}
