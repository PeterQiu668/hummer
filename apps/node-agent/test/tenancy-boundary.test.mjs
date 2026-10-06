import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { FileExecutionJournal, MemoryExecutionJournal } from '../src/execution-journal.mjs';
import { HummerNodeAgent } from '../src/node-agent.mjs';

const NOW = '2026-10-07T00:00:00.000Z';
const NODE = 'node-shared';
const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

const manifest = (tenantIds, nodeId = NODE) => ({
  schema: 'hummer.node-manifest', version: 1, nodeId, tenantIds,
  platform: 'win32', agentVersion: '0.1.0',
  runtimes: [{ kind: 'codex', available: true, pinnedVersion: '0.153.4' }],
  capabilities: ['workspace.exec'],
  mcp: { endpoint: 'stdio://hummer-local', tools: ['workspace_exec'] },
  load: { running: 0, queued: 0 },
});

const envelope = (tenantId, workOrderId = 'work-shared') => ({
  schema: 'hummer.task-envelope', version: 1,
  workOrderTask: {
    schema: 'hummer.work-order-task', version: 1,
    title: 'Prepare report', target: 'Prepare a report', expectedDeliverable: 'outputs/report.md',
  },
  tenantId, targetNodeId: NODE, targetRuntime: 'codex',
  idempotencyKey: 'delivery-shared', leaseMs: 30_000,
  approvalPolicyRef: 'policy-deny-by-default', expiresAt: '2026-10-07T01:00:00Z',
  originRef: workOrderId,
});

const approvalRequest = (tenantId, workOrderId = 'work-shared') => ({
  schema: 'hummer.approval-request', version: 1, requestId: 'request-shared',
  tenantId, workOrderId, nodeId: NODE, runId: 'run-shared', riskClass: 'write',
  action: 'task.execute', target: 'claim-shared', redactedPreview: 'safe preview',
  requestedScope: { capabilities: ['task.execute'], paths: ['outputs/report.md'], maxUses: 1 },
  expiresAt: '2026-10-07T01:00:00Z', requestedBy: `system:${NODE}`,
});

const approvalDecision = (tenantId) => ({
  schema: 'hummer.approval-decision', version: 1, decisionId: 'decision-shared',
  requestId: 'request-shared', tenantId, deciderActorRef: 'human:owner',
  decidedAt: NOW, decision: 'approved',
  grantedScope: {
    capabilities: ['task.execute'], paths: ['outputs/report.md'], maxUses: 1,
    expiresAt: '2026-10-07T00:30:00Z',
  },
});

const runEvent = (tenantId, workOrderId = 'work-shared') => ({
  schema: 'hummer.run-event', version: 1, eventId: 'event-shared',
  tenantId, workOrderId, nodeId: NODE, seq: 1, occurredAt: NOW,
  type: 'started', actorRef: 'employee:worker', payload: { runId: 'run-shared' },
  idempotencyKey: 'event-shared',
});

const receipt = (tenantId, workOrderId = 'work-shared') => ({
  schema: 'hummer.outcome-receipt', version: 1,
  receipt: { tenantId, outcome: { workOrderId } },
  domainEvents: [],
  manifest: { algorithm: 'SHA-256', rootHash: 'a'.repeat(64), fieldHashes: {} },
});

function createHarness({
  tenantId = TENANT_A,
  nodeId = NODE,
  journal = new MemoryExecutionJournal({ clock: () => new Date(NOW) }),
  claims,
  executor,
} = {}) {
  const calls = { heartbeats: [], statuses: [], events: [], receipts: [], executions: [], contexts: [] };
  const queue = claims ?? [{ claimId: 'claim-shared', deliveryId: 'delivery-shared', envelope: envelope(tenantId) }];
  let persistedRequest;
  const transport = {
    sendHeartbeat: async (value, context) => { calls.heartbeats.push(value); calls.contexts.push(context); },
    claimTask: async (context) => { calls.contexts.push(context); return queue.shift() ?? null; },
    reportClaimStatus: async (value, context) => { calls.statuses.push(value); calls.contexts.push(context); },
    submitRunEvent: async (value, context) => { calls.events.push(value); calls.contexts.push(context); },
    submitReceipt: async (value, context) => { calls.receipts.push(value); calls.contexts.push(context); },
    submitApprovalRequest: async (_claimId, value, context) => {
      persistedRequest = value;
      calls.contexts.push(context);
      return value;
    },
    consumeApprovalDecision: async (_claimId, _requestId, context) => {
      calls.contexts.push(context);
      return { request: persistedRequest, decision: approvalDecision(tenantId) };
    },
  };
  const contractValidator = {
    validateNodeManifest: (value) => ({ ok: true, value }),
    validateTaskEnvelope: (value) => ({ ok: true, value }),
    validateApprovalRequest: (value) => ({ ok: true, value }),
    validateApprovalDecision: (value) => ({ ok: true, value }),
    validateRunEvent: (value) => ({ ok: true, value }),
    validateOutcomeReceipt: (value) => ({ ok: true, value }),
  };
  const taskExecutor = executor ?? {
    execute: async () => {
      calls.executions.push(tenantId);
      return { events: [runEvent(tenantId)], receipt: receipt(tenantId) };
    },
  };
  const agent = new HummerNodeAgent({
    nodeId,
    tenantId,
    heartbeatIntervalMs: 20_000,
    grant: {
      token: `private-token-${tenantId}`,
      nodeId,
      tenantId,
      expiresAt: '2026-10-07T01:00:00.000Z',
      scopes: ['node.heartbeat', 'task.claim', 'approval.request', 'task.execute'],
    },
    transport,
    contractValidator,
    executor: taskExecutor,
    journal,
    clock: () => new Date(NOW),
  });
  return { agent, calls, journal };
}

async function stage(agent, tenantId = TENANT_A) {
  assert.deepEqual(await agent.pollOnce(), { state: 'pending_confirmation', claimId: 'claim-shared' });
  assert.deepEqual(await agent.requestApproval('claim-shared', approvalRequest(tenantId)), {
    state: 'awaiting_approval', claimId: 'claim-shared', requestId: 'request-shared',
  });
}

async function expectScopeMismatch(operation, code) {
  let failure;
  try {
    await operation();
  } catch (error) {
    failure = error;
  }
  assert.equal(failure?.code, code);
  assert.doesNotMatch(String(failure), /tenant-b|node-other|work-other|opaque:foreign/);
  return failure.message;
}

test('[TEN-P0F-NODE-AGENT-BOUNDARY] default node rejects foreign or multi-tenant manifests locally', async () => {
  const { agent, calls } = createHarness();

  await agent.heartbeatOnce(manifest([TENANT_A]));
  const failures = [];
  failures.push(await expectScopeMismatch(() => agent.heartbeatOnce(manifest([TENANT_B])), 'node_manifest_scope_mismatch'));
  failures.push(await expectScopeMismatch(() => agent.heartbeatOnce(manifest([TENANT_A, TENANT_B])), 'node_manifest_scope_mismatch'));
  failures.push(await expectScopeMismatch(() => agent.heartbeatOnce(manifest([TENANT_A], 'node-other')), 'node_manifest_scope_mismatch'));
  assert.equal(new Set(failures).size, 1);
  assert.equal(calls.heartbeats.length, 1);
  assert.deepEqual(calls.heartbeats[0].tenantIds, [TENANT_A]);
});

test('[TEN-P0F-NODE-AGENT-BOUNDARY] rejects misbound run events before any output leaves the node', async () => {
  const foreignEvents = [
    runEvent(TENANT_B),
    { ...runEvent(TENANT_A), nodeId: 'node-other' },
    runEvent(TENANT_A, 'work-other'),
  ];
  const failures = [];
  for (const foreignEvent of foreignEvents) {
    const harness = createHarness({
      executor: {
        execute: async () => {
          harness.calls.executions.push(TENANT_A);
          return { events: [foreignEvent], receipt: receipt(TENANT_A) };
        },
      },
    });
    await stage(harness.agent);

    failures.push(await expectScopeMismatch(() => harness.agent.confirmAndExecute('claim-shared'), 'execution_scope_mismatch'));
    assert.equal(harness.calls.events.length, 0);
    assert.equal(harness.calls.receipts.length, 0);
  }
  assert.equal(new Set(failures).size, 1);
});

test('[TEN-P0F-NODE-AGENT-BOUNDARY] rejects a misbound receipt before events or receipt are submitted', async () => {
  const foreignReceipts = [receipt(TENANT_B), receipt(TENANT_A, 'work-other')];
  const failures = [];
  for (const foreignReceipt of foreignReceipts) {
    const harness = createHarness({
      executor: {
        execute: async () => {
          harness.calls.executions.push(TENANT_A);
          return { events: [runEvent(TENANT_A)], receipt: foreignReceipt };
        },
      },
    });
    await stage(harness.agent);

    failures.push(await expectScopeMismatch(() => harness.agent.confirmAndExecute('claim-shared'), 'execution_scope_mismatch'));
    assert.equal(harness.calls.events.length, 0);
    assert.equal(harness.calls.receipts.length, 0);
  }
  assert.equal(new Set(failures).size, 1);
});

test('[TEN-P0F-NODE-AGENT-BOUNDARY] rejects a receipt with an embedded foreign tenant fact before any output', async () => {
  const harness = createHarness({
    executor: {
      execute: async () => {
        harness.calls.executions.push(TENANT_A);
        const output = receipt(TENANT_A);
        output.receipt.artifacts = [{ tenantId: TENANT_B, ref: 'opaque:foreign' }];
        return { events: [runEvent(TENANT_A)], receipt: output };
      },
    },
  });
  await stage(harness.agent);

  await expectScopeMismatch(() => harness.agent.confirmAndExecute('claim-shared'), 'execution_scope_mismatch');
  assert.equal(harness.calls.events.length, 0);
  assert.equal(harness.calls.receipts.length, 0);
});

test('[TEN-P0F-NODE-AGENT-BOUNDARY] same-process tenant agents isolate claim caches, grants and journals', async () => {
  const tenantA = createHarness({ tenantId: TENANT_A });
  const tenantB = createHarness({ tenantId: TENANT_B });

  assert.deepEqual(await tenantA.agent.pollOnce(), { state: 'pending_confirmation', claimId: 'claim-shared' });
  assert.deepEqual(await tenantB.agent.pollOnce(), { state: 'pending_confirmation', claimId: 'claim-shared' });
  assert.deepEqual(tenantA.agent.stopClaim('claim-shared'), { state: 'stopped', claimId: 'claim-shared' });
  assert.deepEqual(await tenantB.agent.requestApproval('claim-shared', approvalRequest(TENANT_B)), {
    state: 'awaiting_approval', claimId: 'claim-shared', requestId: 'request-shared',
  });
  assert.ok(tenantA.calls.contexts.every((context) => context.tenantId === TENANT_A && context.grantToken === `private-token-${TENANT_A}`));
  assert.ok(tenantB.calls.contexts.every((context) => context.tenantId === TENANT_B && context.grantToken === `private-token-${TENANT_B}`));

  assert.throws(() => new HummerNodeAgent({
    nodeId: NODE,
    tenantId: TENANT_B,
    heartbeatIntervalMs: 20_000,
    grant: {
      token: 'private-token-a', nodeId: NODE, tenantId: TENANT_A,
      expiresAt: '2026-10-07T01:00:00.000Z', scopes: ['task.claim'],
    },
    transport: {}, contractValidator: {}, executor: {}, journal: new MemoryExecutionJournal(),
  }), { code: 'grant_scope_mismatch' });
});

test('[TEN-P0F-NODE-AGENT-BOUNDARY] file restart refuses cross-scope recovery without leaking tenant records or tokens', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'hummer-p0f-'));
  const path = join(directory, 'tenant-a', 'execution.jsonl');
  const first = createHarness({
    tenantId: TENANT_A,
    journal: new FileExecutionJournal({ path, clock: () => new Date(NOW) }),
  });
  await first.agent.pollOnce();
  const journalText = readFileSync(path, 'utf8');
  assert.doesNotMatch(journalText, /private-token|expectedDeliverable|outputs\/report\.md|hummer\.task-envelope/);

  let tenantError;
  try {
    createHarness({
      tenantId: TENANT_B,
      journal: new FileExecutionJournal({ path, clock: () => new Date(NOW) }),
    });
  } catch (error) {
    tenantError = error;
  }
  let nodeError;
  try {
    createHarness({
      tenantId: TENANT_A,
      nodeId: 'node-other',
      journal: new FileExecutionJournal({ path, clock: () => new Date(NOW) }),
    });
  } catch (error) {
    nodeError = error;
  }
  assert.equal(tenantError?.code, 'journal_scope_mismatch');
  assert.equal(nodeError?.code, 'journal_scope_mismatch');
  assert.equal(tenantError?.message, nodeError?.message);
  assert.doesNotMatch(String(tenantError), /tenant-a|claim-shared|work-shared|private-token/);
});
