import { currentSessionToken } from '../identity/identityClient';

export type OutcomeRiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type OutcomeVerdict = 'accepted' | 'rejected';
export interface RuntimeUsage { inputTokens: number; cachedInputTokens: number; outputTokens: number }
export interface OutcomeDefinitionRecord { id: string; tenantId: string; actionPattern: string; title: string; acceptanceCriteria: string; unitPriceCny: number | null; riskLevel: OutcomeRiskLevel; enabled: boolean; createdAt: string; updatedAt: string }
export interface OutcomeEventRecord { id: string; tenantId: string; outcomeDefinitionId: string; workOrderId: string | null; sessionId: string; approvalId: string | null; verdict: OutcomeVerdict; acceptedBy: string; evidenceRef: string | null; occurredAt: string }
export interface CostLedgerRecord { id: string; tenantId: string; sessionId: string; outcomeEventId: string | null; engineProfileId: string; model: string; usage: RuntimeUsage; costCny: number; pricingSource: string; pricingVerifiedAt: string; computedAt: string }
export interface SessionCostSummary { totalCostCny: number | null; entryCount: number }
export interface OutcomeReceipt { generatedAt: string; tenantId: string; outcome: OutcomeEventRecord; definition: OutcomeDefinitionRecord; costs: CostLedgerRecord[]; totalCostCny: number; approval: unknown; chainIntegrity: { valid: boolean; checked: number }; receiptJson: string }
export interface DefineOutcomeCommand { actionPattern: string; title: string; acceptanceCriteria: string; unitPriceCny?: number | null; riskLevel: OutcomeRiskLevel; idempotencyKey: string }
export interface RecordOutcomeCommand { outcomeDefinitionId: string; workOrderId?: string; sessionId: string; approvalId?: string; verdict: OutcomeVerdict; evidenceRef?: string; occurredAt: string; idempotencyKey: string }
export interface RecordCostCommand { sessionId: string; outcomeEventId?: string; engineProfileId: string; model: string; usage: RuntimeUsage; occurredAt: string; idempotencyKey: string }

interface DesktopOutcomeHost {
  define(request: { token: string; input: DefineOutcomeCommand }): Promise<OutcomeDefinitionRecord>;
  record(request: { token: string; input: RecordOutcomeCommand }): Promise<OutcomeEventRecord>;
  recordCost(request: { token: string; input: RecordCostCommand }): Promise<CostLedgerRecord>;
  receipt(request: { token: string; input: { outcomeEventId: string } }): Promise<OutcomeReceipt>;
  sessionCost(request: { token: string; input: { sessionId: string } }): Promise<SessionCostSummary>;
}
export interface OutcomePort {
  define(command: DefineOutcomeCommand): Promise<OutcomeDefinitionRecord>;
  record(command: RecordOutcomeCommand): Promise<OutcomeEventRecord>;
  recordCost(command: RecordCostCommand): Promise<CostLedgerRecord>;
  receipt(outcomeEventId: string): Promise<OutcomeReceipt>;
  sessionCost(sessionId: string): Promise<SessionCostSummary>;
}

declare global { interface Window { hummerOutcomes?: DesktopOutcomeHost } }

export function desktopOutcomePort(): OutcomePort | undefined {
  const host = typeof window === 'undefined' ? undefined : window.hummerOutcomes;
  if (!host) return undefined;
  return {
    define: (input) => host.define({ token: token(), input }),
    record: (input) => host.record({ token: token(), input }),
    recordCost: (input) => host.recordCost({ token: token(), input }),
    receipt: (outcomeEventId) => host.receipt({ token: token(), input: { outcomeEventId } }),
    sessionCost: (sessionId) => host.sessionCost({ token: token(), input: { sessionId } }),
  };
}

function token(): string {
  const value = currentSessionToken();
  if (!value) throw new Error('结果账本需要已认证的身份会话。');
  return value;
}
