import { open, lstat, mkdir, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

import { canonicalJson, verifySuccessfulOutcomeReceipt } from '@hummer/outcome-receipts';
import { NodeAgentError } from './errors.mjs';

const MARKER = '.hummer-node-receipt-root.json';
const MAX_RECEIPT_BYTES = 2 * 1024 * 1024;

export class FileOutcomeReceiptStore {
  /** @type {string} */ #root;
  /** @type {string} */ #tenantId;
  /** @type {string} */ #nodeId;
  /** @type {Promise<void>|null} */ #initialization = null;

  /** @param {{root: string, tenantId: string, nodeId: string}} options */
  constructor(options) {
    if (!options || typeof options !== 'object' || !isAbsolute(options.root)) {
      throw new NodeAgentError('invalid_receipt_store', 'Receipt root must be an absolute path');
    }
    if (!safeId(options.tenantId) || !safeId(options.nodeId)) {
      throw new NodeAgentError('invalid_receipt_store', 'Receipt store tenant and node identifiers are invalid');
    }
    this.#root = resolve(options.root);
    this.#tenantId = options.tenantId;
    this.#nodeId = options.nodeId;
  }

  async initialize() {
    if (!this.#initialization) this.#initialization = this.#initializeOnce();
    return this.#initialization;
  }

  /** @param {unknown} value */
  async put(value) {
    let verified;
    try {
      verified = verifySuccessfulOutcomeReceipt(value);
    } catch {
      throw new NodeAgentError('invalid_outcome_receipt', 'Outcome receipt failed portable verification');
    }
    if (verified.tenantId !== this.#tenantId) {
      throw new NodeAgentError('receipt_scope_mismatch', 'Outcome receipt is not bound to this receipt store');
    }
    await this.initialize();
    await this.#assertSafeRoot();
    const text = `${canonicalJson(value)}\n`;
    if (Buffer.byteLength(text, 'utf8') > MAX_RECEIPT_BYTES) {
      throw new NodeAgentError('receipt_too_large', 'Outcome receipt exceeds the local persistence limit');
    }
    const path = join(this.#root, `${verified.rootHash}.json`);
    let handle;
    try {
      handle = await open(path, 'wx', 0o600);
      await handle.writeFile(text, 'utf8');
      await handle.sync();
    } catch (error) {
      const code = errorCode(error);
      throw new NodeAgentError(
        code === 'EEXIST' ? 'receipt_exists' : 'receipt_write_failed',
        code === 'EEXIST' ? 'Outcome receipt already exists' : 'Outcome receipt could not be persisted',
      );
    } finally {
      await handle?.close().catch(() => undefined);
    }
    return Object.freeze({ rootHash: verified.rootHash, path });
  }

  async #initializeOnce() {
    await mkdir(this.#root, { recursive: true, mode: 0o700 });
    await this.#assertSafeRoot();
    const markerPath = join(this.#root, MARKER);
    const marker = {
      schema: 'hummer.node-receipt-root', version: 1,
      tenantId: this.#tenantId, nodeId: this.#nodeId,
    };
    try {
      const handle = await open(markerPath, 'wx', 0o600);
      try {
        await handle.writeFile(`${canonicalJson(marker)}\n`, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') {
        throw new NodeAgentError('receipt_store_init_failed', 'Receipt store marker could not be created');
      }
      let existing;
      try {
        const markerStats = await lstat(markerPath);
        if (!markerStats.isFile() || markerStats.isSymbolicLink()
          || normalizePath(await realpath(markerPath)) !== normalizePath(markerPath)) {
          throw new Error('unsafe marker');
        }
        existing = JSON.parse(await readFile(markerPath, 'utf8'));
      } catch {
        throw new NodeAgentError('receipt_store_scope_mismatch', 'Receipt store marker is invalid');
      }
      if (!existing || typeof existing !== 'object' || Array.isArray(existing)
        || Object.keys(existing).sort().join(',') !== 'nodeId,schema,tenantId,version'
        || existing.schema !== marker.schema || existing.version !== marker.version
        || existing.tenantId !== marker.tenantId || existing.nodeId !== marker.nodeId) {
        throw new NodeAgentError('receipt_store_scope_mismatch', 'Receipt store belongs to another tenant or node');
      }
    }
  }

  async #assertSafeRoot() {
    const stats = await lstat(this.#root);
    const actual = await realpath(this.#root);
    if (!stats.isDirectory() || stats.isSymbolicLink() || normalizePath(actual) !== normalizePath(this.#root)) {
      throw new NodeAgentError('unsafe_receipt_root', 'Receipt root must be a real node-owned directory');
    }
  }
}

/** @param {unknown} value */
function errorCode(value) {
  return value && typeof value === 'object' && 'code' in value ? String(value.code) : '';
}

/** @param {string} value */
function safeId(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]+$/u.test(value); }

/** @param {string} value */
function normalizePath(value) {
  const normalized = resolve(value).replace(/[\\/]+$/u, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}
