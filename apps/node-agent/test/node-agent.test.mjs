import assert from 'node:assert/strict';
import test from 'node:test';

import { HummerNodeAgent } from '../src/node-agent.mjs';

const now = '2026-10-07T00:00:00.000Z';

function createHarness(overrides = {}) {
  const calls = { heartbeats: [], statuses: [], events: [], receipts: [], executions: [], approvalRequests: [], approvalConsumptions: [] };
  let submittedApprovalRequest;
  const transport = {
    sendHeartbeat: async (manifest) => { calls.heartbeats.push(manifest); },
    claimTask: async () => ({ claimId: 'claim_1', deliveryId: 'delivery_1', envelope: { id: 'task_1' } }),
    reportClaimStatus: async (status) => calls.statuses.push(status),
    submitRunEvent: async (event) => calls.events.push(event),
    submitReceipt: async (receipt) => calls.receipts.push(receipt),
    submitApprovalRequest: async (_claimId, request) => {
      calls.approvalRequests.push(request);
      submittedApprovalRequest = request;
      return request;
    },
    consumeApprovalDecision: async (claimId, requestId) => {
      calls.approvalConsumptions.push({ claimId, requestId });
      return { request: submittedApprovalRequest, decision: { requestId } };
    },
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
        grantedScope: { capabilities: ['task.execute'], expiresAt: '2026-10-07T01:00:00.000Z' },
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
        receipt: { id: 'receipt_1' },
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
    clock: () => new Date(now),
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
