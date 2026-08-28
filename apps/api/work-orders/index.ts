import type { DomainEvent, EventStore } from '../audit/index.ts';
import { InMemoryEventStore } from '../audit/index.ts';

export type WorkOrderStatus = 'draft' | 'submitted' | 'approved' | 'planned' | 'running' | 'awaiting_approval' | 'blocked' | 'delivered' | 'accepted' | 'rejected' | 'failed' | 'cancelled' | 'archived';
export type RiskLevel = 'low' | 'medium' | 'high';
export type ResultPackageStatus = 'delivered' | 'accepted' | 'rejected';
export type AcceptanceVerdict = 'pending' | 'passed' | 'failed';
export type DeliverableKind = 'report' | 'table' | 'recommendation';

export interface AcceptanceCriterion { id: string; text: string; required: boolean }
export interface WorkOrder {
  id: string; tenantId: string; version: number; title: string; goal: string; scope: string;
  inputRefs: string[]; acceptanceCriteria: AcceptanceCriterion[]; ownerActorRef: string;
  collaboratorActorRefs: string[]; assignedEmployeeId: string; status: WorkOrderStatus;
  riskLevel: RiskLevel; budgetLimitCny: number; dueAt?: string; correlationId: string;
  createdAt: string; updatedAt: string;
}
export interface Approval {
  id: string; tenantId: string; workOrderId: string; requesterActorRef: string;
  approverActorRef?: string; action: string; riskLevel: RiskLevel; rationale: string;
  evidenceRefs: string[]; status: 'pending' | 'approved' | 'rejected'; createdAt: string;
  decidedAt?: string; decisionRationale?: string;
}
export interface Evidence {
  id: string; tenantId: string; workOrderId: string; sourceRef: string; hash: string;
  redactedSummary: string; ownerActorRef: string; createdAt: string;
}
export interface ResultPackage {
  id: string; tenantId: string; workOrderId: string; status: ResultPackageStatus; summary: string;
  deliverables: Array<{ id: string; name: string; kind: DeliverableKind; uri?: string }>;
  acceptanceCriteria: Array<{ id: string; text: string; verdict: AcceptanceVerdict; note?: string }>;
  evidenceRefs: string[];
  cost: { modelTokens: number; modelCostCny: number; toolCostCny: number; totalCostCny: number };
  risk: { level: RiskLevel; notes: string[] };
  rollback: { supported: boolean; instructions?: string };
  createdAt: string; updatedAt: string;
}
export interface CreateWorkOrderInput extends Omit<WorkOrder, 'id' | 'version' | 'status' | 'correlationId' | 'createdAt' | 'updatedAt' | 'inputRefs' | 'collaboratorActorRefs'> {
  id?: string;
  inputRefs?: string[];
  collaboratorActorRefs?: string[];
  correlationId?: string;
  createdAt?: string;
}
export interface CommandContext { actorRef: string; idempotencyKey: string; expectedVersion: number; correlationId?: string; occurredAt?: string }
export interface AcceptanceInput { actorRef: string; decision: 'accepted' | 'rejected'; verdicts: Array<{ criterionId: string; verdict: 'passed' | 'failed'; note?: string }>; note?: string }
export interface ResultPackageInput extends Omit<ResultPackage, 'id' | 'tenantId' | 'workOrderId' | 'status' | 'createdAt' | 'updatedAt'> { id?: string; createdAt?: string }
export type WorkOrderAction = 'submit' | 'approve' | 'reject' | 'plan' | 'start' | 'request-approval' | 'accept' | 'reject-result' | 'request-rework' | 'fail' | 'cancel' | 'archive';

export class DomainError extends Error {
  constructor(readonly code: 'not_found' | 'invalid_transition' | 'stale_version' | 'idempotency_conflict' | 'forbidden' | 'validation', message: string) { super(message); }
}

export class InMemoryWorkOrderService {
  readonly events: EventStore;
  private readonly orders = new Map<string, WorkOrder>();
  private readonly approvals = new Map<string, Approval>();
  private readonly resultPackages = new Map<string, ResultPackage>();
  private readonly evidences = new Map<string, Evidence>();
  private readonly commands = new Map<string, { orderId: string; result: unknown }>();
  private nextOrderId = 1;
  private nextApprovalId = 1;
  private nextEvidenceId = 1;
  private nextResultId = 1;

  constructor(options: { eventStore?: EventStore; now?: () => string } = {}) {
    this.events = options.eventStore ?? new InMemoryEventStore();
    this.now = options.now ?? (() => new Date().toISOString());
  }
  private readonly now: () => string;

  async create(input: CreateWorkOrderInput, context: CommandContext): Promise<WorkOrder> {
    this.requireCommand(context, 0);
    const replay = this.replay<WorkOrder>(context.idempotencyKey);
    if (replay) return replay;
    validateWorkOrderInput(input);
    if (input.id && this.orders.has(input.id)) throw new DomainError('idempotency_conflict', `WorkOrder ${input.id} already exists.`);
    const now = input.createdAt ?? context.occurredAt ?? this.now();
    const order: WorkOrder = freeze({
      id: input.id ?? `wo_${String(this.nextOrderId++).padStart(8, '0')}`,
      tenantId: input.tenantId, version: 0, title: input.title, goal: input.goal, scope: input.scope,
      inputRefs: [...(input.inputRefs ?? [])], acceptanceCriteria: input.acceptanceCriteria.map((item) => ({ ...item })),
      ownerActorRef: input.ownerActorRef, collaboratorActorRefs: [...(input.collaboratorActorRefs ?? [])],
      assignedEmployeeId: input.assignedEmployeeId, status: 'draft', riskLevel: input.riskLevel ?? 'low',
      budgetLimitCny: input.budgetLimitCny, ...(input.dueAt ? { dueAt: input.dueAt } : {}),
      correlationId: input.correlationId ?? context.correlationId ?? `cor_${orderIdSeed(input)}`,
      createdAt: now, updatedAt: now,
    });
    await this.events.append({ tenantId: order.tenantId, subjectRef: order.id, type: 'work_order.created', actorRef: context.actorRef, correlationId: order.correlationId, occurredAt: now, data: { workOrder: order } });
    this.orders.set(order.id, order);
    this.commands.set(context.idempotencyKey, { orderId: order.id, result: order });
    return order;
  }

  async submit(id: string, context: CommandContext): Promise<WorkOrder> { return this.transition(id, 'submit', context, 'submitted', 'work_order.submitted'); }
  async approve(id: string, context: CommandContext): Promise<WorkOrder> {
    const order = this.get(id);
    if (order.status === 'awaiting_approval') return this.decideApproval(id, context, 'approved');
    return this.transition(id, 'approve', context, 'approved', 'work_order.assigned');
  }
  async reject(id: string, context: CommandContext): Promise<WorkOrder> {
    const order = this.get(id);
    if (order.status === 'awaiting_approval') return this.decideApproval(id, context, 'rejected');
    return this.rejectResult(id, context, { actorRef: context.actorRef, decision: 'rejected', verdicts: order.acceptanceCriteria.map(({ id: criterionId }) => ({ criterionId, verdict: 'failed' })) });
  }
  async plan(id: string, context: CommandContext): Promise<WorkOrder> { return this.transition(id, 'plan', context, 'planned', 'work_order.planned'); }
  async start(id: string, context: CommandContext): Promise<WorkOrder> { return this.transition(id, 'start', context, 'running', 'work_order.started'); }

  async requestApproval(id: string, input: { action: string; riskLevel: RiskLevel; rationale: string; requesterActorRef: string; evidenceRefs?: string[] }, context: CommandContext): Promise<Approval> {
    const order = this.get(id);
    this.requireCommand(context, order.version);
    const replay = this.replay<Approval>(context.idempotencyKey);
    if (replay) return replay;
    if (order.status !== 'running') throw invalid(order, 'request-approval');
    if (!isSyntheticWrite(input.action) || input.riskLevel !== 'high') throw new DomainError('forbidden', 'Only high-risk synthetic writes are supported by the approval gate.');
    const now = context.occurredAt ?? this.now();
    const approval: Approval = freeze({ id: `apr_${String(this.nextApprovalId++).padStart(8, '0')}`, tenantId: order.tenantId, workOrderId: id, requesterActorRef: input.requesterActorRef, action: input.action, riskLevel: input.riskLevel, rationale: input.rationale, evidenceRefs: [...(input.evidenceRefs ?? [])], status: 'pending', createdAt: now });
    await this.events.append({ tenantId: order.tenantId, subjectRef: id, type: 'approval.requested', actorRef: input.requesterActorRef, correlationId: order.correlationId, occurredAt: now, data: { approvalId: approval.id, action: approval.action, riskLevel: approval.riskLevel, evidenceRefs: approval.evidenceRefs } });
    this.approvals.set(approval.id, approval);
    this.orders.set(id, await this.applyStatus(order, 'awaiting_approval', context, 'approval.requested', { approvalId: approval.id }));
    this.commands.set(context.idempotencyKey, { orderId: id, result: approval });
    return approval;
  }

  async decideApproval(id: string, context: CommandContext, decision: 'approved' | 'rejected', rationale?: string): Promise<WorkOrder> {
    const order = this.get(id);
    this.requireCommand(context, order.version);
    const replay = this.replay<WorkOrder>(context.idempotencyKey);
    if (replay) return replay;
    if (order.status !== 'awaiting_approval') throw invalid(order, 'approve');
    const approval = [...this.approvals.values()].filter((item) => item.workOrderId === id).at(-1);
    if (!approval || approval.status !== 'pending') throw new DomainError('invalid_transition', 'No pending approval is available.');
    if (!context.actorRef.startsWith('human:')) throw new DomainError('forbidden', 'Only a human actor can decide a protected action.');
    const now = context.occurredAt ?? this.now();
    const decided: Approval = freeze({ ...approval, approverActorRef: context.actorRef, decisionRationale: rationale, status: decision, decidedAt: now });
    await this.events.append({ tenantId: order.tenantId, subjectRef: id, type: 'approval.decided', actorRef: context.actorRef, correlationId: order.correlationId, occurredAt: now, data: { approvalId: approval.id, decision, rationale } });
    this.approvals.set(approval.id, decided);
    const nextStatus = decision === 'approved' ? 'running' : 'blocked';
    const next = await this.applyStatus(order, nextStatus, context, 'approval.decided', { approvalId: approval.id, decision });
    this.orders.set(id, next);
    this.commands.set(context.idempotencyKey, { orderId: id, result: next });
    return next;
  }

  async executeSyntheticWrite(id: string, context: CommandContext): Promise<{ approved: true; event: DomainEvent }> {
    const order = this.get(id);
    if (order.status !== 'running') throw new DomainError('forbidden', 'Synthetic write is not authorized before approval.');
    const approval = [...this.approvals.values()].filter((item) => item.workOrderId === id).at(-1);
    if (!approval || approval.status !== 'approved') throw new DomainError('forbidden', 'Synthetic write requires an approved high-risk action.');
    const event = await this.events.append({ tenantId: order.tenantId, subjectRef: id, type: 'tool.invoked', actorRef: context.actorRef, correlationId: order.correlationId, occurredAt: context.occurredAt ?? this.now(), data: { tool: 'synthetic_crm_csv_write', class: 'write', approvalId: approval.id, traceRef: 'trace_redacted' } });
    return { approved: true, event };
  }

  async createResultPackage(id: string, input: ResultPackageInput, context: CommandContext): Promise<ResultPackage> {
    const order = this.get(id);
    this.requireCommand(context, order.version);
    const replay = this.replay<ResultPackage>(context.idempotencyKey);
    if (replay) return replay;
    if (order.status !== 'running') throw invalid(order, 'deliver');
    validateResultPackageInput(input);
    const now = input.createdAt ?? context.occurredAt ?? this.now();
    const result: ResultPackage = freeze({ id: input.id ?? `res_${String(this.nextResultId++).padStart(8, '0')}`, tenantId: order.tenantId, workOrderId: id, status: 'delivered', ...cloneResultInput(input), createdAt: now, updatedAt: now });
    await this.events.append({ tenantId: order.tenantId, subjectRef: id, type: 'result_package.created', actorRef: context.actorRef, correlationId: order.correlationId, occurredAt: now, data: { resultPackage: result } });
    this.resultPackages.set(id, result);
    this.orders.set(id, await this.applyStatus(order, 'delivered', context, 'result_package.created', { resultPackageId: result.id }));
    this.commands.set(context.idempotencyKey, { orderId: id, result });
    return result;
  }

  async accept(id: string, input: AcceptanceInput, context: CommandContext): Promise<ResultPackage> { return this.decideResult(id, input, context, 'accepted'); }
  async rejectResult(id: string, context: CommandContext, input?: AcceptanceInput): Promise<WorkOrder> {
    const order = this.get(id);
    const result = await this.decideResult(id, input ?? { actorRef: context.actorRef, decision: 'rejected', verdicts: order.acceptanceCriteria.map(({ id: criterionId }) => ({ criterionId, verdict: 'failed' })) }, context, 'rejected');
    return this.get(id);
  }

  async addEvidence(id: string, input: { sourceRef: string; bytes: Uint8Array; redactedSummary: string; ownerActorRef: string }, context: CommandContext): Promise<Evidence> {
    const order = this.get(id);
    if (!input.sourceRef.trim() || !input.redactedSummary.trim()) throw new DomainError('validation', 'Evidence sourceRef and redactedSummary are required.');
    const hash = await sha256(input.bytes);
    const evidence: Evidence = freeze({ id: `evi_${String(this.nextEvidenceId++).padStart(8, '0')}`, tenantId: order.tenantId, workOrderId: id, sourceRef: input.sourceRef, hash, redactedSummary: input.redactedSummary, ownerActorRef: input.ownerActorRef, createdAt: context.occurredAt ?? this.now() });
    await this.events.append({ tenantId: order.tenantId, subjectRef: id, type: 'evidence.recorded', actorRef: input.ownerActorRef, correlationId: order.correlationId, occurredAt: evidence.createdAt, data: { evidenceId: evidence.id, sourceRef: evidence.sourceRef, hash: evidence.hash, redactedSummary: evidence.redactedSummary } });
    this.evidences.set(evidence.id, evidence);
    return evidence;
  }

  get(id: string): WorkOrder { const order = this.orders.get(id); if (!order) throw new DomainError('not_found', `WorkOrder ${id} was not found.`); return order; }
  getApproval(id: string): Approval { const approval = this.approvals.get(id); if (!approval) throw new DomainError('not_found', `Approval ${id} was not found.`); return approval; }
  getResultPackage(id: string): ResultPackage { const result = this.resultPackages.get(id); if (!result) throw new DomainError('not_found', `ResultPackage for ${id} was not found.`); return result; }
  listEvents(id: string, tenantId: string): readonly DomainEvent[] { return this.events.list(id, tenantId); }

  private async decideResult(id: string, input: AcceptanceInput, context: CommandContext, status: 'accepted' | 'rejected'): Promise<ResultPackage> {
    const order = this.get(id);
    this.requireCommand(context, order.version);
    const replay = this.replay<ResultPackage>(context.idempotencyKey);
    if (replay) return replay;
    if (order.status !== 'delivered') throw invalid(order, status === 'accepted' ? 'accept' : 'reject-result');
    if (!input.actorRef.startsWith('human:') || !context.actorRef.startsWith('human:')) throw new DomainError('forbidden', 'Result acceptance requires a human actor.');
    const existing = this.getResultPackage(id);
    const verdictById = new Map(input.verdicts.map((item) => [item.criterionId, item]));
    const acceptanceCriteria = existing.acceptanceCriteria.map((criterion) => ({ ...criterion, ...(verdictById.get(criterion.id) ? { verdict: verdictById.get(criterion.id)!.verdict, note: verdictById.get(criterion.id)!.note } : {}) }));
    const now = context.occurredAt ?? this.now();
    const updated = freeze({ ...existing, status, acceptanceCriteria, updatedAt: now });
    const eventType = status === 'accepted' ? 'result_package.accepted' : 'result_package.rejected';
    await this.events.append({ tenantId: order.tenantId, subjectRef: id, type: eventType, actorRef: context.actorRef, correlationId: order.correlationId, occurredAt: now, data: { resultPackageId: existing.id, verdicts: input.verdicts, note: input.note } });
    this.resultPackages.set(id, updated);
    this.orders.set(id, await this.applyStatus(order, status, context, eventType, { resultPackageId: existing.id }));
    this.commands.set(context.idempotencyKey, { orderId: id, result: updated });
    return updated;
  }

  private async transition(id: string, action: WorkOrderAction, context: CommandContext, nextStatus: WorkOrderStatus, eventType: 'work_order.submitted' | 'work_order.assigned' | 'work_order.planned' | 'work_order.started'): Promise<WorkOrder> {
    const replay = this.replay<WorkOrder>(context.idempotencyKey);
    if (replay) return replay;
    const order = this.get(id);
    this.requireCommand(context, order.version);
    if (!isAllowed(order.status, action, nextStatus)) throw invalid(order, action);
    const next = await this.applyStatus(order, nextStatus, context, eventType);
    this.orders.set(id, next);
    this.commands.set(context.idempotencyKey, { orderId: id, result: next });
    return next;
  }

  private async applyStatus(order: WorkOrder, status: WorkOrderStatus, context: CommandContext, type: Parameters<EventStore['append']>[0]['type'], data: Record<string, unknown> = {}): Promise<WorkOrder> {
    const next = freeze({ ...order, status, version: order.version + 1, updatedAt: context.occurredAt ?? this.now() });
    await this.events.append({ tenantId: order.tenantId, subjectRef: order.id, type, actorRef: context.actorRef, correlationId: order.correlationId, occurredAt: next.updatedAt, data: { from: order.status, to: status, ...data } });
    return next;
  }

  private requireCommand(context: CommandContext, expectedVersion: number): void {
    if (!context.idempotencyKey || context.idempotencyKey.length < 8) throw new DomainError('validation', 'idempotencyKey must contain at least 8 characters.');
    if (context.expectedVersion !== expectedVersion) throw new DomainError('stale_version', `expected version ${context.expectedVersion} but WorkOrder is at version ${expectedVersion}`);
  }
  private replay<T>(idempotencyKey: string): T | undefined { return this.commands.get(idempotencyKey)?.result as T | undefined; }
}

function validateWorkOrderInput(input: CreateWorkOrderInput): void {
  if (!input.tenantId.trim() || !input.title.trim() || !input.goal.trim() || !input.scope.trim()) throw new DomainError('validation', 'tenantId, title, goal and scope are required.');
  if (!/^((human|twin|employee|system|expert):)[A-Za-z0-9_-]+$/.test(input.ownerActorRef)) throw new DomainError('validation', 'ownerActorRef is invalid.');
  if (!/^employee_[A-Za-z0-9_-]+$/.test(input.assignedEmployeeId)) throw new DomainError('validation', 'assignedEmployeeId must use the employee_ prefix.');
  if (!Number.isFinite(input.budgetLimitCny) || input.budgetLimitCny < 0) throw new DomainError('validation', 'budgetLimitCny must be a non-negative finite number.');
  if (!input.acceptanceCriteria.length || input.acceptanceCriteria.some((criterion) => !criterion.id.trim() || !criterion.text.trim())) throw new DomainError('validation', 'At least one complete acceptance criterion is required.');
}
function validateResultPackageInput(input: ResultPackageInput): void {
  if (!input.summary.trim() || !input.deliverables.length || !input.evidenceRefs.length || !input.acceptanceCriteria.length) throw new DomainError('validation', 'ResultPackage requires summary, deliverables, acceptance criteria and evidence references.');
  if (input.acceptanceCriteria.some((criterion) => !['pending', 'passed', 'failed'].includes(criterion.verdict))) throw new DomainError('validation', 'Every acceptance criterion must have a verdict.');
  const { modelTokens, modelCostCny, toolCostCny, totalCostCny } = input.cost;
  if (![modelTokens, modelCostCny, toolCostCny, totalCostCny].every((value) => Number.isFinite(value) && value >= 0) || Math.abs(totalCostCny - modelCostCny - toolCostCny) > 1e-9) throw new DomainError('validation', 'ResultPackage cost values must be non-negative and reconcile.');
  if (!input.risk.notes.some((note) => note.trim()) || (input.rollback.supported && !input.rollback.instructions?.trim())) throw new DomainError('validation', 'ResultPackage risk notes and supported rollback instructions are required.');
}
function cloneResultInput(input: ResultPackageInput): Omit<ResultPackage, 'id' | 'tenantId' | 'workOrderId' | 'status' | 'createdAt' | 'updatedAt'> { return { summary: input.summary, deliverables: input.deliverables.map((item) => ({ ...item })), acceptanceCriteria: input.acceptanceCriteria.map((item) => ({ ...item })), evidenceRefs: [...input.evidenceRefs], cost: { ...input.cost }, risk: { level: input.risk.level, notes: [...input.risk.notes] }, rollback: { ...input.rollback } }; }
function isSyntheticWrite(action: string): boolean { return action === 'synthetic_crm_write' || action === 'synthetic_csv_write' || action === 'synthetic CRM/CSV write-back'; }
function isAllowed(current: WorkOrderStatus, action: WorkOrderAction, next: WorkOrderStatus): boolean {
  const transitions: Partial<Record<WorkOrderStatus, Partial<Record<WorkOrderAction, WorkOrderStatus>>>> = {
    draft: { submit: 'submitted', cancel: 'cancelled' },
    submitted: { approve: 'approved', cancel: 'cancelled' },
    approved: { plan: 'planned', cancel: 'cancelled' },
    planned: { start: 'running', cancel: 'cancelled' },
    running: { 'request-approval': 'awaiting_approval', fail: 'failed', cancel: 'cancelled' },
    awaiting_approval: { approve: 'running', reject: 'blocked', cancel: 'cancelled' },
    blocked: { archive: 'archived', cancel: 'cancelled' },
    delivered: { accept: 'accepted', 'reject-result': 'rejected' },
    rejected: { 'request-rework': 'planned', archive: 'archived' },
    accepted: { archive: 'archived' },
    failed: { archive: 'archived' },
    cancelled: { archive: 'archived' },
  };
  return transitions[current]?.[action] === next;
}
function invalid(order: WorkOrder, action: string): DomainError { return new DomainError('invalid_transition', `${action} is not allowed while WorkOrder is ${order.status}`); }
function freeze<T>(value: T): T { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value as Record<string, unknown>)) freeze(child); } return value; }
function inputSeed(input: CreateWorkOrderInput): string { return `${input.tenantId}:${input.title}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 24); }
function orderIdSeed(input: CreateWorkOrderInput): string { return inputSeed(input) || 'work_order'; }
async function sha256(bytes: Uint8Array): Promise<string> { const buffer = new ArrayBuffer(bytes.byteLength); new Uint8Array(buffer).set(bytes); const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer); return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(''); }

export { InMemoryEventStore } from '../audit/index.ts';
