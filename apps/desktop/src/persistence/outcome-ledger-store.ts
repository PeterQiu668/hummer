import { randomUUID } from 'node:crypto';
import type { JsonValue } from './canonical-json.js';
import { DomainEventStore } from './domain-event-store.js';
import type { SqliteDatabase } from './sqlite.js';
import { calculateOutcomeCostCny, type RuntimeUsage } from '../pricing/deepseek-pricing.js';

export type OutcomeRiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type OutcomeVerdict = 'accepted' | 'rejected';

export interface OutcomeDefinitionRecord {
  id: string;
  tenantId: string;
  actionPattern: string;
  title: string;
  acceptanceCriteria: string;
  unitPriceCny: number | null;
  riskLevel: OutcomeRiskLevel;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DefineOutcomeInput {
  tenantId: string;
  actionPattern: string;
  title: string;
  acceptanceCriteria: string;
  unitPriceCny?: number | null;
  riskLevel: OutcomeRiskLevel;
  actorRef: string;
  idempotencyKey: string;
}

export interface OutcomeEventRecord {
  id: string;
  tenantId: string;
  outcomeDefinitionId: string;
  workOrderId: string | null;
  sessionId: string;
  approvalId: string | null;
  verdict: OutcomeVerdict;
  acceptedBy: string;
  evidenceRef: string | null;
  occurredAt: string;
}

export interface RecordOutcomeInput {
  tenantId: string;
  outcomeDefinitionId: string;
  workOrderId?: string;
  sessionId: string;
  approvalId?: string;
  verdict: OutcomeVerdict;
  acceptedBy: string;
  evidenceRef?: string;
  occurredAt: string;
  idempotencyKey: string;
}

export interface CostLedgerRecord {
  id: string;
  tenantId: string;
  sessionId: string;
  outcomeEventId: string | null;
  engineProfileId: string;
  model: string;
  usage: RuntimeUsage;
  costCny: number;
  pricingSource: string;
  pricingVerifiedAt: string;
  computedAt: string;
}

export interface SessionCostSummary {
  totalCostCny: number | null;
  entryCount: number;
}

export interface RecordCostInput {
  tenantId: string;
  sessionId: string;
  outcomeEventId?: string;
  engineProfileId: string;
  model: string;
  usage: RuntimeUsage;
  pricingSource?: 'planning';
  occurredAt: string;
  actorRef: string;
  idempotencyKey: string;
}

interface DefinitionRow {
  id: string; tenant_id: string; action_pattern: string; title: string; acceptance_criteria: string;
  unit_price_cny: number | null; risk_level: OutcomeRiskLevel; enabled: number; created_at: string; updated_at: string;
}
interface OutcomeEventRow {
  id: string; tenant_id: string; outcome_definition_id: string; work_order_id: string | null; session_id: string;
  approval_id: string | null; verdict: OutcomeVerdict; accepted_by: string; evidence_ref: string | null; occurred_at: string;
}
interface CostLedgerRow {
  id: string; tenant_id: string; session_id: string; outcome_event_id: string | null; engine_profile_id: string; model: string;
  input_tokens: number; cached_input_tokens: number; output_tokens: number; cost_cny: number;
  pricing_source: string; pricing_verified_at: string; computed_at: string;
}

/**
 * The outcome ledger is HUMMER's billing unit: one accepted (or rejected) outcome event, tied to
 * the domain-event hash chain, plus the real token cost that produced it. This is the minimum
 * fact base a "verify -> bill" or "verify -> insure" claim requires. It does not implement
 * settlement, invoicing, or payment capture (see docs/decisions/ADR-004-m5a-outcome-ledger.md).
 */
export class OutcomeLedgerStore {
  private readonly events: DomainEventStore;

  constructor(private readonly database: SqliteDatabase, private readonly now: () => Date = () => new Date()) {
    this.events = new DomainEventStore(database);
  }

  defineOutcome(input: DefineOutcomeInput): OutcomeDefinitionRecord {
    required(input.title, 'Outcome title');
    required(input.acceptanceCriteria, 'Outcome acceptance criteria');
    required(input.actionPattern, 'Outcome action pattern');
    return this.database.transaction(() => {
      const existing = this.database.prepare('SELECT id FROM outcome_definitions WHERE tenant_id = ? AND action_pattern = ?')
        .get<{ id: string }>(input.tenantId, input.actionPattern);
      if (existing) return this.requireDefinition(input.tenantId, existing.id);
      const now = this.now().toISOString();
      const id = idFor('outcome_def');
      this.database.prepare(`
        INSERT INTO outcome_definitions
          (id, tenant_id, action_pattern, title, acceptance_criteria, unit_price_cny, risk_level, enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(id, input.tenantId, input.actionPattern.trim(), input.title.trim(), input.acceptanceCriteria.trim(), input.unitPriceCny ?? null, input.riskLevel, now, now);
      this.event(input.tenantId, 'outcome_definition', id, 'outcome_definition.created', input.actorRef, input.idempotencyKey, {
        actionPattern: input.actionPattern.trim(), title: input.title.trim(), riskLevel: input.riskLevel, unitPriceCny: input.unitPriceCny ?? null,
      });
      return this.requireDefinition(input.tenantId, id);
    })();
  }

  listDefinitions(tenantId: string): OutcomeDefinitionRecord[] {
    return this.database.prepare('SELECT * FROM outcome_definitions WHERE tenant_id = ? ORDER BY created_at, id')
      .all<DefinitionRow>(tenantId).map(mapDefinition);
  }

  getDefinition(tenantId: string, id: string): OutcomeDefinitionRecord | undefined {
    const row = this.database.prepare('SELECT * FROM outcome_definitions WHERE tenant_id = ? AND id = ?').get<DefinitionRow>(tenantId, id);
    return row ? mapDefinition(row) : undefined;
  }

  recordOutcome(input: RecordOutcomeInput): OutcomeEventRecord {
    if (input.verdict !== 'accepted' && input.verdict !== 'rejected') throw new TypeError('Outcome verdict must be accepted or rejected');
    return this.database.transaction(() => {
      const existing = this.database.prepare('SELECT id FROM outcome_events WHERE tenant_id = ? AND idempotency_key = ?')
        .get<{ id: string }>(input.tenantId, input.idempotencyKey);
      if (existing) return this.requireEvent(input.tenantId, existing.id);
      this.requireDefinition(input.tenantId, input.outcomeDefinitionId);
      const id = idFor('outcome_evt');
      this.database.prepare(`
        INSERT INTO outcome_events
          (id, tenant_id, outcome_definition_id, work_order_id, session_id, approval_id, verdict, accepted_by, evidence_ref, occurred_at, idempotency_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, input.tenantId, input.outcomeDefinitionId, input.workOrderId ?? null, input.sessionId,
        input.approvalId ?? null, input.verdict, input.acceptedBy, input.evidenceRef ?? null, input.occurredAt, input.idempotencyKey,
      );
      this.event(input.tenantId, 'outcome_event', id, `outcome.${input.verdict}`, input.acceptedBy, input.idempotencyKey, {
        outcomeDefinitionId: input.outcomeDefinitionId, workOrderId: input.workOrderId ?? null, sessionId: input.sessionId,
        approvalId: input.approvalId ?? null, verdict: input.verdict, evidenceRef: input.evidenceRef ?? null,
      });
      return this.requireEvent(input.tenantId, id);
    })();
  }

  listEvents(tenantId: string, sessionId?: string): OutcomeEventRecord[] {
    const where = sessionId ? 'WHERE tenant_id = ? AND session_id = ?' : 'WHERE tenant_id = ?';
    const values = sessionId ? [tenantId, sessionId] : [tenantId];
    return this.database.prepare(`SELECT * FROM outcome_events ${where} ORDER BY occurred_at, id`).all<OutcomeEventRow>(...values).map(mapEvent);
  }

  getEvent(tenantId: string, id: string): OutcomeEventRecord | undefined {
    const row = this.database.prepare('SELECT * FROM outcome_events WHERE tenant_id = ? AND id = ?').get<OutcomeEventRow>(tenantId, id);
    return row ? mapEvent(row) : undefined;
  }

  /**
   * Computes and records a real CNY cost from token usage. This never invents a number: if the
   * model has no verified price, calculateOutcomeCostCny throws and nothing is written.
   */
  recordCost(input: RecordCostInput): CostLedgerRecord {
    return this.database.transaction(() => {
      const existing = this.database.prepare('SELECT id FROM cost_ledger WHERE tenant_id = ? AND idempotency_key = ?')
        .get<{ id: string }>(input.tenantId, input.idempotencyKey);
      if (existing) return this.requireCost(input.tenantId, existing.id);
      if (input.outcomeEventId) this.requireEvent(input.tenantId, input.outcomeEventId);
      const priced = calculateOutcomeCostCny(input.model, input.usage, input.occurredAt);
      const id = idFor('cost');
      const computedAt = this.now().toISOString();
      this.database.prepare(`
        INSERT INTO cost_ledger
          (id, tenant_id, session_id, outcome_event_id, engine_profile_id, model, input_tokens, cached_input_tokens,
           output_tokens, cost_cny, pricing_source, pricing_verified_at, computed_at, idempotency_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, input.tenantId, input.sessionId, input.outcomeEventId ?? null, input.engineProfileId, input.model,
        input.usage.inputTokens, input.usage.cachedInputTokens, input.usage.outputTokens,
        priced.costCny, input.pricingSource ?? priced.pricingSource, priced.pricingVerifiedAt, computedAt, input.idempotencyKey,
      );
      this.event(input.tenantId, 'cost_ledger', id, 'cost.recorded', input.actorRef, input.idempotencyKey, {
        sessionId: input.sessionId, outcomeEventId: input.outcomeEventId ?? null, engineProfileId: input.engineProfileId,
        model: input.model,
        usage: { inputTokens: input.usage.inputTokens, cachedInputTokens: input.usage.cachedInputTokens, outputTokens: input.usage.outputTokens } as JsonValue,
        costCny: priced.costCny, pricingSource: input.pricingSource ?? priced.pricingSource,
      });
      return this.requireCost(input.tenantId, id);
    })();
  }

  listCosts(tenantId: string, outcomeEventId: string): CostLedgerRecord[] {
    return this.database.prepare('SELECT * FROM cost_ledger WHERE tenant_id = ? AND outcome_event_id = ? ORDER BY computed_at, id')
      .all<CostLedgerRow>(tenantId, outcomeEventId).map(mapCost);
  }

  totalCostCny(tenantId: string, outcomeEventId: string): number {
    return this.listCosts(tenantId, outcomeEventId).reduce((sum, entry) => sum + entry.costCny, 0);
  }

  sessionCostSummary(tenantId: string, sessionId: string): SessionCostSummary {
    const row = this.database.prepare(`
      SELECT COUNT(*) AS entry_count, SUM(cost_cny) AS total_cost_cny
      FROM cost_ledger
      WHERE tenant_id = ? AND session_id = ?
    `).get<{ entry_count: number; total_cost_cny: number | null }>(tenantId, sessionId);
    return {
      totalCostCny: row?.entry_count ? row.total_cost_cny : null,
      entryCount: row?.entry_count ?? 0,
    };
  }

  private requireDefinition(tenantId: string, id: string): OutcomeDefinitionRecord {
    const record = this.getDefinition(tenantId, id);
    if (!record) throw new Error('Outcome definition is unavailable in the current tenant');
    return record;
  }
  private requireEvent(tenantId: string, id: string): OutcomeEventRecord {
    const record = this.getEvent(tenantId, id);
    if (!record) throw new Error('Outcome event is unavailable in the current tenant');
    return record;
  }
  private requireCost(tenantId: string, id: string): CostLedgerRecord {
    const row = this.database.prepare('SELECT * FROM cost_ledger WHERE tenant_id = ? AND id = ?').get<CostLedgerRow>(tenantId, id);
    if (!row) throw new Error('Cost ledger entry is unavailable in the current tenant');
    return mapCost(row);
  }
  private event(tenantId: string, aggregateType: string, aggregateId: string, type: string, actorRef: string, correlationId: string, payload: JsonValue): void {
    this.events.append({ id: idFor('evt'), tenantId, aggregateType, aggregateId, type, occurredAt: this.now().toISOString(), actorRef, correlationId: `corr_${correlationId}`, payload });
  }
}

function idFor(prefix: string): string { return `${prefix}_${randomUUID().replaceAll('-', '')}`; }
function required(value: string, label: string): void { if (!value.trim()) throw new TypeError(`${label} is required`); }

function mapDefinition(r: DefinitionRow): OutcomeDefinitionRecord {
  return {
    id: r.id, tenantId: r.tenant_id, actionPattern: r.action_pattern, title: r.title, acceptanceCriteria: r.acceptance_criteria,
    unitPriceCny: r.unit_price_cny, riskLevel: r.risk_level, enabled: r.enabled === 1, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
function mapEvent(r: OutcomeEventRow): OutcomeEventRecord {
  return {
    id: r.id, tenantId: r.tenant_id, outcomeDefinitionId: r.outcome_definition_id, workOrderId: r.work_order_id, sessionId: r.session_id,
    approvalId: r.approval_id, verdict: r.verdict, acceptedBy: r.accepted_by, evidenceRef: r.evidence_ref, occurredAt: r.occurred_at,
  };
}
function mapCost(r: CostLedgerRow): CostLedgerRecord {
  return {
    id: r.id, tenantId: r.tenant_id, sessionId: r.session_id, outcomeEventId: r.outcome_event_id, engineProfileId: r.engine_profile_id,
    model: r.model, usage: { inputTokens: r.input_tokens, cachedInputTokens: r.cached_input_tokens, outputTokens: r.output_tokens },
    costCny: r.cost_cny, pricingSource: r.pricing_source, pricingVerifiedAt: r.pricing_verified_at, computedAt: r.computed_at,
  };
}
