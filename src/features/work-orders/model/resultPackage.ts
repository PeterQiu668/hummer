export type ResultPackageStatus = 'delivered' | 'accepted' | 'rejected';

export type DeliverableKind = 'report' | 'table' | 'recommendation';

export type AcceptanceVerdict = 'pending' | 'passed' | 'failed';

export type RiskLevel = 'low' | 'medium' | 'high';

export interface ResultDeliverable {
  id: string;
  name: string;
  kind: DeliverableKind;
  uri?: string;
}

export interface ResultAcceptanceCriterion {
  id: string;
  text: string;
  verdict: AcceptanceVerdict;
  note?: string;
}

export interface ResultCost {
  modelTokens: number;
  modelCostCny: number;
  toolCostCny: number;
  totalCostCny: number;
}

export interface ResultRisk {
  level: RiskLevel;
  notes: string[];
}

export interface ResultRollback {
  supported: boolean;
  instructions?: string;
}

export interface ResultPackage {
  id: string;
  tenantId: string;
  workOrderId: string;
  status: ResultPackageStatus;
  summary: string;
  deliverables: ResultDeliverable[];
  acceptanceCriteria: ResultAcceptanceCriterion[];
  evidenceRefs: string[];
  cost: ResultCost;
  risk: ResultRisk;
  rollback: ResultRollback;
  createdAt: string;
  updatedAt: string;
}

export interface ResultPackageValidation {
  valid: boolean;
  errors: string[];
}

export interface CreateDemoResultPackageInput {
  id?: string;
  tenantId?: string;
  workOrderId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export function createDemoResultPackage(input: CreateDemoResultPackageInput = {}): ResultPackage {
  const createdAt = input.createdAt ?? '2026-08-23T10:00:00Z';

  return {
    id: input.id ?? 'res_demo_001',
    tenantId: input.tenantId ?? 'tenant_fixture',
    workOrderId: input.workOrderId ?? 'wo_demo_001',
    status: 'delivered',
    summary: 'Synthetic GTM research package with prioritized accounts and next-step recommendations.',
    deliverables: [
      {
        id: 'del_demo_report_001',
        name: 'GTM research report',
        kind: 'report',
        uri: 'fixture://results/gtm-research-report.md',
      },
    ],
    acceptanceCriteria: [
      {
        id: 'criterion_demo_001',
        text: 'Deliver a reviewable GTM research report.',
        verdict: 'pending',
      },
    ],
    evidenceRefs: ['evi_demo_001'],
    cost: {
      modelTokens: 1200,
      modelCostCny: 0.12,
      toolCostCny: 0.08,
      totalCostCny: 0.2,
    },
    risk: {
      level: 'low',
      notes: ['Synthetic workspace only; no external writes were performed.'],
    },
    rollback: {
      supported: true,
      instructions: 'Restore the synthetic CSV fixture from its prior revision if the result is rejected.',
    },
    createdAt,
    updatedAt: input.updatedAt ?? createdAt,
  };
}

export function validateResultPackage(resultPackage: ResultPackage): ResultPackageValidation {
  const errors: string[] = [];

  if (resultPackage.deliverables.length === 0) {
    errors.push('ResultPackage requires at least one deliverable.');
  }

  if (resultPackage.acceptanceCriteria.length === 0) {
    errors.push('ResultPackage requires at least one acceptance criterion.');
  } else if (resultPackage.acceptanceCriteria.some(({ verdict }) => !isAcceptanceVerdict(verdict))) {
    errors.push('Every acceptance criterion must have a verdict.');
  }

  if (!resultPackage.evidenceRefs.some((reference) => reference.trim().length > 0)) {
    errors.push('ResultPackage requires at least one evidence reference.');
  }

  const { modelTokens, modelCostCny, toolCostCny, totalCostCny } = resultPackage.cost;
  if (![modelTokens, modelCostCny, toolCostCny, totalCostCny].every(isNonNegativeFiniteNumber)) {
    errors.push('Cost values must be finite non-negative numbers.');
  }

  if (!areCostsReconciled(totalCostCny, modelCostCny + toolCostCny)) {
    errors.push('Total cost must equal model and tool costs.');
  }

  if (!resultPackage.risk.notes.some((note) => note.trim().length > 0)) {
    errors.push('Risk notes must include at least one non-empty note.');
  }

  if (typeof resultPackage.rollback.supported !== 'boolean') {
    errors.push('Rollback support must be explicitly specified.');
  } else if (resultPackage.rollback.supported && !resultPackage.rollback.instructions?.trim()) {
    errors.push('Rollback instructions must be non-empty when rollback is supported.');
  }

  return { valid: errors.length === 0, errors };
}

function isAcceptanceVerdict(verdict: unknown): verdict is AcceptanceVerdict {
  return verdict === 'pending' || verdict === 'passed' || verdict === 'failed';
}

function isNonNegativeFiniteNumber(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function areCostsReconciled(totalCostCny: number, calculatedTotalCny: number): boolean {
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(totalCostCny), Math.abs(calculatedTotalCny));
  return Math.abs(totalCostCny - calculatedTotalCny) <= tolerance;
}
