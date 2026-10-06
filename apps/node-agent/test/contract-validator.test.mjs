import assert from 'node:assert/strict';
import test from 'node:test';

import { createSharedFleetContractValidator } from '../src/contract-validator.mjs';

const validator = createSharedFleetContractValidator({
  validateOutcomeReceipt: (value) => value && typeof value === 'object'
    ? { ok: true, value }
    : { ok: false, errors: ['receipt must be an object'] },
});

test('binds TaskEnvelope validation to the frozen shared contract', () => {
  const value = {
    schema: 'hummer.task-envelope', version: 1,
    workOrderTask: {
      schema: 'hummer.work-order-task', version: 1,
      title: 'Prepare report', target: 'Prepare a report', expectedDeliverable: 'outputs/report.md',
    },
    tenantId: 'tenant_a', targetNodeId: 'node_a', targetRuntime: 'codex',
    idempotencyKey: 'delivery-001', leaseMs: 30_000,
    approvalPolicyRef: 'policy-default-deny', expiresAt: '2026-10-07T01:00:00Z',
    originRef: 'work_1',
  };

  assert.equal(validator.validateTaskEnvelope(value).ok, true);
  assert.equal(validator.validateTaskEnvelope({ ...value, autoApprove: true }).ok, false);
});

test('rejects a system-authored approval decision through the shared contract', () => {
  const result = validator.validateApprovalDecision({
    schema: 'hummer.approval-decision', version: 1,
    decisionId: 'decision_1', requestId: 'claim_1', tenantId: 'tenant_a',
    decision: 'approved', deciderActorRef: 'system:auto', decidedAt: '2026-10-07T00:00:00Z',
    grantedScope: { capabilities: ['task.execute'], expiresAt: '2026-10-07T01:00:00Z' },
  });

  assert.equal(result.ok, false);
});

test('binds ApprovalRequest validation to the frozen shared contract', () => {
  const value = {
    schema: 'hummer.approval-request', version: 1, requestId: 'request_1', tenantId: 'tenant_a',
    workOrderId: 'work_1', nodeId: 'node_a', runId: 'run_1', riskClass: 'write',
    action: 'task.execute', target: 'claim_1', redactedPreview: 'safe preview',
    requestedScope: { capabilities: ['task.execute'], maxUses: 1 },
    expiresAt: '2026-10-07T01:00:00Z', requestedBy: 'system:node_a',
  };

  assert.equal(validator.validateApprovalRequest(value).ok, true);
  assert.equal(validator.validateApprovalRequest({ ...value, autoApprove: true }).ok, false);
});

test('keeps the existing outcome receipt validator as the only receipt authority', () => {
  assert.deepEqual(validator.validateOutcomeReceipt({ receipt: true }), {
    ok: true,
    value: { receipt: true },
  });
  assert.equal(validator.validateOutcomeReceipt(null).ok, false);
});
