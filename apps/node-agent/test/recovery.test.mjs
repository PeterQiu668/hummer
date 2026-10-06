import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  canonicalJson,
  FileExecutionJournal,
  MemoryExecutionJournal,
  sha256Hex,
} from '../src/execution-journal.mjs';
import { HummerNodeAgent } from '../src/node-agent.mjs';

const NOW = '2026-10-07T00:00:00.000Z';
const ENVELOPE_HASH = sha256Hex(canonicalJson({
  id: 'task_1',
  tenantId: 'tenant_a',
  targetNodeId: 'node_a',
  expiresAt: '2026-10-07T01:00:00.000Z',
  originRef: 'work_1',
}));

function claimRecord() {
  return {
    type: 'claim_accepted',
    claimId: 'claim_1',
    deliveryId: 'delivery_1',
    workOrderId: 'work_1',
    envelopeHash: ENVELOPE_HASH,
  };
}

function seedExecuting(journal) {
  journal.initialize({ tenantId: 'tenant_a', nodeId: 'node_a' });
  journal.append(claimRecord());
  journal.append({
    ...claimRecord(),
    type: 'approval_request_recorded',
    requestId: 'request_1',
    approvalRequestHash: 'b'.repeat(64),
  });
  journal.append({
    ...claimRecord(),
    type: 'approval_decision_consumed',
    requestId: 'request_1',
    approvalRequestHash: 'b'.repeat(64),
    approvalDecisionHash: 'c'.repeat(64),
  });
  journal.append({
    ...claimRecord(),
    type: 'executing',
    requestId: 'request_1',
    approvalRequestHash: 'b'.repeat(64),
    approvalDecisionHash: 'c'.repeat(64),
  });
}

function createAgent(journal, overrides = {}) {
  const calls = {
    claims: 0,
    statuses: [],
    approvals: 0,
    executions: 0,
  };
  const transport = {
    sendHeartbeat: async () => undefined,
    claimTask: async () => {
      calls.claims += 1;
      return {
        claimId: 'claim_1',
        deliveryId: 'delivery_1',
        envelope: { id: 'task_1' },
      };
    },
    reportClaimStatus: async (status) => calls.statuses.push(status),
    submitRunEvent: async () => undefined,
    submitReceipt: async () => undefined,
    submitApprovalRequest: async () => {
      calls.approvals += 1;
      return {};
    },
    consumeApprovalDecision: async () => {
      calls.approvals += 1;
      return {};
    },
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
    validateApprovalDecision: (value) => ({ ok: true, value }),
    validateRunEvent: (value) => ({ ok: true, value }),
    validateOutcomeReceipt: (value) => ({ ok: true, value }),
  };
  const ids = [...(overrides.ids ?? ['resolution', 'attempt', 'idempotency'])];
  const agent = new HummerNodeAgent({
    nodeId: 'node_a',
    tenantId: 'tenant_a',
    heartbeatIntervalMs: 20_000,
    grant: {
      token: 'private-test-grant',
      nodeId: 'node_a',
      tenantId: 'tenant_a',
      expiresAt: '2026-10-07T01:00:00.000Z',
      scopes: ['task.claim', 'approval.request', 'task.execute'],
    },
    transport,
    contractValidator,
    executor: {
      execute: async () => {
        calls.executions += 1;
        return { events: [], receipt: {} };
      },
    },
    journal,
    clock: () => new Date(NOW),
    idFactory: () => ids.shift() ?? 'unexpected-extra-id',
  });
  return { agent, calls };
}

function journalPath() {
  return join(mkdtempSync(join(tmpdir(), 'hummer-recovery-')), 'execution.jsonl');
}

test('operator inspection is redacted and the recovered attempt remains fail-closed', async () => {
  const journal = new MemoryExecutionJournal({ clock: () => new Date(NOW) });
  seedExecuting(journal);
  const { agent, calls } = createAgent(journal);

  assert.deepEqual(agent.inspectRecovery('claim_1'), {
    claimId: 'claim_1',
    deliveryId: 'delivery_1',
    workOrderId: 'work_1',
    journalStage: 'executing',
    envelopeHash: ENVELOPE_HASH,
    requiresDecision: true,
  });
  assert.deepEqual(await agent.pollOnce(), { state: 'recovery_required', claimId: 'claim_1' });
  assert.deepEqual(await agent.confirmAndExecute('claim_1'), { state: 'recovery_required', claimId: 'claim_1' });
  assert.equal(calls.executions, 0);
  assert.equal(calls.approvals, 0);
});

test('abandon appends a chained immutable operator decision and survives restart', async () => {
  const path = journalPath();
  const journal = new FileExecutionJournal({ path, clock: () => new Date(NOW) });
  seedExecuting(journal);
  const before = readFileSync(path, 'utf8');
  const { agent, calls } = createAgent(journal);

  const resolution = agent.abandonRecovery('claim_1', {
    operatorActorRef: 'human:owner',
    reasonCode: 'side_effect_confirmed',
  });

  assert.deepEqual(resolution, {
    state: 'abandoned',
    claimId: 'claim_1',
    resolutionId: 'recovery-resolution',
    operatorActorRef: 'human:owner',
    reasonCode: 'side_effect_confirmed',
  });
  assert.equal(calls.executions, 0);
  assert.equal(calls.approvals, 0);
  const lines = readFileSync(path, 'utf8').trimEnd().split('\n').map(JSON.parse);
  const decision = lines.at(-1);
  assert.equal(decision.type, 'recovery_abandoned');
  assert.equal(decision.previousHash, lines.at(-2).hash);
  const { hash, ...material } = decision;
  assert.equal(hash, sha256Hex(canonicalJson(material)));
  assert.equal(readFileSync(path, 'utf8').startsWith(before), true);
  assert.doesNotMatch(readFileSync(path, 'utf8'), /private-test-grant/);

  const restarted = createAgent(new FileExecutionJournal({ path, clock: () => new Date(NOW) }));
  assert.deepEqual(await restarted.agent.confirmAndExecute('claim_1'), resolution);
  assert.deepEqual(restarted.agent.inspectRecovery('claim_1').resolution, resolution);
  assert.equal(restarted.calls.executions, 0);
});

test('authorize retry mints a new attempt and idempotency lineage without execution', async () => {
  const path = journalPath();
  const journal = new FileExecutionJournal({ path, clock: () => new Date(NOW) });
  seedExecuting(journal);
  const { agent, calls } = createAgent(journal, { ids: ['decision-1', 'attempt-2', 'idem-2'] });

  const resolution = agent.authorizeRecoveryRetry('claim_1', {
    operatorActorRef: 'account:ops-admin',
    reasonCode: 'verified_not_started',
  });

  assert.deepEqual(resolution, {
    state: 'retry_authorized',
    claimId: 'claim_1',
    resolutionId: 'recovery-decision-1',
    operatorActorRef: 'account:ops-admin',
    reasonCode: 'verified_not_started',
    retry: {
      attemptId: 'attempt-attempt-2',
      idempotencyKey: 'retry-idem-2',
      retryOfClaimId: 'claim_1',
      workOrderId: 'work_1',
    },
  });
  assert.notEqual(resolution.retry.idempotencyKey, 'delivery_1');
  assert.equal(calls.claims, 0);
  assert.equal(calls.executions, 0);
  assert.equal(calls.approvals, 0);
  assert.throws(
    () => agent.abandonRecovery('claim_1', { operatorActorRef: 'human:owner', reasonCode: 'changed_mind' }),
    { code: 'recovery_already_resolved' },
  );
  const afterFirstDecision = readFileSync(path, 'utf8');
  assert.equal(readFileSync(path, 'utf8'), afterFirstDecision);

  const restarted = createAgent(new FileExecutionJournal({ path, clock: () => new Date(NOW) }));
  assert.deepEqual(await restarted.agent.confirmAndExecute('claim_1'), resolution);
  assert.equal(restarted.calls.executions, 0);
  assert.equal(restarted.calls.approvals, 0);
});

test('recovery rejects machine actors, unsafe reason text, unknown claims, and terminal claims', () => {
  const path = journalPath();
  const journal = new FileExecutionJournal({ path, clock: () => new Date(NOW) });
  seedExecuting(journal);
  const { agent } = createAgent(journal);
  const unchanged = readFileSync(path, 'utf8');

  assert.throws(
    () => agent.abandonRecovery('claim_1', { operatorActorRef: 'system:auto', reasonCode: 'auto' }),
    { code: 'recovery_operator_forbidden' },
  );
  assert.throws(
    () => agent.abandonRecovery('claim_1', { operatorActorRef: 'human:../../owner', reasonCode: 'unsafe_actor' }),
    { code: 'recovery_operator_forbidden' },
  );
  assert.throws(
    () => agent.authorizeRecoveryRetry('claim_1', { operatorActorRef: 'human:owner', reasonCode: 'raw customer text!' }),
    { code: 'invalid_recovery_decision' },
  );
  assert.throws(
    () => agent.authorizeRecoveryRetry('missing', { operatorActorRef: 'human:owner', reasonCode: 'not_found' }),
    { code: 'recovery_not_found' },
  );
  assert.equal(readFileSync(path, 'utf8'), unchanged);

  const terminal = new MemoryExecutionJournal({ clock: () => new Date(NOW) });
  terminal.initialize({ tenantId: 'tenant_a', nodeId: 'node_a' });
  terminal.append(claimRecord());
  terminal.append({
    type: 'terminal', claimId: 'claim_1', deliveryId: 'delivery_1', workOrderId: 'work_1',
    terminalState: 'failed', reasonCode: 'executor_failed',
  });
  const terminalAgent = createAgent(terminal).agent;
  assert.throws(
    () => terminalAgent.abandonRecovery('claim_1', { operatorActorRef: 'human:owner', reasonCode: 'not_in_doubt' }),
    { code: 'recovery_not_required' },
  );
});

test('tampering with an appended recovery decision fails startup and is never repaired', () => {
  const path = journalPath();
  const journal = new FileExecutionJournal({ path, clock: () => new Date(NOW) });
  seedExecuting(journal);
  createAgent(journal).agent.abandonRecovery('claim_1', {
    operatorActorRef: 'human:owner',
    reasonCode: 'side_effect_confirmed',
  });
  const tampered = readFileSync(path, 'utf8').replace('side_effect_confirmed', 'side_effect_unknown');
  writeFileSync(path, tampered, 'utf8');

  assert.throws(
    () => createAgent(new FileExecutionJournal({ path, clock: () => new Date(NOW) })),
    { code: 'journal_corrupt' },
  );
  assert.equal(readFileSync(path, 'utf8'), tampered);
});

test('a generated recovery identifier can never be reused across decisions', () => {
  const journal = new MemoryExecutionJournal({ clock: () => new Date(NOW) });
  seedExecuting(journal);
  const second = {
    type: 'claim_accepted', claimId: 'claim_2', deliveryId: 'delivery_2',
    workOrderId: 'work_2', envelopeHash: 'd'.repeat(64),
  };
  journal.append(second);
  journal.append({
    ...second, type: 'approval_request_recorded', requestId: 'request_2',
    approvalRequestHash: 'e'.repeat(64),
  });
  journal.append({
    ...second, type: 'approval_decision_consumed', requestId: 'request_2',
    approvalRequestHash: 'e'.repeat(64), approvalDecisionHash: 'f'.repeat(64),
  });
  journal.append({
    ...second, type: 'executing', requestId: 'request_2',
    approvalRequestHash: 'e'.repeat(64), approvalDecisionHash: 'f'.repeat(64),
  });
  const { agent } = createAgent(journal, {
    ids: ['shared', 'attempt-1', 'idem-1', 'shared'],
  });
  agent.authorizeRecoveryRetry('claim_1', {
    operatorActorRef: 'human:owner', reasonCode: 'verified_not_started',
  });

  assert.throws(
    () => agent.abandonRecovery('claim_2', {
      operatorActorRef: 'human:owner', reasonCode: 'side_effect_confirmed',
    }),
    { code: 'recovery_identifier_collision' },
  );
  assert.equal(agent.inspectRecovery('claim_2').requiresDecision, true);
});

test('a failed durable resolution append leaves the claim recovery-required', async () => {
  const backing = new MemoryExecutionJournal({ clock: () => new Date(NOW) });
  seedExecuting(backing);
  const journal = {
    initialize: (scope) => backing.initialize(scope),
    append: (record) => {
      if (record.type === 'recovery_retry_authorized') {
        throw Object.assign(new Error('simulated disk failure'), { code: 'EIO' });
      }
      return backing.append(record);
    },
  };
  const { agent, calls } = createAgent(journal);

  assert.throws(
    () => agent.authorizeRecoveryRetry('claim_1', {
      operatorActorRef: 'human:owner', reasonCode: 'verified_not_started',
    }),
    { code: 'journal_write_failed' },
  );
  assert.equal(agent.inspectRecovery('claim_1').requiresDecision, true);
  assert.deepEqual(await agent.confirmAndExecute('claim_1'), {
    state: 'recovery_required', claimId: 'claim_1',
  });
  assert.equal(calls.executions, 0);
  assert.equal(calls.approvals, 0);
});
