import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { createVerifiableReceipt } from './verifiable-receipt.js';
import type { OutcomeReceipt } from './outcome-receipt.js';
import type { StoredDomainEvent } from './domain-event-store.js';
import { canonicalJson, sha256Hex } from './canonical-json.js';

describe('verifiable outcome receipt', () => {
  it('passes the standalone verifier and pinpoints a tampered field', () => {
    const directory = mkdtempSync(join(tmpdir(), 'hummer-receipt-'));
    const originalPath = join(directory, 'receipt.json');
    const tamperedPath = join(directory, 'tampered.json');
    const envelope = createVerifiableReceipt(receipt(), [event()]);
    writeFileSync(originalPath, `${JSON.stringify(envelope, null, 2)}\n`, 'utf8');

    const valid = verify(originalPath);
    expect(valid.status).toBe(0);
    expect(JSON.parse(valid.stdout)).toMatchObject({ valid: true });

    const tampered = JSON.parse(readFileSync(originalPath, 'utf8'));
    tampered.receipt.outcome.verdict = 'rejected';
    writeFileSync(tamperedPath, JSON.stringify(tampered), 'utf8');
    const invalid = verify(tamperedPath);
    expect(invalid.status).toBe(1);
    expect(JSON.parse(invalid.stdout)).toMatchObject({ valid: false, field: '/receipt/outcome/verdict' });
  });

  it('bridges global chain links without exposing another tenant event body', () => {
    const foreign = event('tenant_b', null, 1);
    const current = event('tenant_a', foreign.hash, 2);
    const envelope = createVerifiableReceipt(receipt(), [foreign, current]);

    expect(envelope.domainEvents[0]).toEqual({ opaque: true, position: 1, previousHash: null, hash: foreign.hash });
    expect(JSON.stringify(envelope.domainEvents[0])).not.toContain('tenant_b');
    expect(envelope.domainEvents[1]).toMatchObject({ tenantId: 'tenant_a', hash: current.hash });
  });
});

function verify(path: string) {
  return spawnSync(process.execPath, [resolve('scripts/verify-receipt.mjs'), path], { encoding: 'utf8' });
}

function receipt(): OutcomeReceipt {
  const body = {
    generatedAt: '2026-09-11T00:00:00.000Z', tenantId: 'tenant_a',
    outcome: { id: 'outcome_1', tenantId: 'tenant_a', outcomeDefinitionId: 'definition_1', workOrderId: 'wo_1', sessionId: 'session_1', approvalId: 'approval_1', verdict: 'accepted' as const, acceptedBy: 'account:owner', evidenceRef: 'evidence://sha256/test', occurredAt: '2026-09-11T00:00:00.000Z' },
    definition: { id: 'definition_1', tenantId: 'tenant_a', actionPattern: 'external.send*', title: 'External send', acceptanceCriteria: 'Approved first', unitPriceCny: null, riskLevel: 'high' as const, enabled: true, createdAt: '2026-09-11T00:00:00.000Z', updatedAt: '2026-09-11T00:00:00.000Z' },
    costs: [], totalCostCny: 0, approval: null, chainIntegrity: { valid: true as const, checked: 1 },
  };
  return { ...body, receiptJson: JSON.stringify(body) };
}

function event(tenantId = 'tenant_a', previousHash: string | null = null, position = 1): StoredDomainEvent {
  const stored = {
    position, id: `evt_${position}`, tenantId, aggregateType: 'outcome_event', aggregateId: 'outcome_1', aggregateVersion: 1,
    type: 'outcome.accepted', occurredAt: '2026-09-11T00:00:00.000Z', actorRef: 'account:owner', correlationId: 'corr_1',
    payload: { verdict: 'accepted' }, canonicalPayload: '{"verdict":"accepted"}', previousHash,
  };
  const material = {
    actorRef: stored.actorRef, aggregateId: stored.aggregateId, aggregateType: stored.aggregateType,
    aggregateVersion: stored.aggregateVersion, correlationId: stored.correlationId, id: stored.id,
    occurredAt: stored.occurredAt, payload: stored.payload, previousHash: stored.previousHash,
    tenantId: stored.tenantId, type: stored.type,
  };
  return { ...stored, hash: sha256Hex(canonicalJson(material)) };
}
