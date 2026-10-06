import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';

import { NodeAgentError } from './errors.mjs';

const JOURNAL_VERSION = 1;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const TERMINAL_STATES = new Set(['completed', 'failed', 'stopped', 'rejected']);

/**
 * Append-only, process-local execution journal used by tests and embedders that
 * supply their own durable storage. Reuse the same instance to model restart.
 */
export class MemoryExecutionJournal {
  /** @type {Array<Record<string, unknown>>} */ #entries = [];
  /** @type {{tenantId: string, nodeId: string}|null} */ #scope = null;
  /** @type {() => Date} */ #clock;

  /** @param {{clock?: () => Date}} [options] */
  constructor(options = {}) {
    this.#clock = typeof options.clock === 'function' ? options.clock : () => new Date();
  }

  /** @param {{tenantId: string, nodeId: string}} scope */
  initialize(scope) {
    const normalized = normalizeScope(scope);
    if (this.#entries.length === 0) {
      this.#scope = normalized;
      this.#append({ type: 'journal_initialized' });
    }
    const snapshot = verifyEntries(this.#entries);
    assertScope(snapshot.scope, normalized);
    this.#scope = normalized;
    return snapshot;
  }

  /** @param {Record<string, unknown>} record */
  append(record) {
    if (!this.#scope) throw new NodeAgentError('journal_not_initialized', 'Execution journal is not initialized');
    return this.#append(record);
  }

  /** @param {Record<string, unknown>} record */
  #append(record) {
    const entry = buildEntry(record, this.#scope, this.#entries, this.#clock);
    const candidate = [...this.#entries, entry];
    const snapshot = verifyEntries(candidate);
    this.#entries = candidate;
    return claimFromSnapshot(snapshot, 'claimId' in entry ? entry.claimId : undefined);
  }
}

/**
 * Local JSONL journal. Each line is canonical JSON, chained to the previous
 * line by SHA-256, appended with a synchronous file flush before returning.
 */
export class FileExecutionJournal {
  /** @type {string} */ #path;
  /** @type {Array<Record<string, unknown>>} */ #entries = [];
  /** @type {{tenantId: string, nodeId: string}|null} */ #scope = null;
  /** @type {() => Date} */ #clock;
  #poisoned = false;

  /** @param {{path: string, clock?: () => Date}} options */
  constructor(options) {
    if (!options || typeof options.path !== 'string' || options.path.trim() === '') {
      throw new NodeAgentError('invalid_journal_config', 'File execution journal requires a path');
    }
    this.#path = resolve(options.path);
    this.#clock = typeof options.clock === 'function' ? options.clock : () => new Date();
  }

  /** @param {{tenantId: string, nodeId: string}} scope */
  initialize(scope) {
    const normalized = normalizeScope(scope);
    if (existsSync(this.#path)) {
      this.#entries = readJournalFile(this.#path);
      const snapshot = verifyEntries(this.#entries);
      assertScope(snapshot.scope, normalized);
      this.#scope = normalized;
      return snapshot;
    }

    this.#scope = normalized;
    const entry = buildEntry({ type: 'journal_initialized' }, normalized, [], this.#clock);
    try {
      mkdirSync(dirname(this.#path), { recursive: true });
      writeNewFileAndFlush(this.#path, `${canonicalJson(entry)}\n`);
    } catch (error) {
      this.#poisoned = true;
      throw journalWriteError(error);
    }
    this.#entries = [entry];
    return verifyEntries(this.#entries);
  }

  /** @param {Record<string, unknown>} record */
  append(record) {
    if (!this.#scope) throw new NodeAgentError('journal_not_initialized', 'Execution journal is not initialized');
    if (this.#poisoned) throw new NodeAgentError('journal_write_failed', 'Execution journal is unavailable after a failed durable append');
    const entry = buildEntry(record, this.#scope, this.#entries, this.#clock);
    const candidate = [...this.#entries, entry];
    const snapshot = verifyEntries(candidate);
    try {
      appendAndFlush(this.#path, `${canonicalJson(entry)}\n`);
    } catch (error) {
      this.#poisoned = true;
      throw journalWriteError(error);
    }
    this.#entries = candidate;
    return claimFromSnapshot(snapshot, 'claimId' in entry ? entry.claimId : undefined);
  }
}

/** @param {string} path */
function readJournalFile(path) {
  let contents;
  try {
    contents = readFileSync(path, 'utf8');
  } catch (error) {
    throw new NodeAgentError('journal_read_failed', `Execution journal could not be read: ${safeSystemCode(error)}`);
  }
  if (contents.length === 0 || !contents.endsWith('\n')) {
    throw new NodeAgentError('journal_corrupt', 'Execution journal is empty or has an incomplete final record');
  }
  return contents.slice(0, -1).split('\n').map((line, index) => {
    try {
      const parsed = JSON.parse(line);
      if (!isRecord(parsed) || canonicalJson(parsed) !== line) throw new Error('record is not canonical');
      return parsed;
    } catch {
      throw new NodeAgentError('journal_corrupt', `Execution journal record ${index + 1} is invalid`);
    }
  });
}

/** @param {string} path @param {string} line */
function writeNewFileAndFlush(path, line) {
  const handle = openSync(path, 'wx', 0o600);
  try {
    writeAll(handle, line);
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
}

/** @param {string} path @param {string} line */
function appendAndFlush(path, line) {
  const handle = openSync(path, 'a', 0o600);
  try {
    writeAll(handle, line);
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
}

/** @param {number} handle @param {string} value */
function writeAll(handle, value) {
  const bytes = Buffer.from(value, 'utf8');
  let offset = 0;
  while (offset < bytes.length) {
    const written = writeSync(handle, bytes, offset, bytes.length - offset, null);
    if (written <= 0) throw new Error('journal write made no progress');
    offset += written;
  }
}

/** @param {Record<string, unknown>} record @param {{tenantId: string, nodeId: string}|null} scope @param {Array<Record<string, unknown>>} entries @param {() => Date} clock */
function buildEntry(record, scope, entries, clock) {
  if (!scope) throw new NodeAgentError('journal_not_initialized', 'Execution journal is not initialized');
  const material = validateRecord(record);
  const previous = entries.at(-1);
  const entryWithoutHash = {
    version: JOURNAL_VERSION,
    sequence: entries.length + 1,
    occurredAt: clock().toISOString(),
    tenantId: scope.tenantId,
    nodeId: scope.nodeId,
    previousHash: previous ? previous.hash : null,
    ...material,
  };
  return { ...entryWithoutHash, hash: sha256Hex(canonicalJson(entryWithoutHash)) };
}

/** @param {Record<string, unknown>} record */
function validateRecord(record) {
  if (!isRecord(record)) throw new NodeAgentError('invalid_journal_record', 'Execution journal record must be an object');
  const type = requiredString(record.type, 'journal record type');
  if (type === 'journal_initialized') {
    assertExactKeys(record, ['type']);
    return { type };
  }

  if (type === 'claim_accepted') {
    assertExactKeys(record, ['type', 'claimId', 'deliveryId', 'workOrderId', 'envelopeHash']);
    return identifiers(record, type, ['envelopeHash']);
  }
  if (type === 'approval_request_recorded') {
    assertExactKeys(record, ['type', 'claimId', 'deliveryId', 'workOrderId', 'envelopeHash', 'requestId', 'approvalRequestHash']);
    return identifiers(record, type, ['envelopeHash', 'requestId', 'approvalRequestHash']);
  }
  if (type === 'approval_decision_consumed' || type === 'executing') {
    assertExactKeys(record, ['type', 'claimId', 'deliveryId', 'workOrderId', 'envelopeHash', 'requestId', 'approvalRequestHash', 'approvalDecisionHash']);
    return identifiers(record, type, ['envelopeHash', 'requestId', 'approvalRequestHash', 'approvalDecisionHash']);
  }
  if (type === 'recovery_abandoned') {
    assertExactKeys(record, [
      'type', 'claimId', 'deliveryId', 'workOrderId', 'envelopeHash',
      'resolutionId', 'operatorActorRef', 'reasonCode',
    ]);
    return recoveryResolution(record, type);
  }
  if (type === 'recovery_retry_authorized') {
    assertExactKeys(record, [
      'type', 'claimId', 'deliveryId', 'workOrderId', 'envelopeHash',
      'resolutionId', 'operatorActorRef', 'reasonCode', 'retryAttemptId',
      'retryIdempotencyKey',
    ]);
    const output = recoveryResolution(record, type);
    output.retryAttemptId = requiredString(record.retryAttemptId, 'retryAttemptId');
    output.retryIdempotencyKey = requiredIdempotencyKey(record.retryIdempotencyKey);
    return output;
  }
  if (type === 'terminal') {
    assertAllowedKeys(record, ['type', 'claimId', 'deliveryId', 'workOrderId', 'terminalState', 'receiptHash', 'reasonCode']);
    const terminalState = requiredString(record.terminalState, 'terminalState');
    if (!TERMINAL_STATES.has(terminalState)) throw new NodeAgentError('invalid_journal_record', 'Execution journal terminal state is invalid');
    /** @type {Record<string, unknown>} */
    const output = identifiers(record, type, []);
    output.terminalState = terminalState;
    if (record.receiptHash !== undefined) output.receiptHash = requiredHash(record.receiptHash, 'receiptHash');
    if (record.reasonCode !== undefined) output.reasonCode = requiredString(record.reasonCode, 'reasonCode');
    if (terminalState === 'completed' && output.receiptHash === undefined) {
      throw new NodeAgentError('invalid_journal_record', 'Completed execution requires a receipt hash');
    }
    return output;
  }
  throw new NodeAgentError('invalid_journal_record', `Unknown execution journal record type: ${type}`);
}

/** @param {Record<string, unknown>} record @param {string} type @param {string[]} extra */
function identifiers(record, type, extra) {
  /** @type {Record<string, unknown>} */
  const output = {
    type,
    claimId: requiredString(record.claimId, 'claimId'),
    deliveryId: requiredString(record.deliveryId, 'deliveryId'),
    workOrderId: requiredString(record.workOrderId, 'workOrderId'),
  };
  for (const key of extra) {
    output[key] = key.endsWith('Hash') ? requiredHash(record[key], key) : requiredString(record[key], key);
  }
  return output;
}

/** @param {Array<Record<string, unknown>>} entries */
function verifyEntries(entries) {
  if (entries.length === 0) throw new NodeAgentError('journal_corrupt', 'Execution journal has no initialization record');
  /** @type {{tenantId: string, nodeId: string}|null} */
  let scope = null;
  /** @type {Map<string, Record<string, unknown>>} */
  const claims = new Map();
  let previousHash = null;

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    try {
      assertAllowedKeys(entry, [
        'version', 'sequence', 'occurredAt', 'tenantId', 'nodeId', 'previousHash', 'hash',
        'type', 'claimId', 'deliveryId', 'workOrderId', 'envelopeHash', 'requestId',
        'approvalRequestHash', 'approvalDecisionHash', 'terminalState', 'receiptHash', 'reasonCode',
        'resolutionId', 'operatorActorRef', 'retryAttemptId', 'retryIdempotencyKey',
      ]);
      if (entry.version !== JOURNAL_VERSION || entry.sequence !== index + 1) throw new Error('version or sequence mismatch');
      if (typeof entry.occurredAt !== 'string' || !Number.isFinite(Date.parse(entry.occurredAt))) throw new Error('invalid timestamp');
      const entryScope = normalizeScope({ tenantId: entry.tenantId, nodeId: entry.nodeId });
      if (!scope) scope = entryScope;
      else assertScope(scope, entryScope);
      if (entry.previousHash !== previousHash) throw new Error('previous hash mismatch');
      const hash = requiredHash(entry.hash, 'hash');
      const { hash: _ignored, ...material } = entry;
      if (sha256Hex(canonicalJson(material)) !== hash) throw new Error('hash mismatch');
      const record = validateRecord(stripEnvelope(entry));
      if (record.type === 'journal_initialized' && index !== 0) throw new Error('initialization record is not first');
      applyTransition(claims, record);
      previousHash = hash;
    } catch (error) {
      if (error instanceof NodeAgentError && error.code === 'journal_scope_mismatch') throw error;
      throw new NodeAgentError('journal_corrupt', `Execution journal record ${index + 1} failed verification`);
    }
  }
  if (!scope || entries[0].type !== 'journal_initialized') {
    throw new NodeAgentError('journal_corrupt', 'Execution journal initialization record is missing');
  }
  return { scope, claims: [...claims.values()].map((claim) => ({ ...claim })) };
}

/** @param {Map<string, Record<string, unknown>>} claims @param {Record<string, unknown>} record */
function applyTransition(claims, record) {
  if (record.type === 'journal_initialized') {
    if (claims.size !== 0) throw new Error('initialization is not first');
    return;
  }
  const claimId = /** @type {string} */ (record.claimId);
  const current = claims.get(claimId);
  if (record.type === 'claim_accepted') {
    if (current) throw new Error('claim already exists');
    claims.set(claimId, { ...record, state: 'claim_accepted' });
    return;
  }
  if (!current) throw new Error('claim is missing');
  assertClaimIdentity(current, record);
  if (current.state === 'terminal' || current.state === 'recovery_abandoned' || current.state === 'recovery_retry_authorized') {
    throw new Error('resolved claim cannot transition');
  }
  const expected = {
    approval_request_recorded: 'claim_accepted',
    approval_decision_consumed: 'approval_request_recorded',
    executing: 'approval_decision_consumed',
  }[/** @type {string} */ (record.type)];
  if (record.type === 'terminal') {
    if (record.terminalState === 'completed' && current.state !== 'executing') throw new Error('completed before executing');
    claims.set(claimId, { ...current, ...record, state: 'terminal' });
    return;
  }
  if (record.type === 'recovery_abandoned' || record.type === 'recovery_retry_authorized') {
    claims.set(claimId, { ...current, ...record, state: record.type });
    return;
  }
  if (!expected || current.state !== expected) throw new Error('invalid claim transition');
  claims.set(claimId, { ...current, ...record, state: record.type });
}

/** @param {Record<string, unknown>} record @param {string} type */
function recoveryResolution(record, type) {
  const output = identifiers(record, type, ['envelopeHash']);
  output.resolutionId = requiredString(record.resolutionId, 'resolutionId');
  output.operatorActorRef = requiredOperatorActor(record.operatorActorRef);
  output.reasonCode = requiredReasonCode(record.reasonCode);
  return output;
}

/** @param {unknown} value */
function requiredOperatorActor(value) {
  const actor = requiredString(value, 'operatorActorRef');
  if (!/^(?:human|account):[A-Za-z0-9._:@/-]+$/.test(actor)) {
    throw new NodeAgentError('invalid_journal_record', 'operatorActorRef must identify a human or account operator');
  }
  return actor;
}

/** @param {unknown} value */
function requiredReasonCode(value) {
  const reason = requiredString(value, 'reasonCode');
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(reason)) {
    throw new NodeAgentError('invalid_journal_record', 'reasonCode must be a safe machine-readable code');
  }
  return reason;
}

/** @param {unknown} value */
function requiredIdempotencyKey(value) {
  const key = requiredString(value, 'retryIdempotencyKey');
  if (key.length < 8 || key.length > 128) {
    throw new NodeAgentError('invalid_journal_record', 'retryIdempotencyKey must be 8 to 128 characters');
  }
  return key;
}

/** @param {Record<string, unknown>} current @param {Record<string, unknown>} next */
function assertClaimIdentity(current, next) {
  for (const key of ['claimId', 'deliveryId', 'workOrderId']) {
    if (current[key] !== next[key]) throw new Error(`${key} changed`);
  }
  for (const key of ['envelopeHash', 'requestId', 'approvalRequestHash', 'approvalDecisionHash']) {
    if (current[key] !== undefined && next[key] !== undefined && current[key] !== next[key]) throw new Error(`${key} changed`);
  }
}

/** @param {{claims: Array<Record<string, unknown>>}} snapshot @param {unknown} claimId */
function claimFromSnapshot(snapshot, claimId) {
  if (typeof claimId !== 'string') return undefined;
  const claim = snapshot.claims.find((candidate) => candidate.claimId === claimId);
  return claim ? { ...claim } : undefined;
}

/** @param {Record<string, unknown>} entry */
function stripEnvelope(entry) {
  const output = { ...entry };
  for (const key of ['version', 'sequence', 'occurredAt', 'tenantId', 'nodeId', 'previousHash', 'hash']) delete output[key];
  return output;
}

/** @param {{tenantId: unknown, nodeId: unknown}} scope */
function normalizeScope(scope) {
  return {
    tenantId: requiredString(scope?.tenantId, 'journal tenantId'),
    nodeId: requiredString(scope?.nodeId, 'journal nodeId'),
  };
}

/** @param {{tenantId: string, nodeId: string}} actual @param {{tenantId: string, nodeId: string}} expected */
function assertScope(actual, expected) {
  if (actual.tenantId !== expected.tenantId || actual.nodeId !== expected.nodeId) {
    throw new NodeAgentError('journal_scope_mismatch', 'Execution journal belongs to a different tenant or node');
  }
}

/** @param {Record<string, unknown>} value @param {string[]} keys */
function assertExactKeys(value, keys) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new NodeAgentError('invalid_journal_record', 'Execution journal record contains missing or unknown fields');
  }
}

/** @param {Record<string, unknown>} value @param {string[]} keys */
function assertAllowedKeys(value, keys) {
  if (Object.keys(value).some((key) => !keys.includes(key))) {
    throw new NodeAgentError('invalid_journal_record', 'Execution journal record contains an unknown field');
  }
}

/** @param {unknown} value @param {string} label */
function requiredString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new NodeAgentError('invalid_journal_record', `${label} must be a non-empty string`);
  return value;
}

/** @param {unknown} value @param {string} label */
function requiredHash(value, label) {
  const hash = requiredString(value, label);
  if (!HASH_PATTERN.test(hash)) throw new NodeAgentError('invalid_journal_record', `${label} must be a SHA-256 digest`);
  return hash;
}

/** @param {unknown} value */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @param {unknown} value @returns {string} */
export function canonicalJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new NodeAgentError('invalid_journal_record', 'Journal values must be finite JSON numbers');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) {
    const record = /** @type {Record<string, unknown>} */ (value);
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  throw new NodeAgentError('invalid_journal_record', 'Journal values must be JSON-compatible');
}

/** @param {string} value */
export function sha256Hex(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** @param {unknown} error */
function journalWriteError(error) {
  return new NodeAgentError('journal_write_failed', `Execution journal durable append failed: ${safeSystemCode(error)}`);
}

/** @param {unknown} error */
function safeSystemCode(error) {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'io_error';
}
