import {
  FleetRejectedError,
  type AuthenticatedFleetSession,
  type ApprovalBundle,
  type ApprovalDecisionRecord,
  type ApprovalRequestRecord,
  type EnqueueResult,
  type EventResult,
  type FleetIngress,
  type FleetNodeRecord,
  type FleetStore,
  type FleetTaskRecord,
  type FleetValidators,
  type ValidationResult,
} from './ports.js';

export interface FleetServiceOptions {
  offlineAfterMs?: number;
  now?: () => Date;
}

function accepted<T>(result: ValidationResult<T>): asserts result is Extract<ValidationResult<T>, { ok: true }> {
  if (!result.ok) throw new FleetRejectedError('invalid_contract', result.reason);
}

function assertTenant(actual: string, expected: string, subject: string): void {
  if (actual !== expected) {
    throw new FleetRejectedError('tenant_mismatch', `${subject} tenant does not match the authenticated session`);
  }
}

function assertNode(session: AuthenticatedFleetSession, actual: string, subject: string): void {
  if (session.nodeId && session.nodeId !== actual) {
    throw new FleetRejectedError('lease_owner_mismatch', `${subject} node does not match the authenticated session`);
  }
}

function assertActor(actual: string, expected: string, subject: string): void {
  if (actual !== expected) {
    throw new FleetRejectedError('actor_mismatch', `${subject} actor does not match the authenticated session`);
  }
}

export class FleetService implements FleetIngress {
  readonly #offlineAfterMs: number;
  readonly #now: () => Date;

  constructor(
    private readonly store: FleetStore,
    private readonly validators: FleetValidators,
    options: FleetServiceOptions = {},
  ) {
    this.#offlineAfterMs = options.offlineAfterMs ?? 60_000;
    this.#now = options.now ?? (() => new Date());
  }

  async register(session: AuthenticatedFleetSession, input: unknown): Promise<FleetNodeRecord> {
    const result = this.validators.nodeManifest.validate(input);
    accepted(result);
    assertNode(session, result.meta.nodeId, 'node manifest');
    if (!result.meta.tenantIds.includes(session.tenantId)) {
      throw new FleetRejectedError('tenant_mismatch', 'node manifest is not authorized for this tenant');
    }
    return this.store.registerNode(session.tenantId, result.value, result.meta, this.isoNow(), this.#offlineAfterMs);
  }

  async heartbeat(session: AuthenticatedFleetSession, input: unknown): Promise<FleetNodeRecord> {
    const result = this.validators.heartbeat.validate(input);
    accepted(result);
    assertNode(session, result.meta.nodeId, 'heartbeat');
    return this.store.heartbeat(session.tenantId, result.meta, this.isoNow());
  }

  async enqueue(session: AuthenticatedFleetSession, input: unknown): Promise<EnqueueResult> {
    const result = this.validators.taskEnvelope.validate(input);
    accepted(result);
    assertTenant(result.meta.tenantId, session.tenantId, 'task envelope');
    return this.store.enqueueTask(session.tenantId, result.value, result.meta, null, this.isoNow());
  }

  async claim(session: AuthenticatedFleetSession, nodeId: string): Promise<FleetTaskRecord | null> {
    if (!nodeId.trim()) throw new FleetRejectedError('node_unknown', 'node id is required');
    assertNode(session, nodeId, 'claim');
    return this.store.claimTask(session.tenantId, nodeId, this.isoNow());
  }

  async event(session: AuthenticatedFleetSession, input: unknown): Promise<EventResult> {
    return this.ingestEvent(session, input);
  }

  async ack(session: AuthenticatedFleetSession, input: unknown): Promise<EventResult> {
    return this.ingestEvent(session, input, 'started');
  }

  async complete(session: AuthenticatedFleetSession, input: unknown): Promise<EventResult> {
    return this.ingestEvent(session, input, 'completed');
  }

  async fail(session: AuthenticatedFleetSession, input: unknown): Promise<EventResult> {
    return this.ingestEvent(session, input, 'failed');
  }

  async requestApproval(
    session: AuthenticatedFleetSession,
    taskId: string,
    input: unknown,
  ): Promise<ApprovalRequestRecord> {
    if (!taskId.trim()) throw new FleetRejectedError('invalid_transition', 'task id is required');
    if (!session.nodeId) throw new FleetRejectedError('actor_mismatch', 'approval requests require a node-bound session');
    const result = this.validators.approvalRequest.validate(input);
    accepted(result);
    assertTenant(result.meta.tenantId, session.tenantId, 'approval request');
    assertNode(session, result.meta.nodeId, 'approval request');
    assertActor(result.meta.requestedBy, session.actorRef, 'approval request');
    return this.store.putApprovalRequest(session.tenantId, taskId, result.value, result.meta, this.isoNow());
  }

  async decideApproval(
    session: AuthenticatedFleetSession,
    requestId: string,
    input: unknown,
  ): Promise<ApprovalDecisionRecord> {
    if (!requestId.trim()) throw new FleetRejectedError('approval_not_found', 'approval request id is required');
    if (session.nodeId || !/^(?:human|account):[A-Za-z0-9_-]+$/.test(session.actorRef)) {
      throw new FleetRejectedError('actor_mismatch', 'approval decisions require a human/account control session');
    }
    const result = this.validators.approvalDecision.validate(input);
    accepted(result);
    assertTenant(result.meta.tenantId, session.tenantId, 'approval decision');
    if (result.meta.requestId !== requestId) {
      throw new FleetRejectedError('approval_not_found', 'approval decision does not match the requested record');
    }
    assertActor(result.meta.deciderActorRef, session.actorRef, 'approval decision');
    return this.store.putApprovalDecision(session.tenantId, result.value, result.meta, this.isoNow());
  }

  async consumeApproval(
    session: AuthenticatedFleetSession,
    nodeId: string,
    taskId: string,
    requestId: string,
  ): Promise<ApprovalBundle> {
    if (!taskId.trim() || !requestId.trim()) {
      throw new FleetRejectedError('approval_not_found', 'task id and approval request id are required');
    }
    if (!session.nodeId) throw new FleetRejectedError('actor_mismatch', 'approval consumption requires a node-bound session');
    assertNode(session, nodeId, 'approval consumption');
    return this.store.consumeApprovalDecision(session.tenantId, nodeId, taskId, requestId, this.isoNow());
  }

  private async ingestEvent(
    session: AuthenticatedFleetSession,
    input: unknown,
    expectedType?: 'started' | 'completed' | 'failed',
  ): Promise<EventResult> {
    const result = this.validators.runEvent.validate(input);
    accepted(result);
    assertTenant(result.meta.tenantId, session.tenantId, 'run event');
    assertNode(session, result.meta.nodeId, 'run event');
    if (expectedType && result.meta.type !== expectedType) {
      throw new FleetRejectedError('invalid_transition', `expected a ${expectedType} event`);
    }
    return this.store.putEvent(session.tenantId, result.value, result.meta, this.isoNow());
  }

  async stop(session: AuthenticatedFleetSession, taskId: string): Promise<FleetTaskRecord> {
    if (!taskId.trim()) throw new FleetRejectedError('invalid_transition', 'task id is required');
    return this.store.stopTask(session.tenantId, taskId, session.actorRef, this.isoNow());
  }

  async retry(session: AuthenticatedFleetSession, previousTaskId: string, nextEnvelope: unknown): Promise<EnqueueResult> {
    const now = this.isoNow();
    const previous = await this.store.getTask(session.tenantId, previousTaskId, now);
    if (!previous) throw new FleetRejectedError('invalid_transition', 'retry source task was not found');
    if (previous.status !== 'failed' && previous.status !== 'blocked') {
      throw new FleetRejectedError('invalid_transition', 'only failed or blocked tasks may be retried');
    }
    const result = this.validators.taskEnvelope.validate(nextEnvelope);
    accepted(result);
    assertTenant(result.meta.tenantId, session.tenantId, 'retry envelope');
    if (result.meta.idempotencyKey === previous.idempotencyKey) {
      throw new FleetRejectedError('retry_key_reused', 'retry requires a new idempotency key');
    }
    if (result.meta.workOrderId !== previous.workOrderId || result.meta.originRef !== previous.originRef) {
      throw new FleetRejectedError('invalid_transition', 'retry must stay in the same work-order lineage');
    }
    return this.store.enqueueTask(session.tenantId, result.value, result.meta, previous.taskId, now);
  }

  private isoNow(): string {
    return this.#now().toISOString();
  }
}
