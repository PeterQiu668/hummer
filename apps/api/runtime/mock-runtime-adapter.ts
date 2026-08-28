import type { Approval, ResultPackage, WorkOrder } from '../work-orders/index.ts';
import { riskLevelForTool, type ToolTrace } from '../tools/tool-catalog.ts';
import type {
  RuntimeAdapter,
  RuntimeAdapterPort,
  RuntimeResumeInput,
  RuntimeStartInput,
  RuntimeStartResult,
} from './runtime-adapter.ts';

export interface MockRuntimeExecution {
  jobId: string;
  runId: string;
  workOrder: WorkOrder;
  traceRef: string;
  status: 'awaiting_approval' | 'completed' | 'failed' | 'cancelled';
  toolTraces: readonly ToolTrace[];
  evidenceRefs: readonly string[];
  cost: { modelTokens: number; modelCostCny: number; toolCostCny: number; totalCostCny: number };
  risk: { level: 'low' | 'medium' | 'high'; notes: readonly string[] };
  resultPackage?: ResultPackage;
  failure?: { code: 'approval_rejected' | 'cancelled' | 'runtime_error'; safeSummary: string };
}

type MutableExecution = {
  jobId: string;
  runId: string;
  workOrder: WorkOrder;
  traceRef: string;
  status: MockRuntimeExecution['status'];
  toolTraces: ToolTrace[];
  evidenceRefs: string[];
  cost: MockRuntimeExecution['cost'];
  risk: MockRuntimeExecution['risk'];
  approvalId?: string;
  resultPackage?: ResultPackage;
  failure?: MockRuntimeExecution['failure'];
};

export class MockRuntimeAdapter implements RuntimeAdapter {
  private readonly executions = new Map<string, MutableExecution>();

  constructor(private port?: RuntimeAdapterPort, private readonly now: () => string = () => new Date().toISOString()) {}

  setPort(port: RuntimeAdapterPort): void {
    this.port = port;
  }

  async start(input: RuntimeStartInput): Promise<RuntimeStartResult> {
    const existing = this.executions.get(input.runId);
    if (existing) return { jobId: existing.jobId, traceRef: existing.traceRef };
    if (!this.port) throw new Error('MockRuntimeAdapter requires a RuntimeAdapterPort.');
    const traceRef = `trace_${input.runId}`;
    const execution: MutableExecution = {
      jobId: input.runId,
      runId: input.runId,
      workOrder: input.workOrder,
      traceRef,
      status: 'awaiting_approval',
      toolTraces: [],
      evidenceRefs: [],
      cost: { modelTokens: 320, modelCostCny: 0.32, toolCostCny: 0.1, totalCostCny: 0.42 },
      risk: { level: 'high', notes: ['Synthetic CSV write is approval-gated.', 'No external system was contacted.'] },
    };
    this.executions.set(input.runId, execution);

    await this.record(execution, { tool: 'synthetic_gtm_search', class: 'read', traceRef, status: 'completed' });
    await this.record(execution, { tool: 'synthetic_csv_parse', class: 'read', traceRef, status: 'completed' });
    const evidence = await this.port.addEvidence({
      workOrderId: input.workOrder.id,
      tenantId: input.workOrder.tenantId,
      correlationId: input.workOrder.correlationId,
      sourceRef: 'fixture://synthetic/gtm-segments.csv',
      bytes: new TextEncoder().encode('segment,fit\nsynthetic_mid_market,high\nsynthetic_growth,start'),
      redactedSummary: 'Synthetic GTM segment fit summary.',
      ownerActorRef: `employee:${input.workOrder.assignedEmployeeId}`,
      occurredAt: this.now(),
    });
    execution.evidenceRefs.push(evidence.id);
    const approval = await this.port.requestApproval({
      workOrderId: input.workOrder.id,
      tenantId: input.workOrder.tenantId,
      correlationId: input.workOrder.correlationId,
      action: 'synthetic_csv_write',
      riskLevel: 'high',
      rationale: 'Write enriched rows to the synthetic CSV fixture after research.',
      requesterActorRef: `employee:${input.workOrder.assignedEmployeeId}`,
      evidenceRefs: [...execution.evidenceRefs],
      occurredAt: this.now(),
    });
    execution.approvalId = approval.id;
    await this.record(execution, { tool: 'synthetic_crm_csv_write', class: 'write', traceRef, status: 'awaiting_approval', riskLevel: riskLevelForTool('synthetic_crm_csv_write') });
    return { jobId: execution.jobId, traceRef };
  }

  async resume(input: RuntimeResumeInput): Promise<void> {
    const execution = this.getMutable(input.jobId);
    if (!input.approval || input.approval.id !== execution.approvalId) throw new Error('A matching approval is required to resume the mock run.');
    if (input.approval.status === 'rejected') {
      execution.status = 'failed';
      execution.failure = { code: 'approval_rejected', safeSummary: 'Synthetic write was blocked after human approval rejection.' };
      execution.risk = { level: 'high', notes: ['Synthetic CSV write was rejected and not executed.'] };
      await this.record(execution, { tool: 'synthetic_crm_csv_write', class: 'write', traceRef: execution.traceRef, status: 'blocked', riskLevel: 'high' });
      return;
    }
    if (input.approval.status !== 'approved' || !this.port) throw new Error('The mock write requires an approved action.');
    await this.port.executeSyntheticWrite({
      workOrderId: execution.workOrder.id,
      tenantId: execution.workOrder.tenantId,
      correlationId: execution.workOrder.correlationId,
      actorRef: `employee:${execution.workOrder.assignedEmployeeId}`,
      approval: input.approval,
      traceRef: execution.traceRef,
      occurredAt: this.now(),
    });
    await this.record(execution, { tool: 'synthetic_crm_csv_write', class: 'write', traceRef: execution.traceRef, status: 'executed', riskLevel: 'high' });
    execution.resultPackage = await this.port.createResultPackage({
      workOrderId: execution.workOrder.id,
      tenantId: execution.workOrder.tenantId,
      correlationId: execution.workOrder.correlationId,
      actorRef: `employee:${execution.workOrder.assignedEmployeeId}`,
      occurredAt: this.now(),
      package: {
        summary: 'Deterministic synthetic GTM research identified two high-fit segments and prepared an approval-gated CSV write.',
        deliverables: [
          { id: 'del_gtm_report', name: 'Synthetic GTM research report', kind: 'report', uri: 'fixture://synthetic/gtm-report' },
          { id: 'del_segment_table', name: 'Segment fit table', kind: 'table', uri: 'fixture://synthetic/segment-fit.csv' },
        ],
        acceptanceCriteria: execution.workOrder.acceptanceCriteria.map(({ id, text }) => ({ id, text, verdict: 'pending' as const })),
        evidenceRefs: [...execution.evidenceRefs],
        cost: execution.cost,
        risk: { level: execution.risk.level, notes: [...execution.risk.notes] },
        rollback: { supported: true, instructions: 'Restore the synthetic CSV fixture revision; no external system was changed.' },
      },
    });
    execution.status = 'completed';
  }

  async cancel(input: { jobId: string; reason: string }): Promise<void> {
    const execution = this.getMutable(input.jobId);
    if (execution.status === 'completed' || execution.status === 'failed' || execution.status === 'cancelled') return;
    execution.status = 'cancelled';
    execution.failure = { code: 'cancelled', safeSummary: input.reason };
  }

  getExecution(jobId: string): MockRuntimeExecution {
    const execution = this.getMutable(jobId);
    return { ...execution, toolTraces: [...execution.toolTraces], evidenceRefs: [...execution.evidenceRefs], risk: { ...execution.risk } };
  }

  private async record(execution: MutableExecution, trace: ToolTrace): Promise<void> {
    execution.toolTraces.push(trace);
    await this.port?.recordToolTrace({
      workOrderId: execution.workOrder.id,
      tenantId: execution.workOrder.tenantId,
      correlationId: execution.workOrder.correlationId,
      actorRef: `employee:${execution.workOrder.assignedEmployeeId}`,
      trace,
      occurredAt: this.now(),
    });
  }

  private getMutable(jobId: string): MutableExecution {
    const execution = this.executions.get(jobId);
    if (!execution) throw new Error(`Runtime job ${jobId} was not found.`);
    return execution;
  }
}
