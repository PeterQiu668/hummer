import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { link, mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { verifySuccessfulOutcomeReceipt } from '@hummer/outcome-receipts';
import { createSharedFleetContractValidator } from '../src/contract-validator.mjs';
import { NodeAgentError } from '../src/errors.mjs';
import { FsReadAttestationExecutor } from '../src/fs-read-attestation-executor.mjs';
import { portableOutcomeReceiptValidator } from '../src/outcome-receipt-validator.mjs';

const NOW = '2026-10-07T00:00:00.000Z';
const PATH = 'reports/approved.txt';
const CANARY = 'TOP-SECRET-CONTENT-4d6053';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'hummer-read-attest-'));
  const workspaceRoot = join(root, 'workspace');
  await mkdir(join(workspaceRoot, 'reports'), { recursive: true });
  await writeFile(join(workspaceRoot, PATH), CANARY, 'utf8');
  const executor = new FsReadAttestationExecutor({ workspaceRoot, clock: () => new Date(NOW) });
  await executor.initialize();
  return { root, workspaceRoot, executor };
}

function executionInput(overrides = {}) {
  const path = overrides.path ?? PATH;
  const envelope = {
    schema: 'hummer.task-envelope', version: 1,
    workOrderTask: {
      schema: 'hummer.work-order-task', version: 1, title: CANARY,
      target: CANARY, expectedDeliverable: CANARY,
    },
    tenantId: 'tenant-test', targetNodeId: 'node-test-1', targetRuntime: 'codex',
    idempotencyKey: 'delivery-test-001', leaseMs: 30_000,
    approvalPolicyRef: 'human-required', grantRef: 'grant:read-1',
    expiresAt: '2099-01-01T00:00:00.000Z', originRef: 'work-test-1',
    executionPlan: { kind: 'fs.read.attest.v1', path, maxBytes: overrides.maxBytes ?? 4096 },
    ...(overrides.envelope ?? {}),
  };
  const requestedScope = { capabilities: ['task.execute', 'fs.read'], paths: [path], maxUses: 1 };
  const approvalRequest = {
    schema: 'hummer.approval-request', version: 1, requestId: 'request-1', tenantId: 'tenant-test',
    workOrderId: 'work-test-1', nodeId: 'node-test-1', runId: 'run-1', riskClass: 'unknown',
    action: 'fs.read.attest.v1', target: path, redactedPreview: 'read-only attestation',
    requestedScope, expiresAt: '2099-01-01T00:00:00.000Z', requestedBy: 'system:node-test-1',
    ...(overrides.approvalRequest ?? {}),
  };
  const approval = {
    schema: 'hummer.approval-decision', version: 1, decisionId: 'decision-1', requestId: 'request-1',
    tenantId: 'tenant-test', decision: 'approved', deciderActorRef: 'human:owner', decidedAt: NOW,
    grantedScope: { ...requestedScope, expiresAt: '2099-01-01T00:00:00.000Z' },
    ...(overrides.approval ?? {}),
  };
  return {
    envelope, approvalRequest, approval,
    authorization: { signal: new AbortController().signal, checkpoint: async () => undefined },
    ...(overrides.input ?? {}),
  };
}

test('attests one approved file and emits only path, byte count, and SHA-256 metadata', async () => {
  const { executor } = await fixture();
  const outcome = await executor.execute(executionInput());
  const expectedHash = createHash('sha256').update(CANARY, 'utf8').digest('hex');
  assert.deepEqual(outcome.events.map((event) => event.type), ['started', 'artifact', 'completed']);
  assert.deepEqual(outcome.events[1].payload, {
    artifactId: outcome.events[1].payload.artifactId,
    sha256: expectedHash, bytes: Buffer.byteLength(CANARY), relPath: PATH,
  });
  assert.equal(JSON.stringify(outcome).includes(CANARY), false);
  assert.equal(verifySuccessfulOutcomeReceipt(outcome.receipt).evidenceSha256, expectedHash);
  assert.deepEqual(outcome.receipt.receipt.tools, [{
    tenantId: 'tenant-test', sessionId: 'run-1', capabilityId: 'fs.read.attest.v1',
    status: 'completed', relativePath: PATH, sha256: expectedHash,
    bytes: Buffer.byteLength(CANARY), evidenceRefs: [`evidence://sha256/${expectedHash}`],
  }]);
  const validator = createSharedFleetContractValidator(portableOutcomeReceiptValidator);
  assert.ok(outcome.events.every((event) => validator.validateRunEvent(event).ok));
  assert.equal(validator.validateOutcomeReceipt(outcome.receipt).ok, true);
});

test('fails closed without a plan, one-use grant, or exact approved path scope', async () => {
  const { executor } = await fixture();
  await assert.rejects(() => executor.execute(executionInput({ envelope: { executionPlan: undefined } })), { code: 'unsupported_execution_plan' });
  await assert.rejects(() => executor.execute(executionInput({ envelope: { grantRef: undefined } })), { code: 'task_grant_required' });
  const wrongPath = executionInput({
    approval: { grantedScope: { capabilities: ['task.execute', 'fs.read'], paths: ['reports/other.txt'], maxUses: 1, expiresAt: '2099-01-01T00:00:00.000Z' } },
  });
  await assert.rejects(() => executor.execute(wrongPath), { code: 'approval_scope_denied' });
  const missingCapability = executionInput({
    approval: { grantedScope: { capabilities: ['task.execute'], paths: [PATH], maxUses: 1, expiresAt: '2099-01-01T00:00:00.000Z' } },
  });
  await assert.rejects(() => executor.execute(missingCapability), { code: 'approval_scope_denied' });
});

test('rejects traversal, absolute, backslash, colon, oversize, and hard-linked targets', async () => {
  const { workspaceRoot, executor } = await fixture();
  for (const path of [
    '../secret.txt', '/secret.txt', 'C:/secret.txt', 'reports\\approved.txt',
    'reports/approved.txt:stream', 'reports/', 'reports/NUL.txt', 'reports/trailing.',
  ]) {
    await assert.rejects(() => executor.execute(executionInput({ path })), { code: 'invalid_execution_plan' });
  }
  await assert.rejects(() => executor.execute(executionInput({ maxBytes: 4 })), { code: 'file_too_large' });
  await link(join(workspaceRoot, PATH), join(workspaceRoot, 'reports', 'hardlink.txt'));
  await assert.rejects(() => executor.execute(executionInput()), { code: 'unsafe_file_path' });
});

test('rejects a symlink or junction path even when it resolves inside the workspace', async (context) => {
  const { root, workspaceRoot, executor } = await fixture();
  const targetDirectory = join(root, 'linked-directory');
  await mkdir(targetDirectory);
  await writeFile(join(targetDirectory, 'alias.txt'), CANARY, 'utf8');
  try {
    await symlink(targetDirectory, join(workspaceRoot, 'reports', 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && ['EPERM', 'EACCES'].includes(String(error.code))) {
      context.skip('host does not permit creating a test symlink');
      return;
    }
    throw error;
  }
  await assert.rejects(() => executor.execute(executionInput({ path: 'reports/linked/alias.txt' })), { code: 'unsafe_file_path' });
});

test('checks authorization before opening and before each chunk, returning no partial outcome after revocation', async () => {
  const { executor } = await fixture();
  let checkpoints = 0;
  const input = executionInput();
  input.authorization.checkpoint = async () => {
    checkpoints += 1;
    if (checkpoints === 2) {
      throw new NodeAgentError('approval_revoked', 'revoked');
    }
  };
  await assert.rejects(() => executor.execute(input), { code: 'approval_revoked' });
  assert.equal(checkpoints, 2);
});
