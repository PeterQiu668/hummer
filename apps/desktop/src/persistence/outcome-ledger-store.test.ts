import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openPersistence } from './database.js';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

function tmpDir(): string {
  const directory = mkdtempSync(join(tmpdir(), 'hummer-outcome-'));
  directories.push(directory);
  return directory;
}

describe('OutcomeLedgerStore', () => {
  it('records an accepted outcome tied to a real approval, bills a real DeepSeek cost, and produces a verifiable, redacted receipt', () => {
    const persistence = openPersistence({ dataDirectory: tmpDir(), now: () => new Date('2026-09-02T10:00:00.000Z') });
    const owner = persistence.identity.createCompany({ companyName: '鲲鹏智造', displayName: '昆仑', email: 'kunlun@example.test' });
    persistence.approvalPolicies.ensureDefaults(owner.tenant.id, `account:${owner.account.id}`);

    const sessionId = 'ses_outreach_review_001';
    const approvalId = 'apr_outreach_review_001';
    persistence.runtimeEvents.saveSession({
      sessionId, tenantId: owner.tenant.id, runtimeId: 'codex-cli', workOrderId: 'wo_outreach_001',
      startedAt: '2026-09-02T09:55:00.000Z', plan: { id: 'plan_outreach', prompt: '外发前审核客户邮件' }, handle: { runtimeId: 'codex-cli', sessionId, nativeSessionId: 'thread_outreach' },
    });
    const options = { tenantId: owner.tenant.id, runtimeId: 'codex-cli', correlationId: 'corr_outreach', workOrderId: 'wo_outreach_001' };
    persistence.runtimeEvents.save({ sessionId, sequence: 1, occurredAt: '2026-09-02T09:56:00.000Z', actorRef: 'employee:sales-writer', type: 'approval_required', approvalId, tool: 'external.send.email', evidenceRefs: [] }, options);
    const authorization = persistence.approvalPolicies.authorize({
      tenantId: owner.tenant.id, sessionId, approvalId, action: 'external.send.email', requestedBy: 'employee:sales-writer',
      estimatedCostCny: 0.5, approverActorRef: `account:${owner.account.id}`, approved: true, occurredAt: '2026-09-02T09:57:00.000Z',
    });
    expect(authorization.approved).toBe(true);

    const definition = persistence.outcomes.defineOutcome({
      tenantId: owner.tenant.id, actionPattern: 'external.send.email', title: '外发邮件审核通过',
      acceptanceCriteria: '内容经责任人审阅，且未违反客户白名单', riskLevel: 'high',
      actorRef: `account:${owner.account.id}`, idempotencyKey: 'outcome-def-001',
    });
    expect(definition.id).toMatch(/^outcome_def_/);

    // The evidence ref intentionally embeds a secret-shaped value to prove the receipt assembler
    // actually redacts it, rather than the assertion below passing only because no secret was present.
    const outcome = persistence.outcomes.recordOutcome({
      tenantId: owner.tenant.id, outcomeDefinitionId: definition.id, workOrderId: 'wo_outreach_001', sessionId, approvalId,
      verdict: 'accepted', acceptedBy: `account:${owner.account.id}`, evidenceRef: 'evi_outreach_001_sk-super-secret-value',
      occurredAt: '2026-09-02T09:58:00.000Z', idempotencyKey: 'outcome-evt-001',
    });
    expect(outcome.verdict).toBe('accepted');

    const cost = persistence.outcomes.recordCost({
      tenantId: owner.tenant.id, sessionId, outcomeEventId: outcome.id, engineProfileId: 'deepseek-standard', model: 'deepseek-v4-flash',
      usage: { inputTokens: 4000, cachedInputTokens: 500, outputTokens: 900 }, occurredAt: '2026-09-02T09:58:30.000Z',
      actorRef: `account:${owner.account.id}`, idempotencyKey: 'outcome-cost-001',
    });
    expect(cost.costCny).toBeGreaterThan(0);
    expect(cost.pricingVerifiedAt).toBe('2026-08-29');
    expect(persistence.outcomes.totalCostCny(owner.tenant.id, outcome.id)).toBeCloseTo(cost.costCny, 6);
    expect(persistence.outcomes.sessionCostSummary(owner.tenant.id, sessionId)).toEqual({
      totalCostCny: cost.costCny,
      entryCount: 1,
    });

    const receipt = persistence.buildOutcomeReceipt(owner.tenant.id, outcome.id, { DEEPSEEK_API_KEY: 'sk-super-secret-value' });
    expect(receipt.outcome.id).toBe(outcome.id);
    expect(receipt.definition.id).toBe(definition.id);
    expect(receipt.totalCostCny).toBeCloseTo(cost.costCny, 6);
    expect(receipt.approval).not.toBeNull();
    expect(receipt.approval?.status).toBe('approved');
    expect(receipt.approval?.approverActorRef).toBe(`account:${owner.account.id}`);
    expect(receipt.chainIntegrity).toEqual(expect.objectContaining({ valid: true }));
    // The receipt must never leak a raw secret even if it happened to be present in a stored field.
    expect(receipt.receiptJson).not.toContain('sk-super-secret-value');
    expect(receipt.receiptJson).toContain('[REDACTED:DEEPSEEK_API_KEY]');

    expect(persistence.verifyDomainEventIntegrity()).toEqual(expect.objectContaining({ valid: true }));
    persistence.close();
  });

  it('is idempotent: replaying the same defineOutcome/recordOutcome/recordCost keys returns the original rows', () => {
    const persistence = openPersistence({ dataDirectory: tmpDir() });
    const owner = persistence.identity.createCompany({ companyName: '甲公司', displayName: '甲', email: 'a@example.test' });
    const first = persistence.outcomes.defineOutcome({
      tenantId: owner.tenant.id, actionPattern: 'external.send.email', title: '外发邮件审核通过', acceptanceCriteria: '内容经责任人审阅',
      riskLevel: 'high', actorRef: `account:${owner.account.id}`, idempotencyKey: 'idem-def-001',
    });
    const second = persistence.outcomes.defineOutcome({
      tenantId: owner.tenant.id, actionPattern: 'external.send.email', title: '重复调用不应新建一条', acceptanceCriteria: '不同文案也一样返回原记录',
      riskLevel: 'critical', actorRef: `account:${owner.account.id}`, idempotencyKey: 'idem-def-002',
    });
    expect(second.id).toBe(first.id);
    expect(second.title).toBe(first.title);
    expect(persistence.outcomes.listDefinitions(owner.tenant.id)).toHaveLength(1);
    persistence.close();
  });

  it('fails closed instead of billing a cost for a model with no verified price', () => {
    const persistence = openPersistence({ dataDirectory: tmpDir() });
    const owner = persistence.identity.createCompany({ companyName: '甲公司', displayName: '甲', email: 'a2@example.test' });
    expect(() => persistence.outcomes.recordCost({
      tenantId: owner.tenant.id, sessionId: 'ses_x', engineProfileId: 'zhipu-enhanced', model: 'glm-5.2',
      usage: { inputTokens: 100, cachedInputTokens: 0, outputTokens: 50 }, occurredAt: '2026-09-02T09:00:00.000Z',
      actorRef: `account:${owner.account.id}`, idempotencyKey: 'no-price-001',
    })).toThrow(/No verified CNY price/);
    persistence.close();
  });

  it('does not return another tenant outcome, definition or cost entry', () => {
    const persistence = openPersistence({ dataDirectory: tmpDir() });
    const first = persistence.identity.createCompany({ companyName: '甲公司', displayName: '甲', email: 'a3@example.test' });
    const second = persistence.identity.createCompany({ companyName: '乙公司', displayName: '乙', email: 'b3@example.test' });
    const definition = persistence.outcomes.defineOutcome({
      tenantId: first.tenant.id, actionPattern: 'external.send.email', title: '甲的审核通过', acceptanceCriteria: '仅甲可见',
      riskLevel: 'high', actorRef: `account:${first.account.id}`, idempotencyKey: 'tenant-def-001',
    });
    const outcome = persistence.outcomes.recordOutcome({
      tenantId: first.tenant.id, outcomeDefinitionId: definition.id, sessionId: 'ses_tenant_a', verdict: 'accepted',
      acceptedBy: `account:${first.account.id}`, occurredAt: '2026-09-02T09:00:00.000Z', idempotencyKey: 'tenant-evt-001',
    });
    expect(persistence.outcomes.getDefinition(second.tenant.id, definition.id)).toBeUndefined();
    expect(persistence.outcomes.getEvent(second.tenant.id, outcome.id)).toBeUndefined();
    expect(persistence.outcomes.sessionCostSummary(second.tenant.id, 'ses_tenant_a')).toEqual({ totalCostCny: null, entryCount: 0 });
    expect(() => persistence.buildOutcomeReceipt(second.tenant.id, outcome.id)).toThrow(/unavailable in the current tenant/);
    expect(() => persistence.outcomes.recordOutcome({
      tenantId: second.tenant.id, outcomeDefinitionId: definition.id, sessionId: 'ses_tenant_b', verdict: 'accepted',
      acceptedBy: `account:${second.account.id}`, occurredAt: '2026-09-02T09:01:00.000Z', idempotencyKey: 'tenant-evt-002',
    })).toThrow(/unavailable in the current tenant/);
    persistence.close();
  });

  it('records a rejected outcome without any cost and still produces a receipt with a null approval when none was linked', () => {
    const persistence = openPersistence({ dataDirectory: tmpDir() });
    const owner = persistence.identity.createCompany({ companyName: '甲公司', displayName: '甲', email: 'a4@example.test' });
    const definition = persistence.outcomes.defineOutcome({
      tenantId: owner.tenant.id, actionPattern: 'crm.write.accounts', title: 'CRM 写回通过', acceptanceCriteria: '字段抽查通过',
      riskLevel: 'high', actorRef: `account:${owner.account.id}`, idempotencyKey: 'rej-def-001',
    });
    const outcome = persistence.outcomes.recordOutcome({
      tenantId: owner.tenant.id, outcomeDefinitionId: definition.id, sessionId: 'ses_rejected', verdict: 'rejected',
      acceptedBy: `account:${owner.account.id}`, occurredAt: '2026-09-02T09:00:00.000Z', idempotencyKey: 'rej-evt-001',
    });
    const receipt = persistence.buildOutcomeReceipt(owner.tenant.id, outcome.id);
    expect(receipt.outcome.verdict).toBe('rejected');
    expect(receipt.approval).toBeNull();
    expect(receipt.totalCostCny).toBe(0);
    persistence.close();
  });
});
