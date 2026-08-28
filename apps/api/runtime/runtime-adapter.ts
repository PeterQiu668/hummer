import type { Approval, ResultPackage, WorkOrder } from '../work-orders/index.ts';
import type { ToolTrace } from '../tools/tool-catalog.ts';

export interface RuntimeStartInput {
  workOrder: WorkOrder;
  runId: string;
}

export interface RuntimeStartResult {
  jobId: string;
  traceRef?: string;
}

export interface RuntimeResumeInput {
  jobId: string;
  approval?: Approval;
}

export interface RuntimeCancelInput {
  jobId: string;
  reason: string;
}

export interface RuntimeAdapter {
  start(input: RuntimeStartInput): Promise<RuntimeStartResult>;
  resume(input: RuntimeResumeInput): Promise<void>;
  cancel(input: RuntimeCancelInput): Promise<void>;
}

export type RuntimeJobStatus = 'queued' | 'running' | 'awaiting_approval' | 'completed' | 'failed' | 'cancelled';

export interface RuntimeCost {
  modelTokens: number;
  modelCostCny: number;
  toolCostCny: number;
  totalCostCny: number;
}

export interface RuntimeFailure {
  code: 'approval_rejected' | 'cancelled' | 'runtime_error';
  safeSummary: string;
}

export interface RuntimeSnapshot {
  jobId: string;
  runId: string;
  workOrderId: string;
  tenantId: string;
  adapter: 'mock';
  status: RuntimeJobStatus;
  traceRef: string;
  correlationId: string;
  toolTraces: readonly ToolTrace[];
  evidenceRefs: readonly string[];
  cost: RuntimeCost;
  risk: { level: 'low' | 'medium' | 'high'; notes: readonly string[] };
  resultPackage?: ResultPackage;
  failure?: RuntimeFailure;
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeAdapterPort {
  recordToolTrace(input: { workOrderId: string; tenantId: string; correlationId: string; actorRef: string; trace: ToolTrace; occurredAt: string }): Promise<void>;
  addEvidence(input: { workOrderId: string; sourceRef: string; bytes: Uint8Array; redactedSummary: string; ownerActorRef: string; tenantId: string; correlationId: string; occurredAt: string }): Promise<{ id: string; hash: string }>;
  requestApproval(input: { workOrderId: string; action: string; riskLevel: 'high'; rationale: string; requesterActorRef: string; evidenceRefs: string[]; tenantId: string; correlationId: string; occurredAt: string }): Promise<Approval>;
  executeSyntheticWrite(input: { workOrderId: string; actorRef: string; tenantId: string; correlationId: string; approval: Approval; traceRef: string; occurredAt: string }): Promise<void>;
  createResultPackage(input: { workOrderId: string; package: Omit<ResultPackage, 'id' | 'tenantId' | 'workOrderId' | 'status' | 'createdAt' | 'updatedAt'>; actorRef: string; tenantId: string; correlationId: string; occurredAt: string }): Promise<ResultPackage>;
}
