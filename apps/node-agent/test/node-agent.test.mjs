import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { canonicalJson, FileExecutionJournal, MemoryExecutionJournal, sha256Hex } from '../src/execution-journal.mjs';
import { HummerNodeAgent } from '../src/node-agent.mjs';

const now = '2026-10-07T00:00:00.000Z';

function createHarness(overrides = {}) {
  const calls = { heartbeats: [], statuses: [], events: [], receipts: [], transmissions: [], executions: [], approvalRequests: [], approvalConsumptions: [], authorizations: [] };
  let submittedApprovalRequest;
  const transport = {
    sendHeartbeat: async (manifest) => { calls.heartbeats.push(manifest); },
    claimTask: async () => ({ claimId: 'claim_1', deliveryId: 'delivery_1', envelope: { id: 'task_1' } }),
    reportClaimStatus: async (status) => calls.statuses.push(status),
    submitRunEvent: async (event) => { calls.events.push(event); calls.transmissions.push(`event:${event.type}`); },
    submitReceipt: async (receipt) => { calls.receipts.push(receipt); calls.transmissions.push('receipt'); },
    submitApprovalRequest: async (_claimId, request) => {
      calls.approvalRequests.push(request);
      submittedApprovalRequest = request;
      return request;
    },
    consumeApprovalDecision: async (claimId, requestId) => {
      calls.approvalConsumptions.push({ claimId, requestId });
      return { request: submittedApprovalRequest, decision: { requestId } };
    },
    getApprovalAuthorization: async (claimId, requestId) => {
      calls.authorizations.push({ claimId, requestId });
      return {
        state: 'approved', requestId, taskId: claimId, nodeId: 'node_a',
        expiresAt: '2026-10-07T01:00:00.000Z',
      };
    },
    acquireTaskGrantToken: async () => ({
      token: 'relay-issued-test-grant',
      grantRef: 'grant:task-1',
      expiresAt: '2026-10-07T01:00:00.000Z',
    }),
    ...overrides.transport,
  };
  const contractValidator = {
    validateNodeManifest: (value) => ({ ok: true, value }),
    validateTaskEnvelope: (value) => ({
      ok: true,
      value: {
        ...value,
        tenantId: 'tenant_a',
        targetNodeId: 'node_a',
        expiresAt: '2026-10-07T01:00:00.000Z',
        originRef: 'work_1',
      },
    }),
    validateApprovalRequest: (value) => ({ ok: true, value }),
    validateApprovalDecision: (value) => ({
      ok: true,
      value: {
        requestId: value.requestId,
        tenantId: 'tenant_a',
        decision: 'approved',
        deciderActorRef: 'human:owner',
        grantedScope: { capabilities: ['task.execute'], maxUses: 1, expiresAt: '2026-10-07T01:00:00.000Z' },
      },
    }),
    validateRunEvent: (value) => ({ ok: true, value }),
    validateOutcomeReceipt: (value) => ({ ok: true, value }),
    ...overrides.contractValidator,
  };
  const executor = {
    execute: async (input) => {
      calls.executions.push(input);
      return {
        events: [{
          schema: 'hummer.run-event', version: 1, eventId: 'event_1', tenantId: 'tenant_a',
          workOrderId: 'work_1', nodeId: 'node_a', seq: 1, occurredAt: now,
          type: 'started', actorRef: 'employee:worker', payload: { runId: 'run_1' },
          idempotencyKey: 'event-0001',
        }],
        receipt: {
          schema: 'hummer.outcome-receipt', version: 1,
          receipt: { tenantId: 'tenant_a', outcome: { workOrderId: 'work_1' } },
          domainEvents: [],
          manifest: { algorithm: 'SHA-256', rootHash: 'a'.repeat(64), fieldHashes: {} },
        },
      };
    },
    ...overrides.executor,
  };
  const agent = new HummerNodeAgent({
    nodeId: 'node_a',
    tenantId: 'tenant_a',
    heartbeatIntervalMs: 20_000,
    grant: {
      token: 'test-grant-value',
      nodeId: 'node_a',
      tenantId: 'tenant_a',
      expiresAt: '2026-10-07T01:00:00.000Z',
      scopes: ['node.heartbeat', 'task.claim', 'approval.request', 'task.execute'],
    },
    transport,
    contractValidator,
    executor,
    journal: overrides.journal ?? new MemoryExecutionJournal({ clock: () => new Date(now) }),
    clock: overrides.clock ?? (() => new Date(now)),
  });
  return { agent, calls };
}

function approvalRequest(overrides = {}) {
  return {
    schema: 'hummer.approval-request', version: 1,
    requestId: 'request_1', tenantId: 'tenant_a', workOrderId: 'work_1', nodeId: 'node_a',
    runId: 'run_1', riskClass: 'write', action: 'task.execute', target: 'claim_1',
    redactedPreview: 'safe preview', requestedScope: { capabilities: ['task.execute'], maxUses: 1 },
    expiresAt: '2026-10-07T01:00:00.000Z', requestedBy: 'system:node_a',
    ...overrides,
  };
}

function validOutcome() {
  return {
    events: [{
      schema: 'hummer.run-event', version: 1, eventId: 'event_1', tenantId: 'tenant_a',
      workOrderId: 'work_1', nodeId: 'node_a', seq: 1, occurredAt: now,
      type: 'started', actorRef: 'employee:worker', payload: { runId: 'run_1' },
      idempotencyKey: 'event-0001',
    }],
    receipt: {
      schema: 'hummer.outcome-receipt', version: 1,
      receipt: { tenantId: 'tenant_a', outcome: { workOrderId: 'work_1' } },
      domainEvents: [],
      manifest: { algorithm: 'SHA-256', rootHash: 'a'.repeat(64), fieldHashes: {} },
    },
  };
}

async function stageApproval(agent, request = approvalRequest()) {
  await agent.pollOnce();
  return agent.requestApproval('claim_1', request);
}

test('stages a valid claim as pending and never executes before human confirmation', async () => {
  const { agent, calls } = createHarness();

  const result = await agent.pollOnce();

  assert.deepEqual(result, { state: 'pending_confirmation', claimId: 'claim_1' });
  assert.equal(calls.executions.length, 0);
  assert.equal(calls.statuses.at(-1).state, 'pending_confirmation');
});

test('rejects an invalid NodeManifest before a heartbeat leaves the node', async () => {
  const { agent, calls } = createHarness({
    contractValidator: { validateNodeManifest: () => ({ ok: false, errors: ['unknown field'] }) },
  });

  await assert.rejects(() => agent.heartbeatOnce({ nodeId: 'node_a', unknown: true }), { code: 'invalid_node_manifest' });
  assert.equal(calls.heartbeats.length, 0);
});

test('rejects a malformed claim before contract validation or execution', async () => {
  let validationCalls = 0;
  const { agent, calls } = createHarness({
    transport: { claimTask: async () => ({ claimId: 'claim_1', envelope: { id: 'task_1' }, unexpected: true }) },
    contractValidator: { validateTaskEnvelope: () => { validationCalls += 1; return { ok: true, value: {} }; } },
  });

  const result = await agent.pollOnce();

  assert.equal(result.state, 'rejected');
  assert.equal(result.reasonCode, 'invalid_claim');
  assert.equal(validationCalls, 0);
  assert.equal(calls.executions.length, 0);
});

test('rejects a task envelope that the shared contract validator does not accept', async () => {
  const { agent, calls } = createHarness({
    contractValidator: { validateTaskEnvelope: () => ({ ok: false, errors: ['unknown field'] }) },
  });

  const result = await agent.pollOnce();

  assert.equal(result.state, 'rejected');
  assert.equal(result.reasonCode, 'invalid_task_envelope');
  assert.equal(calls.executions.length, 0);
});

test('fails closed when the Relay returns a decision that is not an approved human decision', async () => {
  const { agent, calls } = createHarness({
    contractValidator: {
      validateApprovalDecision: () => ({
        ok: true,
        value: {
          requestId: 'request_1', tenantId: 'tenant_a', decision: 'approved',
          deciderActorRef: 'system:auto',
          grantedScope: { capabilities: ['task.execute'], expiresAt: '2026-10-07T01:00:00.000Z' },
        },
      }),
    },
  });
  await stageApproval(agent);

  await assert.rejects(() => agent.confirmAndExecute('claim_1'), { code: 'approval_not_authorized' });
  assert.equal(calls.executions.length, 0);
});

test('consumes a TaskEnvelope grant once and checkpoints it without spending another use', async () => {
  const grantCalls = [];
  const issuedToken = 'relay-issued-task-grant';
  const authorization = {
    grantRef: 'grant:task-1', tenantId: 'tenant_a', workOrderId: 'work_1', nodeId: 'node_a',
    issuedToRunId: 'run_1', capabilities: ['task.execute'], paths: [],
    expiresAt: '2026-10-07T01:00:00.000Z', maxUses: 1, usedCount: 1,
  };
  const { agent, calls } = createHarness({
    transport: {
      claimTask: async () => ({
        claimId: 'claim_1', deliveryId: 'delivery_1', envelope: { id: 'task_1', grantRef: 'grant:task-1' },
      }),
      acquireTaskGrantToken: async (claimId, requestId) => {
        grantCalls.push({ operation: 'issue', claimId, requestId, token: undefined });
        return {
          token: issuedToken,
          grantRef: 'grant:task-1',
          expiresAt: '2026-10-07T01:00:00.000Z',
        };
      },
      consumeTaskGrant: async (claimId, requestId, context) => {
        grantCalls.push({ operation: 'consume', claimId, requestId, token: context.grantToken });
        return authorization;
      },
      checkpointTaskGrant: async (claimId, requestId, context) => {
        grantCalls.push({ operation: 'checkpoint', claimId, requestId, token: context.grantToken });
        return authorization;
      },
    },
  });
  await stageApproval(agent);

  assert.deepEqual(await agent.confirmAndExecute('claim_1'), { state: 'completed', claimId: 'claim_1' });
  assert.equal(grantCalls.filter((entry) => entry.operation === 'issue').length, 1);
  assert.equal(grantCalls.filter((entry) => entry.operation === 'consume').length, 1);
  assert.ok(grantCalls.filter((entry) => entry.operation === 'checkpoint').length >= 3);
  assert.ok(grantCalls.filter((entry) => entry.operation !== 'issue').every((entry) => entry.token === issuedToken));
  assert.equal(calls.executions.length, 1);
});

test('fails closed when a task grant is required but the transport has no issuer route', async () => {
  const { agent, calls } = createHarness({
    transport: {
      claimTask: async () => ({
        claimId: 'claim_1', deliveryId: 'delivery_1', envelope: { id: 'task_1', grantRef: 'grant:task-1' },
      }),
      acquireTaskGrantToken: undefined,
      consumeTaskGrant: async () => { throw new Error('must not consume'); },
      checkpointTaskGrant: async () => { throw new Error('must not checkpoint'); },
    },
  });
  await stageApproval(agent);

  await assert.rejects(() => agent.confirmAndExecute('claim_1'), { code: 'task_grant_issuer_unavailable' });
  assert.equal(calls.executions.length, 0);
});

test('rejects a foreign task-grant authorization before executor invocation', async () => {
  const { agent, calls } = createHarness({
    transport: {
      claimTask: async () => ({
        claimId: 'claim_1', deliveryId: 'delivery_1', envelope: { id: 'task_1', grantRef: 'grant:task-1' },
      }),
      consumeTaskGrant: async () => ({
        grantRef: 'grant:foreign', tenantId: 'tenant_a', workOrderId: 'work_1', nodeId: 'node_a',
        issuedToRunId: 'run_1', capabilities: ['task.execute'], paths: [],
        expiresAt: '2026-10-07T01:00:00.000Z', maxUses: 1, usedCount: 1,
      }),
      checkpointTaskGrant: async () => { throw new Error('must not checkpoint'); },
    },
  });
  await stageApproval(agent);

  await assert.rejects(() => agent.confirmAndExecute('claim_1'), { code: 'invalid_task_grant' });
  assert.equal(calls.executions.length, 0);
});

test('rejects a multi-use task-grant authorization before executor invocation', async () => {
  const { agent, calls } = createHarness({
    transport: {
      claimTask: async () => ({
        claimId: 'claim_1', deliveryId: 'delivery_1', envelope: { id: 'task_1', grantRef: 'grant:task-1' },
      }),
      consumeTaskGrant: async () => ({
        grantRef: 'grant:task-1', tenantId: 'tenant_a', workOrderId: 'work_1', nodeId: 'node_a',
        issuedToRunId: 'run_1', capabilities: ['task.execute'], paths: [],
        expiresAt: '2026-10-07T01:00:00.000Z', maxUses: 2, usedCount: 1,
      }),
      checkpointTaskGrant: async () => { throw new Error('must not checkpoint'); },
    },
  });
  await stageApproval(agent);

  await assert.rejects(() => agent.confirmAndExecute('claim_1'), { code: 'invalid_task_grant' });
  assert.equal(calls.executions.length, 0);
});

test('rejects a human decision that expands the requested capability or path scope', async () => {
  const { agent, calls } = createHarness({
    contractValidator: {
      validateApprovalDecision: (value) => ({
        ok: true,
        value: {
          requestId: value.requestId, tenantId: 'tenant_a', decision: 'approved',
          deciderActorRef: 'human:owner',
          grantedScope: {
            capabilities: ['task.execute', 'fs.read'], paths: ['secrets.txt'], maxUses: 1,
            expiresAt: '2026-10-07T01:00:00.000Z',
          },
        },
      }),
    },
  });
  await stageApproval(agent);

  await assert.rejects(() => agent.confirmAndExecute('claim_1'), { code: 'approval_scope_expanded' });
  assert.equal(calls.executions.length, 0);
});

for (const [decision, reasonCode] of [
  ['denied', 'approval_denied'],
  ['expired', 'approval_expired'],
  ['revoked', 'approval_revoked'],
]) {
  test(`consumes a ${decision} Relay decision into one durable rejected terminal without execution`, async () => {
    const { agent, calls } = createHarness({
      contractValidator: {
        validateApprovalDecision: (value) => ({
          ok: true,
          value: {
            requestId: value.requestId,
            tenantId: 'tenant_a',
            decision,
            deciderActorRef: 'human:owner',
          },
        }),
      },
    });
    await stageApproval(agent);

    assert.deepEqual(await agent.confirmAndExecute('claim_1'), { state: 'rejected', claimId: 'claim_1', reasonCode });
    assert.deepEqual(await agent.confirmAndExecute('claim_1'), { state: 'duplicate', claimId: 'claim_1' });
    assert.deepEqual(agent.stopClaim('claim_1'), { state: 'duplicate', claimId: 'claim_1' });
    assert.equal(calls.approvalConsumptions.length, 1);
    assert.equal(calls.executions.length, 0);
    assert.deepEqual(calls.statuses.at(-1), { claimId: 'claim_1', state: 'rejected', reasonCode });
  });
}

test('fails closed when approval does not grant task.execute', async () => {
  const { agent, calls } = createHarness({
    contractValidator: {
      validateApprovalDecision: () => ({
        ok: true,
        value: {
          requestId: 'request_1', tenantId: 'tenant_a', decision: 'approved',
          deciderActorRef: 'human:owner',
          grantedScope: { capabilities: ['workspace.read'], expiresAt: '2026-10-07T01:00:00.000Z' },
        },
      }),
    },
  });
  await stageApproval(agent);

  await assert.rejects(() => agent.confirmAndExecute('claim_1'), { code: 'approval_scope_denied' });
  assert.equal(calls.executions.length, 0);
});

test('fails closed when approval tenant does not match the node tenant', async () => {
  const { agent, calls } = createHarness({
    contractValidator: {
      validateApprovalDecision: () => ({
        ok: true,
        value: {
          requestId: 'request_1', tenantId: 'tenant_other', decision: 'approved',
          deciderActorRef: 'human:owner',
          grantedScope: { capabilities: ['task.execute'], expiresAt: '2026-10-07T01:00:00.000Z' },
        },
      }),
    },
  });
  await stageApproval(agent);

  await assert.rejects(() => agent.confirmAndExecute('claim_1'), { code: 'approval_not_authorized' });
  assert.equal(calls.executions.length, 0);
});

test('rejects caller-supplied decisions without contacting the executor', async () => {
  const { agent, calls } = createHarness();
  await stageApproval(agent);

  await assert.rejects(
    () => agent.confirmAndExecute('claim_1', { decision: 'approved' }),
    { code: 'local_approval_forbidden' },
  );
  assert.equal(calls.approvalConsumptions.length, 0);
  assert.equal(calls.executions.length, 0);
});

test('rejects a Relay bundle whose persisted run binding differs from the pending request', async () => {
  const { agent, calls } = createHarness({
    transport: {
      consumeApprovalDecision: async () => ({
        request: approvalRequest({ runId: 'run_other' }),
        decision: { requestId: 'request_1' },
      }),
    },
  });
  await stageApproval(agent);

  await assert.rejects(() => agent.confirmAndExecute('claim_1'), { code: 'approval_request_mismatch' });
  assert.equal(calls.executions.length, 0);
});

test('executes exactly once after a valid human approval and returns events plus receipt', async () => {
  const { agent, calls } = createHarness();
  await stageApproval(agent);

  const first = await agent.confirmAndExecute('claim_1');
  const second = await agent.confirmAndExecute('claim_1');

  assert.deepEqual(first, { state: 'completed', claimId: 'claim_1' });
  assert.deepEqual(second, { state: 'duplicate', claimId: 'claim_1' });
  assert.equal(calls.executions.length, 1);
  assert.equal(calls.events.length, 1);
  assert.equal(calls.receipts.length, 1);
});

test('persists the receipt before transmitting the terminal completed event', async () => {
  const outcome = validOutcome();
  outcome.events.push(
    {
      schema: 'hummer.run-event', version: 1, eventId: 'event_2', tenantId: 'tenant_a',
      workOrderId: 'work_1', nodeId: 'node_a', seq: 2, occurredAt: now,
      type: 'artifact', actorRef: 'employee:worker',
      payload: { artifactId: 'artifact_1', sha256: 'a'.repeat(64), bytes: 12, relPath: 'outputs/result.txt' },
      idempotencyKey: 'event-0002',
    },
    {
      schema: 'hummer.run-event', version: 1, eventId: 'event_3', tenantId: 'tenant_a',
      workOrderId: 'work_1', nodeId: 'node_a', seq: 3, occurredAt: now,
      type: 'completed', actorRef: 'employee:worker', payload: { summary: 'done' },
      idempotencyKey: 'event-0003',
    },
  );
  const { agent, calls } = createHarness({ executor: { execute: async () => outcome } });
  await stageApproval(agent);

  assert.deepEqual(await agent.confirmAndExecute('claim_1'), { state: 'completed', claimId: 'claim_1' });
  assert.deepEqual(calls.transmissions, ['event:started', 'event:artifact', 'receipt', 'event:completed']);
});

test('receipt persistence failure prevents the terminal completed event', async () => {
  const outcome = validOutcome();
  outcome.events.push({
    schema: 'hummer.run-event', version: 1, eventId: 'event_2', tenantId: 'tenant_a',
    workOrderId: 'work_1', nodeId: 'node_a', seq: 2, occurredAt: now,
    type: 'completed', actorRef: 'employee:worker', payload: { summary: 'done' },
    idempotencyKey: 'event-0002',
  });
  const { agent, calls } = createHarness({
    executor: { execute: async () => outcome },
    transport: { submitReceipt: async () => { throw new Error('simulated durable receipt failure'); } },
  });
  await stageApproval(agent);

  await assert.rejects(() => agent.confirmAndExecute('claim_1'));
  assert.deepEqual(calls.events.map((event) => event.type), ['started']);
  assert.equal(calls.events.some((event) => event.type === 'completed'), false);
});

test('a relay stop makes a pending claim permanently non-executable', async () => {
  const { agent, calls } = createHarness();
  await stageApproval(agent);

  assert.deepEqual(agent.stopClaim('claim_1'), { state: 'stopped', claimId: 'claim_1' });
  assert.deepEqual(
    await agent.confirmAndExecute('claim_1'),
    { state: 'stopped', claimId: 'claim_1' },
  );
  assert.equal(calls.executions.length, 0);
});

test('concurrent confirmation attempts consume and execute only once', async () => {
  let releaseDecision;
  let decisionRequested;
  const requested = new Promise((resolve) => { decisionRequested = resolve; });
  const decisionGate = new Promise((resolve) => { releaseDecision = resolve; });
  let persistedRequest;
  const { agent, calls } = createHarness({
    transport: {
      submitApprovalRequest: async (_claimId, request) => {
        persistedRequest = request;
        calls.approvalRequests.push(request);
        return request;
      },
      consumeApprovalDecision: async (claimId, requestId) => {
        calls.approvalConsumptions.push({ claimId, requestId });
        decisionRequested();
        await decisionGate;
        return { request: persistedRequest, decision: { requestId } };
      },
    },
  });
  await stageApproval(agent);
  const first = agent.confirmAndExecute('claim_1');
  await requested;
  const second = await agent.confirmAndExecute('claim_1');
  releaseDecision();

  assert.deepEqual(second, { state: 'confirming', claimId: 'claim_1' });
  assert.deepEqual(await first, { state: 'completed', claimId: 'claim_1' });
  assert.equal(calls.approvalConsumptions.length, 1);
  assert.equal(calls.executions.length, 1);
});

test('a long executor stops at the next checkpoint after authoritative approval revocation', async () => {
  let authorizationState = 'approved';
  let releaseStepOne;
  const stepOne = new Promise((resolve) => { releaseStepOne = resolve; });
  let enteredStepOne;
  const stepOneEntered = new Promise((resolve) => { enteredStepOne = resolve; });
  let sideEffects = 0;
  const { agent, calls } = createHarness({
    transport: {
      getApprovalAuthorization: async (claimId, requestId) => ({
        state: authorizationState,
        requestId,
        taskId: claimId,
        nodeId: 'node_a',
        expiresAt: '2026-10-07T01:00:00.000Z',
        ...(authorizationState === 'revoked' ? { revokedAt: '2026-10-07T00:10:00.000Z' } : {}),
      }),
    },
    executor: {
      execute: async ({ authorization }) => {
        sideEffects += 1;
        enteredStepOne();
        await stepOne;
        await authorization.checkpoint();
        sideEffects += 1;
        return validOutcome();
      },
    },
  });
  await stageApproval(agent);
  const execution = agent.confirmAndExecute('claim_1');
  await stepOneEntered;
  authorizationState = 'revoked';
  assert.deepEqual(agent.revokeClaim('claim_1', 'request_1'), {
    state: 'revoking', claimId: 'claim_1', requestId: 'request_1',
  });
  releaseStepOne();

  await assert.rejects(execution, { code: 'approval_revoked' });
  assert.equal(sideEffects, 1);
  assert.equal(calls.events.length, 0);
  assert.equal(calls.receipts.length, 0);
  assert.deepEqual(calls.statuses.at(-1), {
    claimId: 'claim_1', state: 'rejected', reasonCode: 'approval_revoked',
  });
  assert.deepEqual(await agent.confirmAndExecute('claim_1'), { state: 'duplicate', claimId: 'claim_1' });
});

test('a misbound authoritative authorization fails closed before executor side effects', async () => {
  const { agent, calls } = createHarness({
    transport: {
      getApprovalAuthorization: async (_claimId, requestId) => ({
        state: 'approved', requestId, taskId: 'claim_other', nodeId: 'node_a',
        expiresAt: '2026-10-07T01:00:00.000Z',
      }),
    },
  });
  await stageApproval(agent);

  await assert.rejects(agent.confirmAndExecute('claim_1'), { code: 'approval_not_authorized' });
  assert.equal(calls.executions.length, 0);
  assert.equal(calls.events.length, 0);
  assert.equal(calls.receipts.length, 0);
});

test('local approval expiry aborts a long executor at its next checkpoint without output', async () => {
  let currentTime = Date.parse(now);
  let continueExecution;
  let checkpointReady;
  const ready = new Promise((resolve) => { checkpointReady = resolve; });
  const continuation = new Promise((resolve) => { continueExecution = resolve; });
  let sideEffects = 0;
  const { agent, calls } = createHarness({
    clock: () => new Date(currentTime),
    executor: {
      execute: async ({ authorization }) => {
        sideEffects += 1;
        checkpointReady();
        await continuation;
        await authorization.checkpoint();
        sideEffects += 1;
        return validOutcome();
      },
    },
  });
  await stageApproval(agent);
  const execution = agent.confirmAndExecute('claim_1');
  await ready;
  currentTime = Date.parse('2026-10-07T01:00:00.000Z');
  continueExecution();

  await assert.rejects(execution, { code: 'approval_expired' });
  assert.equal(sideEffects, 1);
  assert.equal(calls.events.length, 0);
  assert.equal(calls.receipts.length, 0);
  assert.deepEqual(calls.statuses.at(-1), {
    claimId: 'claim_1', state: 'rejected', reasonCode: 'approval_expired',
  });
});

test('relay stop aborts an executing claim and records exactly one stopped terminal at the next checkpoint', async () => {
  let continueExecution;
  let checkpointReady;
  const ready = new Promise((resolve) => { checkpointReady = resolve; });
  const continuation = new Promise((resolve) => { continueExecution = resolve; });
  let sideEffects = 0;
  const { agent, calls } = createHarness({
    executor: {
      execute: async ({ authorization }) => {
        sideEffects += 1;
        checkpointReady();
        await continuation;
        await authorization.checkpoint();
        sideEffects += 1;
        return validOutcome();
      },
    },
  });
  await stageApproval(agent);
  const execution = agent.confirmAndExecute('claim_1');
  await ready;
  assert.deepEqual(agent.stopClaim('claim_1'), { state: 'stopping', claimId: 'claim_1' });
  assert.deepEqual(agent.stopClaim('claim_1'), { state: 'stopping', claimId: 'claim_1' });
  continueExecution();

  await assert.rejects(execution, { code: 'relay_stop' });
  assert.equal(sideEffects, 1);
  assert.equal(calls.events.length, 0);
  assert.equal(calls.receipts.length, 0);
  assert.deepEqual(calls.statuses.at(-1), {
    claimId: 'claim_1', state: 'stopped', reasonCode: 'relay_stop',
  });
  assert.deepEqual(agent.stopClaim('claim_1'), { state: 'stopped', claimId: 'claim_1' });
});

test('rejects a shared-contract TaskEnvelope bound to another tenant', async () => {
  const { agent, calls } = createHarness({
    contractValidator: {
      validateTaskEnvelope: (value) => ({
        ok: true,
        value: { ...value, tenantId: 'tenant_other', targetNodeId: 'node_a', expiresAt: '2026-10-07T01:00:00.000Z', originRef: 'work_1' },
      }),
    },
  });

  const result = await agent.pollOnce();

  assert.deepEqual(result, { state: 'rejected', claimId: 'claim_1', reasonCode: 'task_scope_mismatch' });
  assert.equal(calls.executions.length, 0);
});

test('rejects a shared-contract TaskEnvelope targeted at another node', async () => {
  const { agent, calls } = createHarness({
    contractValidator: {
      validateTaskEnvelope: (value) => ({
        ok: true,
        value: { ...value, tenantId: 'tenant_a', targetNodeId: 'node_other', expiresAt: '2026-10-07T01:00:00.000Z', originRef: 'work_1' },
      }),
    },
  });

  const result = await agent.pollOnce();

  assert.deepEqual(result, { state: 'rejected', claimId: 'claim_1', reasonCode: 'task_scope_mismatch' });
  assert.equal(calls.executions.length, 0);
});

test('rejects an expired shared-contract TaskEnvelope', async () => {
  const { agent, calls } = createHarness({
    contractValidator: {
      validateTaskEnvelope: (value) => ({
        ok: true,
        value: { ...value, tenantId: 'tenant_a', targetNodeId: 'node_a', expiresAt: '2026-10-06T23:59:59.000Z', originRef: 'work_1' },
      }),
    },
  });

  const result = await agent.pollOnce();

  assert.deepEqual(result, { state: 'rejected', claimId: 'claim_1', reasonCode: 'task_expired' });
  assert.equal(calls.executions.length, 0);
});

test('does not transmit an invalid outcome receipt', async () => {
  const { agent, calls } = createHarness({
    contractValidator: { validateOutcomeReceipt: () => ({ ok: false, errors: ['bad hash'] }) },
  });
  await stageApproval(agent);

  await assert.rejects(() => agent.confirmAndExecute('claim_1'), { code: 'invalid_outcome_receipt' });
  assert.equal(calls.events.length, 0);
  assert.equal(calls.receipts.length, 0);
  assert.equal(calls.statuses.at(-1).state, 'failed');
});

test('rejects an expired local grant and does not leak its token in the error', async () => {
  const { agent, calls } = createHarness();
  agent.grantExpiresAt = '2026-10-06T23:59:59.000Z';

  await assert.rejects(() => agent.pollOnce(), (error) => {
    assert.equal(error.code, 'grant_expired');
    assert.doesNotMatch(error.message, /test-grant-value/);
    return true;
  });
  assert.equal(calls.executions.length, 0);
});

test('a completed file-journal delivery stays terminal after agent reconstruction', async () => {
  const journalPath = temporaryJournalPath();
  const first = createHarness({ journal: new FileExecutionJournal({ path: journalPath, clock: () => new Date(now) }) });
  await stageApproval(first.agent);
  assert.deepEqual(await first.agent.confirmAndExecute('claim_1'), { state: 'completed', claimId: 'claim_1' });

  const second = createHarness({ journal: new FileExecutionJournal({ path: journalPath, clock: () => new Date(now) }) });
  assert.deepEqual(await second.agent.pollOnce(), { state: 'duplicate', claimId: 'claim_1' });
  assert.equal(second.calls.executions.length, 0);

  const journalText = readFileSync(journalPath, 'utf8');
  assert.doesNotMatch(journalText, /test-grant-value|safe preview|"envelope":/);
  assert.match(journalText, /"receiptHash":"[a-f0-9]{64}"/);
});

test('a denied file-journal delivery stays rejected and never re-consumes or executes after reconstruction', async () => {
  const journalPath = temporaryJournalPath();
  const decisionValidator = {
    validateApprovalDecision: (value) => ({
      ok: true,
      value: {
        requestId: value.requestId,
        tenantId: 'tenant_a',
        decision: 'denied',
        deciderActorRef: 'human:owner',
      },
    }),
  };
  const first = createHarness({
    journal: new FileExecutionJournal({ path: journalPath, clock: () => new Date(now) }),
    contractValidator: decisionValidator,
  });
  await stageApproval(first.agent);
  assert.deepEqual(await first.agent.confirmAndExecute('claim_1'), {
    state: 'rejected', claimId: 'claim_1', reasonCode: 'approval_denied',
  });

  const second = createHarness({
    journal: new FileExecutionJournal({ path: journalPath, clock: () => new Date(now) }),
    contractValidator: decisionValidator,
  });
  assert.deepEqual(await second.agent.confirmAndExecute('claim_1'), { state: 'duplicate', claimId: 'claim_1' });
  assert.equal(second.calls.approvalConsumptions.length, 0);
  assert.equal(second.calls.executions.length, 0);
  assert.match(readFileSync(journalPath, 'utf8'), /"terminalState":"rejected"/);
  assert.match(readFileSync(journalPath, 'utf8'), /"reasonCode":"approval_denied"/);
});

test('an executing record recovered after a crash requires operator recovery and never retries', async () => {
  const journal = new MemoryExecutionJournal({ clock: () => new Date(now) });
  seedExecutingClaim(journal);

  const { agent, calls } = createHarness({ journal });

  assert.deepEqual(await agent.pollOnce(), { state: 'recovery_required', claimId: 'claim_1' });
  assert.deepEqual(await agent.confirmAndExecute('claim_1'), { state: 'recovery_required', claimId: 'claim_1' });
  assert.equal(calls.executions.length, 0);
  assert.equal(calls.approvalConsumptions.length, 0);
});

test('file journal tampering fails startup instead of repairing or truncating history', () => {
  const journalPath = temporaryJournalPath();
  const journal = new FileExecutionJournal({ path: journalPath, clock: () => new Date(now) });
  journal.initialize({ tenantId: 'tenant_a', nodeId: 'node_a' });
  journal.append(claimRecord());
  const original = readFileSync(journalPath, 'utf8');
  writeFileSync(journalPath, original.replace('claim_1', 'claim_X'), 'utf8');

  assert.throws(
    () => createHarness({ journal: new FileExecutionJournal({ path: journalPath, clock: () => new Date(now) }) }),
    { code: 'journal_corrupt' },
  );
  assert.equal(readFileSync(journalPath, 'utf8'), original.replace('claim_1', 'claim_X'));
});

test('a journal cannot be reused across tenant or node scope', () => {
  const journal = new MemoryExecutionJournal({ clock: () => new Date(now) });
  journal.initialize({ tenantId: 'tenant_a', nodeId: 'node_a' });

  assert.throws(() => journal.initialize({ tenantId: 'tenant_b', nodeId: 'node_a' }), { code: 'journal_scope_mismatch' });
  assert.throws(() => journal.initialize({ tenantId: 'tenant_a', nodeId: 'node_b' }), { code: 'journal_scope_mismatch' });
});

test('an executing journal append failure prevents the executor side effect', async () => {
  const backing = new MemoryExecutionJournal({ clock: () => new Date(now) });
  const journal = {
    initialize: (scope) => backing.initialize(scope),
    append: (record) => {
      if (record.type === 'executing') throw Object.assign(new Error('simulated disk failure'), { code: 'EIO' });
      return backing.append(record);
    },
  };
  const { agent, calls } = createHarness({ journal });
  await stageApproval(agent);

  await assert.rejects(() => agent.confirmAndExecute('claim_1'), { code: 'journal_write_failed' });
  assert.equal(calls.executions.length, 0);
  assert.deepEqual(await agent.confirmAndExecute('claim_1'), { state: 'recovery_required', claimId: 'claim_1' });
});

function temporaryJournalPath() {
  return join(mkdtempSync(join(tmpdir(), 'hummer-node-journal-')), 'execution.jsonl');
}

function claimRecord() {
  return {
    type: 'claim_accepted', claimId: 'claim_1', deliveryId: 'delivery_1', workOrderId: 'work_1',
    envelopeHash: sha256Hex(canonicalJson({
      id: 'task_1', tenantId: 'tenant_a', targetNodeId: 'node_a',
      expiresAt: '2026-10-07T01:00:00.000Z', originRef: 'work_1',
    })),
  };
}

function seedExecutingClaim(journal) {
  journal.initialize({ tenantId: 'tenant_a', nodeId: 'node_a' });
  journal.append(claimRecord());
  journal.append({
    ...claimRecord(), type: 'approval_request_recorded', requestId: 'request_1', approvalRequestHash: 'b'.repeat(64),
  });
  journal.append({
    ...claimRecord(), type: 'approval_decision_consumed', requestId: 'request_1',
    approvalRequestHash: 'b'.repeat(64), approvalDecisionHash: 'c'.repeat(64),
  });
  journal.append({
    ...claimRecord(), type: 'executing', requestId: 'request_1',
    approvalRequestHash: 'b'.repeat(64), approvalDecisionHash: 'c'.repeat(64),
  });
}
