import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { canonicalJson, hashLeaves, verifySuccessfulOutcomeReceipt } from '@hummer/outcome-receipts';
import { portableOutcomeReceiptValidator } from '../src/outcome-receipt-validator.mjs';
import { FileOutcomeReceiptStore } from '../src/receipt-store.mjs';

const TENANT = 'tenant_test';
const NODE = 'node_test';
const NOW = '2026-10-07T00:00:00.000Z';

function receipt(overrides = {}) {
  const evidenceSha256 = 'a'.repeat(64);
  const outcomeId = 'outcome_1';
  const workOrderId = 'work_1';
  const sessionId = 'run_1';
  const outcomeDefinitionId = 'definition_1';
  const evidenceRef = `evidence://sha256/${evidenceSha256}`;
  const payload = {
    verdict: 'accepted', workOrderId, sessionId, evidenceRef, outcomeDefinitionId,
  };
  const material = {
    actorRef: 'system:node_test', aggregateId: outcomeId, aggregateType: 'outcome_event',
    aggregateVersion: 1, correlationId: workOrderId, id: 'event_1', occurredAt: NOW,
    payload, previousHash: null, tenantId: TENANT, type: 'outcome.accepted',
  };
  const event = {
    ...material, position: 1, canonicalPayload: canonicalJson(payload),
    hash: sha256(canonicalJson(material)),
  };
  const body = {
    generatedAt: NOW,
    tenantId: TENANT,
    outcome: {
      id: outcomeId, tenantId: TENANT, outcomeDefinitionId, workOrderId, sessionId,
      approvalId: 'decision_1', verdict: 'accepted', acceptedBy: 'human:owner', evidenceRef, occurredAt: NOW,
    },
    definition: {
      id: outcomeDefinitionId, tenantId: TENANT, actionPattern: 'fs.read.attest.v1',
      title: 'Read attestation', acceptanceCriteria: 'Bound SHA-256 attestation exists',
      unitPriceCny: null, riskLevel: 'low', enabled: true, createdAt: NOW, updatedAt: NOW,
    },
    costs: [], tools: [], totalCostCny: 0, approval: null,
    chainIntegrity: { valid: true, checked: 1 },
    ...overrides,
  };
  const content = { receipt: body, domainEvents: [event] };
  return {
    schema: 'hummer.outcome-receipt', version: 1, ...content,
    manifest: { algorithm: 'SHA-256', rootHash: sha256(canonicalJson(content)), fieldHashes: hashLeaves(content) },
  };
}

test('portable verifier and node-owned store persist one canonical create-only receipt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hummer-receipts-'));
  const store = new FileOutcomeReceiptStore({ root: join(root, 'owned'), tenantId: TENANT, nodeId: NODE });
  const value = receipt();
  const verified = verifySuccessfulOutcomeReceipt(value);
  assert.equal(portableOutcomeReceiptValidator.validateOutcomeReceipt(value).ok, true);

  const persisted = await store.put(value);
  assert.equal(persisted.rootHash, verified.rootHash);
  assert.equal(await readFile(persisted.path, 'utf8'), `${canonicalJson(value)}\n`);
  assert.deepEqual((await readdir(join(root, 'owned'))).sort(), [
    '.hummer-node-receipt-root.json', `${verified.rootHash}.json`,
  ]);
  await assert.rejects(() => store.put(value), { code: 'receipt_exists' });
  assert.equal(await readFile(persisted.path, 'utf8'), `${canonicalJson(value)}\n`);
});

test('receipt store rejects tamper and tenant reuse before creating a receipt file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hummer-receipts-invalid-'));
  const owned = join(root, 'owned');
  const store = new FileOutcomeReceiptStore({ root: owned, tenantId: TENANT, nodeId: NODE });
  await store.initialize();
  const tampered = structuredClone(receipt());
  tampered.receipt.outcome.workOrderId = 'work_tampered';
  await assert.rejects(() => store.put(tampered), { code: 'invalid_outcome_receipt' });
  assert.deepEqual(await readdir(owned), ['.hummer-node-receipt-root.json']);

  const foreignStore = new FileOutcomeReceiptStore({ root: owned, tenantId: 'tenant_other', nodeId: NODE });
  await assert.rejects(() => foreignStore.initialize(), { code: 'receipt_store_scope_mismatch' });
  assert.deepEqual(await readdir(owned), ['.hummer-node-receipt-root.json']);
});

test('portable verifier rejects unknown envelope and receipt fields', () => {
  assert.throws(() => verifySuccessfulOutcomeReceipt({ ...receipt(), autoApprove: true }));
  const nested = structuredClone(receipt());
  nested.receipt.hidden = true;
  assert.throws(() => verifySuccessfulOutcomeReceipt(nested));
});

function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
