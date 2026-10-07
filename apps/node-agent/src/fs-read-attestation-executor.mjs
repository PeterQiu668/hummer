import { constants, open, lstat, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import { canonicalJson, hashLeaves } from '@hummer/outcome-receipts';
import { NodeAgentError } from './errors.mjs';
import { assertExactRecord, isRecord, requireNonEmptyString } from './validation.mjs';

const MAX_READ_BYTES = 1024 * 1024;
const CHUNK_BYTES = 64 * 1024;
const SAFE_RELATIVE_PATH = /^(?![A-Za-z]:)(?!\/)(?!.*:)(?!.*[\x00-\x1F\x7F])(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*\/\/)(?!.*\\)(?!.*\/$).+$/u;
const WINDOWS_DEVICE_SEGMENT = /^(?:con|prn|aux|nul|clock\$|com[1-9]|lpt[1-9])(?:\..*)?$/iu;

export class FsReadAttestationExecutor {
  /** @type {string} */ #workspaceRoot;
  /** @type {string|null} */ #canonicalRoot = null;
  /** @type {() => Date} */ #clock;

  /** @param {{workspaceRoot: string, clock?: () => Date}} options */
  constructor(options) {
    if (!options || typeof options !== 'object' || !isAbsolute(options.workspaceRoot)) {
      throw new NodeAgentError('invalid_workspace_root', 'Workspace root must be an absolute path');
    }
    this.#workspaceRoot = resolve(options.workspaceRoot);
    this.#clock = options.clock ?? (() => new Date());
  }

  async initialize() {
    const stats = await safeLstat(this.#workspaceRoot, 'unsafe_workspace_root');
    const canonical = await safeRealpath(this.#workspaceRoot, 'unsafe_workspace_root');
    if (!stats.isDirectory() || stats.isSymbolicLink() || normalizePath(canonical) !== normalizePath(this.#workspaceRoot)) {
      throw new NodeAgentError('unsafe_workspace_root', 'Workspace root must be a real local directory');
    }
    this.#canonicalRoot = canonical;
  }

  /**
   * @param {{envelope: unknown, approvalRequest: unknown, approval: unknown,
   * authorization: {signal: AbortSignal, checkpoint: () => Promise<void>}}} input
   */
  async execute(input) {
    if (!this.#canonicalRoot) throw new NodeAgentError('executor_not_initialized', 'Read attestation executor is not initialized');
    const envelope = assertExactRecord(input.envelope, [
      'schema', 'version', 'workOrderTask', 'tenantId', 'targetNodeId', 'targetRuntime',
      'idempotencyKey', 'leaseMs', 'approvalPolicyRef', 'grantRef', 'expiresAt', 'originRef',
      'capabilityRef', 'executionPlan',
    ], 'invalid_task_envelope', 'TaskEnvelope');
    const plan = parsePlan(envelope.executionPlan);
    const grantRef = requireNonEmptyString(envelope.grantRef, 'task_grant_required', 'TaskEnvelope grantRef');
    void grantRef;
    const tenantId = requireNonEmptyString(envelope.tenantId, 'invalid_task_envelope', 'TaskEnvelope tenantId');
    const nodeId = requireNonEmptyString(envelope.targetNodeId, 'invalid_task_envelope', 'TaskEnvelope targetNodeId');
    const workOrderId = requireNonEmptyString(envelope.originRef, 'invalid_task_envelope', 'TaskEnvelope originRef');
    requireNonEmptyString(envelope.idempotencyKey, 'invalid_task_envelope', 'TaskEnvelope idempotencyKey');
    const request = parseApprovalRequest(input.approvalRequest, plan.path);
    const approval = parseApproval(input.approval, request.requestId, tenantId, plan.path);
    if (input.authorization.signal.aborted) throw abortReason(input.authorization.signal);

    const target = await this.#resolveSafeTarget(plan.path);
    await input.authorization.checkpoint();
    if (input.authorization.signal.aborted) throw abortReason(input.authorization.signal);

    const before = await safeLstat(target, 'file_read_denied');
    assertSafeFile(before, plan.maxBytes);
    let handle;
    try {
      handle = await open(target, constants.O_RDONLY);
      const opened = await handle.stat();
      assertSafeFile(opened, plan.maxBytes);
      assertSameFile(before, opened);
      const hash = createHash('sha256');
      const buffer = Buffer.allocUnsafe(Math.min(CHUNK_BYTES, plan.maxBytes));
      let bytes = 0;
      while (true) {
        await input.authorization.checkpoint();
        if (input.authorization.signal.aborted) throw abortReason(input.authorization.signal);
        const remaining = plan.maxBytes - bytes;
        if (remaining <= 0) {
          const probe = Buffer.allocUnsafe(1);
          const extra = await handle.read(probe, 0, 1, bytes);
          if (extra.bytesRead > 0) throw new NodeAgentError('file_too_large', 'Approved file exceeds the read limit');
          break;
        }
        const result = await handle.read(buffer, 0, Math.min(buffer.byteLength, remaining), bytes);
        if (result.bytesRead === 0) break;
        hash.update(buffer.subarray(0, result.bytesRead));
        bytes += result.bytesRead;
      }
      const after = await handle.stat();
      assertSameFile(opened, after);
      if (after.size !== bytes || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
        throw new NodeAgentError('file_changed_during_read', 'Approved file changed during attestation');
      }
      const sha256 = hash.digest('hex');
      return buildOutcome({
        tenantId, nodeId, workOrderId, path: plan.path, bytes, sha256,
        runId: request.runId, decisionId: approval.decisionId,
        acceptedBy: approval.deciderActorRef, occurredAt: this.#clock().toISOString(),
      });
    } catch (error) {
      if (error instanceof NodeAgentError) throw error;
      throw new NodeAgentError('file_read_failed', 'Approved file could not be read safely');
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  /** @param {string} approvedPath */
  async #resolveSafeTarget(approvedPath) {
    const segments = approvedPath.split('/');
    const target = resolve(this.#workspaceRoot, ...segments);
    const lexical = relative(this.#workspaceRoot, target);
    if (!lexical || lexical.startsWith(`..${sep}`) || lexical === '..' || isAbsolute(lexical)) {
      throw new NodeAgentError('path_outside_workspace', 'Approved path is outside the workspace root');
    }
    let cursor = this.#workspaceRoot;
    for (const segment of segments) {
      cursor = resolve(cursor, segment);
      const stats = await safeLstat(cursor, 'file_read_denied');
      if (stats.isSymbolicLink()) throw new NodeAgentError('unsafe_file_path', 'Approved path contains a symbolic link or reparse point');
    }
    const canonicalTarget = await safeRealpath(target, 'file_read_denied');
    const canonicalRelative = relative(/** @type {string} */ (this.#canonicalRoot), canonicalTarget);
    if (!canonicalRelative || canonicalRelative.startsWith(`..${sep}`) || canonicalRelative === '..' || isAbsolute(canonicalRelative)) {
      throw new NodeAgentError('path_outside_workspace', 'Approved path resolves outside the workspace root');
    }
    if (normalizePath(canonicalTarget) !== normalizePath(target)) {
      throw new NodeAgentError('unsafe_file_path', 'Approved path must not resolve through an alias');
    }
    return target;
  }
}

/** @param {unknown} value */
function parsePlan(value) {
  const plan = assertExactRecord(value, ['kind', 'path', 'maxBytes'], 'unsupported_execution_plan', 'execution plan');
  if (plan.kind !== 'fs.read.attest.v1') throw new NodeAgentError('unsupported_execution_plan', 'Execution plan kind is not enabled');
  const path = requireNonEmptyString(plan.path, 'invalid_execution_plan', 'execution plan path');
  const segments = path.split('/');
  if (!SAFE_RELATIVE_PATH.test(path)
    || segments.some((segment) => /[. ]$/u.test(segment) || WINDOWS_DEVICE_SEGMENT.test(segment))) {
    throw new NodeAgentError('invalid_execution_plan', 'Execution plan path must be a strict portable relative path');
  }
  if (!Number.isInteger(plan.maxBytes) || Number(plan.maxBytes) < 1 || Number(plan.maxBytes) > MAX_READ_BYTES) {
    throw new NodeAgentError('invalid_execution_plan', `Execution plan maxBytes must be between 1 and ${MAX_READ_BYTES}`);
  }
  return { kind: plan.kind, path, maxBytes: Number(plan.maxBytes) };
}

/** @param {unknown} value @param {string} path */
function parseApprovalRequest(value, path) {
  if (!isRecord(value) || !isRecord(value.requestedScope)) throw new NodeAgentError('invalid_approval_request', 'Approval request is invalid');
  const capabilities = value.requestedScope.capabilities;
  const paths = value.requestedScope.paths;
  if (!Array.isArray(capabilities) || capabilities.length !== 2
    || !capabilities.includes('task.execute') || !capabilities.includes('fs.read')
    || !Array.isArray(paths) || paths.length !== 1 || paths[0] !== path || value.requestedScope.maxUses !== 1) {
    throw new NodeAgentError('approval_scope_denied', 'Approval request does not exactly bind the read plan');
  }
  return {
    requestId: requireNonEmptyString(value.requestId, 'invalid_approval_request', 'ApprovalRequest requestId'),
    runId: requireNonEmptyString(value.runId, 'invalid_approval_request', 'ApprovalRequest runId'),
  };
}

/** @param {unknown} value @param {string} requestId @param {string} tenantId @param {string} path */
function parseApproval(value, requestId, tenantId, path) {
  if (!isRecord(value) || !isRecord(value.grantedScope) || value.decision !== 'approved'
    || value.requestId !== requestId || value.tenantId !== tenantId) {
    throw new NodeAgentError('approval_not_authorized', 'Approval decision is not bound to the read plan');
  }
  const capabilities = value.grantedScope.capabilities;
  const paths = value.grantedScope.paths;
  if (!Array.isArray(capabilities) || capabilities.length !== 2
    || !capabilities.includes('task.execute') || !capabilities.includes('fs.read')
    || !Array.isArray(paths) || paths.length !== 1 || paths[0] !== path || value.grantedScope.maxUses !== 1) {
    throw new NodeAgentError('approval_scope_denied', 'Approved scope does not exactly bind the read plan');
  }
  return {
    decisionId: requireNonEmptyString(value.decisionId, 'approval_not_authorized', 'ApprovalDecision decisionId'),
    deciderActorRef: requireNonEmptyString(value.deciderActorRef, 'approval_not_authorized', 'ApprovalDecision deciderActorRef'),
  };
}

/** @param {import('node:fs').Stats} stats @param {number} maxBytes */
function assertSafeFile(stats, maxBytes) {
  if (!stats.isFile() || stats.isSymbolicLink()) throw new NodeAgentError('unsafe_file_path', 'Approved path must identify a regular file');
  if (stats.nlink !== 1) throw new NodeAgentError('unsafe_file_path', 'Hard-linked files are not eligible for attestation');
  if (stats.size > maxBytes) throw new NodeAgentError('file_too_large', 'Approved file exceeds the read limit');
}

/** @param {import('node:fs').Stats} first @param {import('node:fs').Stats} second */
function assertSameFile(first, second) {
  if (first.dev !== second.dev || first.ino !== second.ino || first.nlink !== second.nlink) {
    throw new NodeAgentError('file_changed_during_read', 'Approved file identity changed during attestation');
  }
}

/** @param {AbortSignal} signal */
function abortReason(signal) {
  return signal.reason instanceof NodeAgentError
    ? signal.reason
    : new NodeAgentError('relay_stop', 'Read attestation was stopped');
}

/** @param {string} path @param {string} code */
async function safeLstat(path, code) {
  try { return await lstat(path); } catch { throw new NodeAgentError(code, 'Approved local path is unavailable'); }
}

/** @param {string} path @param {string} code */
async function safeRealpath(path, code) {
  try { return await realpath(path); } catch { throw new NodeAgentError(code, 'Approved local path cannot be resolved safely'); }
}

/** @param {string} value */
function normalizePath(value) {
  const normalized = resolve(value).replace(/[\\/]+$/u, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

/** @param {{tenantId: string, nodeId: string, workOrderId: string, path: string,
 * bytes: number, sha256: string, runId: string, decisionId: string,
 * acceptedBy: string, occurredAt: string}} input */
function buildOutcome(input) {
  const suffix = createHash('sha256').update(canonicalJson({
    tenantId: input.tenantId, nodeId: input.nodeId, workOrderId: input.workOrderId,
    runId: input.runId, path: input.path, sha256: input.sha256,
  }), 'utf8').digest('hex').slice(0, 32);
  const evidenceRef = `evidence://sha256/${input.sha256}`;
  const outcomeId = `outcome-${suffix}`;
  const definitionId = 'definition-fs-read-attest-v1';
  const payload = {
    verdict: 'accepted', workOrderId: input.workOrderId, sessionId: input.runId,
    evidenceRef, outcomeDefinitionId: definitionId,
    relativePath: input.path, sha256: input.sha256, bytes: input.bytes,
  };
  const eventMaterial = {
    actorRef: `system:${input.nodeId}`, aggregateId: outcomeId, aggregateType: 'outcome_event',
    aggregateVersion: 1, correlationId: input.workOrderId, id: `ledger-${suffix}`,
    occurredAt: input.occurredAt, payload, previousHash: null, tenantId: input.tenantId,
    type: 'outcome.accepted',
  };
  const domainEvent = {
    ...eventMaterial, position: 1, canonicalPayload: canonicalJson(payload),
    hash: createHash('sha256').update(canonicalJson(eventMaterial), 'utf8').digest('hex'),
  };
  const receiptBody = {
    generatedAt: input.occurredAt,
    tenantId: input.tenantId,
    outcome: {
      id: outcomeId, tenantId: input.tenantId, outcomeDefinitionId: definitionId,
      workOrderId: input.workOrderId, sessionId: input.runId, approvalId: input.decisionId,
      verdict: 'accepted', acceptedBy: input.acceptedBy, evidenceRef, occurredAt: input.occurredAt,
    },
    definition: {
      id: definitionId, tenantId: input.tenantId, actionPattern: 'fs.read.attest.v1',
      title: 'Read-only file attestation', acceptanceCriteria: 'Approved path SHA-256 and byte count are bound to the receipt',
      unitPriceCny: null, riskLevel: 'low', enabled: true,
      createdAt: input.occurredAt, updatedAt: input.occurredAt,
    },
    costs: [],
    tools: [{
      tenantId: input.tenantId, sessionId: input.runId, capabilityId: 'fs.read.attest.v1',
      status: 'completed', relativePath: input.path, sha256: input.sha256,
      bytes: input.bytes, evidenceRefs: [evidenceRef],
    }],
    totalCostCny: 0, approval: null,
    chainIntegrity: { valid: true, checked: 1 },
  };
  const content = { receipt: receiptBody, domainEvents: [domainEvent] };
  const receipt = {
    schema: 'hummer.outcome-receipt', version: 1, ...content,
    manifest: {
      algorithm: 'SHA-256',
      rootHash: createHash('sha256').update(canonicalJson(content), 'utf8').digest('hex'),
      fieldHashes: hashLeaves(content),
    },
  };
  const common = {
    schema: 'hummer.run-event', version: 1, tenantId: input.tenantId,
    workOrderId: input.workOrderId, nodeId: input.nodeId, occurredAt: input.occurredAt,
    actorRef: `system:${input.nodeId}`,
  };
  return {
    events: [
      { ...common, eventId: `started-${suffix}`, seq: 1, type: 'started', payload: { runId: input.runId }, idempotencyKey: `event-${suffix}-1` },
      { ...common, eventId: `artifact-${suffix}`, seq: 2, type: 'artifact', payload: { artifactId: `attestation-${suffix}`, sha256: input.sha256, bytes: input.bytes, relPath: input.path }, idempotencyKey: `event-${suffix}-2` },
      { ...common, eventId: `completed-${suffix}`, seq: 3, type: 'completed', payload: { summary: 'Read-only SHA-256 attestation completed.' }, idempotencyKey: `event-${suffix}-3` },
    ],
    receipt,
  };
}
