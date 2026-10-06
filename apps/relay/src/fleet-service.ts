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
  type TenantAuditEvent,
  type TenantAuditExport,
  type TenantChainHead,
  type TenantQuotaCounter,
  type ValidationResult,
} from './ports.js';
import { assertQuotaDay, validateQuotaLimits, validateQuotaUsage } from './governance.js';
import { assertNodeTenantAuthorization, resolveAuthorizedTenantIds } from './tenant-boundary.js';

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
    const authorizedTenantIds = resolveAuthorizedTenantIds(
      session.tenantId,
      session.authorizedTenantIds,
      session.tenantGrantRef,
    );
    assertNodeTenantAuthorization(
      session.tenantId,
      result.meta.tenantIds,
      authorizedTenantIds,
      session.tenantGrantRef,
    );
    return this.store.registerNode(
      session.tenantId,
      result.value,
      result.meta,
      authorizedTenantIds,
      session.tenantGrantRef,
      this.isoNow(),
      this.#offlineAfterMs,
    );
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

  async getNode(session: AuthenticatedFleetSession, nodeId: string): Promise<FleetNodeRecord | null> {
    if (!nodeId.trim()) return null;
    return this.store.getNode(session.tenantId, nodeId, this.isoNow());
  }

  async listNodes(session: AuthenticatedFleetSession): Promise<readonly FleetNodeRecord[]> {
    return this.store.listNodes(session.tenantId, this.isoNow());
  }

  async getTask(session: AuthenticatedFleetSession, taskId: string): Promise<FleetTaskRecord | null> {
    if (!taskId.trim()) return null;
    return this.store.getTask(session.tenantId, taskId, this.isoNow());
  }

  async listTasks(session: AuthenticatedFleetSession): Promise<readonly FleetTaskRecord[]> {
    return this.store.listTasks(session.tenantId, this.isoNow());
  }

  async getApprovalRequest(
    session: AuthenticatedFleetSession,
    requestId: string,
  ): Promise<ApprovalRequestRecord | null> {
    if (!requestId.trim()) return null;
    return this.store.getApprovalRequest(session.tenantId, requestId);
  }

  async listApprovalRequests(
    session: AuthenticatedFleetSession,
  ): Promise<readonly ApprovalRequestRecord[]> {
    return this.store.listApprovalRequests(session.tenantId);
  }

  async configureQuota(
    session: AuthenticatedFleetSession,
    nodeId: string,
    day: string,
    input: unknown,
  ): Promise<readonly TenantQuotaCounter[]> {
    if (session.nodeId || !/^(?:human|account):[A-Za-z0-9_-]+$/.test(session.actorRef)) {
      throw new FleetRejectedError('actor_mismatch', 'quota configuration requires a human/account control session');
    }
    if (!nodeId.trim()) throw new FleetRejectedError('node_unknown', 'node id is required');
    assertQuotaDay(day);
    const body = exactRecord(input, ['limits'], 'quota configuration');
    const limits = validateQuotaLimits(body.limits);
    return this.store.configureQuota(session.tenantId, nodeId, day, limits, session.actorRef, this.isoNow());
  }

  async recordQuotaUsage(
    session: AuthenticatedFleetSession,
    nodeId: string,
    input: unknown,
  ): Promise<readonly TenantQuotaCounter[]> {
    if (!session.nodeId) throw new FleetRejectedError('actor_mismatch', 'quota usage requires a node-bound session');
    assertNode(session, nodeId, 'quota usage');
    const usage = validateQuotaUsage(input);
    return this.store.recordQuotaUsage(session.tenantId, nodeId, usage, session.actorRef, this.isoNow());
  }

  async listQuotaCounters(
    session: AuthenticatedFleetSession,
    nodeId: string,
    day: string,
  ): Promise<readonly TenantQuotaCounter[]> {
    if (!nodeId.trim()) throw new FleetRejectedError('node_unknown', 'node id is required');
    assertNode(session, nodeId, 'quota read');
    assertQuotaDay(day);
    return this.store.listQuotaCounters(session.tenantId, nodeId, day);
  }

  async getTenantChainHead(session: AuthenticatedFleetSession): Promise<TenantChainHead | null> {
    return this.store.getTenantChainHead(session.tenantId);
  }

  async listTenantAudit(
    session: AuthenticatedFleetSession,
    rangeFrom?: number,
    rangeTo?: number,
  ): Promise<readonly TenantAuditEvent[]> {
    return this.store.listTenantAudit(session.tenantId, rangeFrom, rangeTo);
  }

  async createAuditExport(session: AuthenticatedFleetSession, input: unknown): Promise<TenantAuditExport> {
    if (session.nodeId || !/^(?:human|account):[A-Za-z0-9_-]+$/.test(session.actorRef)) {
      throw new FleetRejectedError('actor_mismatch', 'audit export requires a human/account control session');
    }
    const body = exactRecord(input, ['rangeFrom', 'rangeTo'], 'audit export');
    const rangeFrom = optionalPositiveInteger(body.rangeFrom, 'rangeFrom');
    const rangeTo = optionalPositiveInteger(body.rangeTo, 'rangeTo');
    if (rangeFrom !== undefined && rangeTo !== undefined && rangeTo < rangeFrom) {
      throw new FleetRejectedError('invalid_contract', 'audit range is invalid');
    }
    return this.store.createAuditExport(session.tenantId, rangeFrom, rangeTo, session.actorRef, this.isoNow());
  }

  async getAuditExport(session: AuthenticatedFleetSession, exportId: string): Promise<TenantAuditExport | null> {
    if (!exportId.trim()) throw new FleetRejectedError('audit_export_not_found', 'audit export was not found');
    return this.store.getAuditExport(session.tenantId, exportId);
  }

  private isoNow(): string {
    return this.#now().toISOString();
  }
}

function exactRecord(input: unknown, allowed: readonly string[], subject: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new FleetRejectedError('invalid_contract', `${subject} must be an object`);
  }
  const record = input as Record<string, unknown>;
  if (Object.keys(record).some((key) => !allowed.includes(key))) {
    throw new FleetRejectedError('invalid_contract', `${subject} contains an unknown field`);
  }
  return record;
}

function optionalPositiveInteger(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new FleetRejectedError('invalid_contract', `${field} must be a positive integer`);
  }
  return value as number;
}
