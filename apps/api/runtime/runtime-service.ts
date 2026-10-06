import type { Approval, InMemoryWorkOrderService, ResultPackage } from '../work-orders/index.ts';
import type { ToolTrace } from '../tools/tool-catalog.ts';
import type {
  RuntimeAdapter,
  RuntimeAdapterPort,
  RuntimeCancelInput,
  RuntimeCost,
  RuntimeResumeInput,
  RuntimeSnapshot,
} from './runtime-adapter.ts';

export class RuntimeService implements RuntimeAdapterPort {
  private readonly snapshots = new Map<string, RuntimeSnapshot>();
  private readonly approvalByWorkOrder = new Map<string, Approval>();
  private readonly now: () => string;

  constructor(
    private readonly adapter: RuntimeAdapter,
    private readonly workOrders: InMemoryWorkOrderService,
    options: { now?: () => string } = {},
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
    const configurable = adapter as RuntimeAdapter & { setPort?: (port: RuntimeAdapterPort) => void };
    configurable.setPort?.(this);
  }

  async start(input: { workOrder: Parameters<RuntimeAdapter['start']>[0]['workOrder']; runId: string }): Promise<RuntimeSnapshot> {
    const existing = this.snapshots.get(runtimeKey(input.workOrder.tenantId, input.runId));
    if (existing) return existing;
    const started = await this.adapter.start(input);
    const execution = this.readExecution(input.workOrder.tenantId, started.jobId);
    const snapshot = this.snapshotFromExecution(execution, input.workOrder, input.runId, started.jobId, started.traceRef ?? `trace_${input.runId}`);
    this.snapshots.set(runtimeKey(input.workOrder.tenantId, input.runId), snapshot);
    return snapshot;
  }

  async resume(tenantId: string, jobId: string, input: { approval: Pick<Approval, 'status' | 'action'> & Partial<Approval> }): Promise<RuntimeSnapshot> {
    const before = this.getSnapshot(tenantId, jobId);
    const storedApproval = this.approvalByWorkOrder.get(runtimeKey(tenantId, before.workOrderId));
    const approval = storedApproval && (!input.approval.id || input.approval.id === storedApproval.id)
      ? { ...storedApproval, status: input.approval.status, action: input.approval.action }
      : input.approval.id ? input.approval as Approval : undefined;
    if (!approval) throw new Error('A matching approval is required to resume the runtime job.');
    if (approval.workOrderId !== before.workOrderId || approval.tenantId !== before.tenantId) throw new Error('Approval does not belong to this runtime job.');
    const current = this.workOrders.get(tenantId, before.workOrderId);
    const decisionContext = { tenantId, actorRef: approval.approverActorRef ?? 'human:approval_pending', actorRole: 'operator' as const, idempotencyKey: `runtime-approval-${jobId}`, expectedVersion: current.version, correlationId: current.correlationId, occurredAt: this.now() };
    await this.workOrders.decideApproval(before.workOrderId, decisionContext, approval.status === 'approved' ? 'approved' : 'rejected', approval.decisionRationale);
    const persistedApproval = this.workOrders.getApproval(tenantId, approval.id);
    await this.adapter.resume({ tenantId, jobId, approval: persistedApproval });
    const execution = this.readExecution(tenantId, jobId);
    const snapshot = this.snapshotFromExecution(execution, current, before.runId, jobId, before.traceRef);
    this.snapshots.set(runtimeKey(tenantId, before.runId), snapshot);
    return snapshot;
  }

  async cancel(tenantId: string, jobId: string, reason: string): Promise<RuntimeSnapshot> {
    const before = this.getSnapshot(tenantId, jobId);
    await this.adapter.cancel({ tenantId, jobId, reason });
    const execution = this.readExecution(tenantId, jobId);
    const snapshot = this.snapshotFromExecution(execution, this.workOrders.get(tenantId, before.workOrderId), before.runId, jobId, before.traceRef);
    this.snapshots.set(runtimeKey(tenantId, before.runId), snapshot);
    return snapshot;
  }

  getSnapshot(tenantId: string, jobId: string): RuntimeSnapshot {
    const found = [...this.snapshots.values()].find((snapshot) => snapshot.tenantId === tenantId && snapshot.jobId === jobId);
    if (!found) throw new Error(`Runtime job ${jobId} was not found.`);
    return found;
  }

  async recordToolTrace(input: { workOrderId: string; tenantId: string; correlationId: string; actorRef: string; trace: ToolTrace; occurredAt: string }): Promise<void> {
    await this.workOrders.events.append({ tenantId: input.tenantId, subjectRef: input.workOrderId, type: 'tool.invoked', actorRef: input.actorRef, correlationId: input.correlationId, occurredAt: input.occurredAt, data: { ...input.trace } });
  }

  async addEvidence(input: { workOrderId: string; sourceRef: string; bytes: Uint8Array; redactedSummary: string; ownerActorRef: string; tenantId: string; correlationId: string; occurredAt: string }): Promise<{ id: string; hash: string }> {
    return this.workOrders.addEvidence(input.workOrderId, { sourceRef: input.sourceRef, bytes: input.bytes, redactedSummary: input.redactedSummary, ownerActorRef: input.ownerActorRef }, { tenantId: input.tenantId, actorRef: input.ownerActorRef, actorRole: 'operator', idempotencyKey: `runtime-evidence-${input.workOrderId}`, expectedVersion: this.workOrders.get(input.tenantId, input.workOrderId).version, correlationId: input.correlationId, occurredAt: input.occurredAt });
  }

  async requestApproval(input: { workOrderId: string; action: string; riskLevel: 'high'; rationale: string; requesterActorRef: string; evidenceRefs: string[]; tenantId: string; correlationId: string; occurredAt: string }): Promise<Approval> {
    const order = this.workOrders.get(input.tenantId, input.workOrderId);
    const approval = await this.workOrders.requestApproval(input.workOrderId, input, { tenantId: input.tenantId, actorRef: input.requesterActorRef, actorRole: 'operator', idempotencyKey: `runtime-approval-request-${input.workOrderId}`, expectedVersion: order.version, correlationId: input.correlationId, occurredAt: input.occurredAt });
    this.approvalByWorkOrder.set(runtimeKey(input.tenantId, input.workOrderId), approval);
    return approval;
  }

  async executeSyntheticWrite(input: { workOrderId: string; actorRef: string; tenantId: string; correlationId: string; approval: Approval; traceRef: string; occurredAt: string }): Promise<void> {
    await this.workOrders.executeSyntheticWrite(input.workOrderId, { tenantId: input.tenantId, actorRef: input.actorRef, actorRole: 'operator', idempotencyKey: `runtime-write-${input.approval.id}`, expectedVersion: this.workOrders.get(input.tenantId, input.workOrderId).version, correlationId: input.correlationId, occurredAt: input.occurredAt });
  }

  async createResultPackage(input: { workOrderId: string; package: Omit<ResultPackage, 'id' | 'tenantId' | 'workOrderId' | 'status' | 'createdAt' | 'updatedAt'>; actorRef: string; tenantId: string; correlationId: string; occurredAt: string }): Promise<ResultPackage> {
    const order = this.workOrders.get(input.tenantId, input.workOrderId);
    return this.workOrders.createResultPackage(input.workOrderId, input.package, { tenantId: input.tenantId, actorRef: input.actorRef, actorRole: 'operator', idempotencyKey: `runtime-result-${input.workOrderId}`, expectedVersion: order.version, correlationId: input.correlationId, occurredAt: input.occurredAt });
  }

  private readExecution(tenantId: string, jobId: string): { status: RuntimeSnapshot['status']; toolTraces: readonly ToolTrace[]; evidenceRefs: readonly string[]; cost: RuntimeCost; risk: RuntimeSnapshot['risk']; resultPackage?: ResultPackage; failure?: RuntimeSnapshot['failure'] } {
    const adapter = this.adapter as RuntimeAdapter & { getExecution?: (tenantId: string, jobId: string) => unknown };
    const execution = adapter.getExecution?.(tenantId, jobId);
    if (!execution || typeof execution !== 'object') throw new Error('RuntimeAdapter does not expose a readable execution snapshot.');
    return execution as ReturnType<RuntimeService['readExecution']>;
  }

  private snapshotFromExecution(execution: ReturnType<RuntimeService['readExecution']>, order: Parameters<RuntimeAdapter['start']>[0]['workOrder'], runId: string, jobId: string, traceRef: string): RuntimeSnapshot {
    const resolvedOrder = order;
    const timestamp = this.now();
    return { jobId, runId, workOrderId: resolvedOrder.id, tenantId: resolvedOrder.tenantId, adapter: 'mock', status: execution.status, traceRef, correlationId: resolvedOrder.correlationId, toolTraces: [...execution.toolTraces], evidenceRefs: [...execution.evidenceRefs], cost: execution.cost, risk: { level: execution.risk.level, notes: [...execution.risk.notes] }, ...(execution.resultPackage ? { resultPackage: execution.resultPackage } : {}), ...(execution.failure ? { failure: execution.failure } : {}), createdAt: this.snapshots.get(runtimeKey(resolvedOrder.tenantId, runId))?.createdAt ?? timestamp, updatedAt: timestamp };
  }
}

function runtimeKey(tenantId: string, id: string): string {
  return `${tenantId}\u0000${id}`;
}
