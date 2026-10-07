import {
  FleetRejectedError,
  type ApprovalBundle,
  type ApprovalAuthorization,
  type ApprovalDecisionClaims,
  type ApprovalDecisionRecord,
  type ApprovalRequestClaims,
  type ApprovalRequestRecord,
  type ApprovalRevocationRecord,
  type EnqueueResult,
  type EventResult,
  type FleetNodeRecord,
  type FleetObject,
  type FleetStore,
  type FleetTaskRecord,
  type HeartbeatClaims,
  type NodeClaims,
  type RelayAuditEntry,
  type RunEventClaims,
  type TaskClaims,
  type TenantAuditAction,
  type TenantAuditEvent,
  type TenantAuditExport,
  type TenantChainHead,
  type TenantQuotaCounter,
  type TenantQuotaLimits,
  type TenantQuotaMetric,
  type TenantQuotaUsage,
  type CapabilityCatalogItem,
  type CapabilityRegistryRecord,
  type CapabilityShareCreateInput,
  type CapabilityTrialRecordInput,
  type CapabilityVersionCreateInput,
} from './ports.js';
import type { CapabilityInstallGateDecision, CapabilityInstallGateInput, CapabilityShareInvitation, SkillTrialSystemRecordInput, TeamReadOnlyShare } from '@hummer/contracts';
import {
  assertCapabilityHistory,
  assertCapabilityDraftSource,
  capabilityRecordFromShare,
  buildCapabilityShare,
  createTrialAggregate,
  rebindCapabilityInstallDecision,
} from './capability-registry.js';
import { canonicalJson } from './canonical-json.js';
import {
  TENANT_QUOTA_METRICS,
  assertQuotaDay,
  buildAuditExport,
  buildTenantAuditEvent,
  chainHeadFrom,
  utcDay,
  validateQuotaLimits,
  validateQuotaUsage,
} from './governance.js';
import { assertEventWithinLease, canonicalUtcTimestamp } from './relay-time.js';
import { assertNodeTenantAuthorization } from './tenant-boundary.js';

const key = (tenantId: string, id: string) => `${tenantId}\u0000${id}`;
const capabilityVersionKey = (tenantId: string, packageId: string, version: number) => `${tenantId}\u0000${packageId}\u0000${version}`;
const quotaKey = (tenantId: string, nodeId: string, day: string, metric: TenantQuotaMetric) => `${tenantId}\u0000${nodeId}\u0000${day}\u0000${metric}`;
const clone = <T>(value: T): T => structuredClone(value);

function isSubset(granted: readonly string[] | undefined, requested: readonly string[] | undefined): boolean {
  if (!granted) return true;
  if (!requested) return false;
  const allowed = new Set(requested);
  return granted.every((value) => allowed.has(value));
}

function assertDecisionWithinRequest(
  request: ApprovalRequestRecord,
  decision: ApprovalDecisionClaims,
  now: string,
): void {
  if (Date.parse(request.expiresAt) <= Date.parse(now)) {
    throw new FleetRejectedError('approval_expired', 'approval request has expired');
  }
  const decidedAt = Date.parse(decision.decidedAt);
  if (!Number.isFinite(decidedAt) || decidedAt > Date.parse(now) || decidedAt < Date.parse(request.createdAt)) {
    throw new FleetRejectedError('invalid_contract', 'approval decision time is outside the request lifetime');
  }
  if (decision.decision !== 'approved') return;
  const granted = decision.grantedScope;
  if (!granted || !isSubset(granted.capabilities, request.requestedScope.capabilities)
    || !isSubset(granted.paths, request.requestedScope.paths)
    || (request.requestedScope.maxUses !== undefined && (granted.maxUses ?? 1) > request.requestedScope.maxUses)) {
    throw new FleetRejectedError('approval_scope_exceeded', 'approval grant exceeds the requested scope');
  }
  const grantedExpiry = Date.parse(granted.expiresAt);
  if (!Number.isFinite(grantedExpiry) || grantedExpiry <= Date.parse(now) || grantedExpiry > Date.parse(request.expiresAt)) {
    throw new FleetRejectedError('approval_expired', 'approval grant expiry is outside the request lifetime');
  }
}

interface StoredEvent {
  claims: RunEventClaims;
  event: FleetObject;
}

export class MemoryFleetStore implements FleetStore {
  readonly #nodes = new Map<string, FleetNodeRecord>();
  readonly #tasks = new Map<string, FleetTaskRecord>();
  readonly #taskByIdempotency = new Map<string, string>();
  readonly #events = new Map<string, StoredEvent[]>();
  readonly #eventByIdempotency = new Map<string, EventResult>();
  readonly #audit: RelayAuditEntry[] = [];
  readonly #approvalRequests = new Map<string, ApprovalRequestRecord>();
  readonly #approvalRequestByTask = new Map<string, string>();
  readonly #approvalDecisions = new Map<string, ApprovalDecisionRecord>();
  readonly #approvalDecisionIds = new Set<string>();
  readonly #approvalConsumptions = new Set<string>();
  readonly #approvalRevocations = new Map<string, ApprovalRevocationRecord>();
  readonly #tenantAudit = new Map<string, TenantAuditEvent[]>();
  readonly #quotaCounters = new Map<string, TenantQuotaCounter>();
  readonly #auditExports = new Map<string, TenantAuditExport>();
  readonly #capabilityPackages = new Map<string, CapabilityRegistryRecord>();
  readonly #capabilityTrials = new Map<string, SkillTrialSystemRecordInput>();
  readonly #capabilityShares = new Map<string, TeamReadOnlyShare>();
  readonly #capabilityInstallDecisions = new Map<string, CapabilityInstallGateDecision>();
  #clockHighWaterMs = 0;

  async registerNode(
    tenantId: string,
    manifest: FleetObject,
    claims: NodeClaims,
    authorizedTenantIds: readonly string[],
    tenantGrantRef: string | undefined,
    now: string,
    offlineAfterMs: number,
  ): Promise<FleetNodeRecord> {
    this.advanceClock(now);
    assertNodeTenantAuthorization(tenantId, claims.tenantIds, authorizedTenantIds, tenantGrantRef);
    const record: FleetNodeRecord = { ...claims, tenantIds: [...claims.tenantIds], tenantId, manifest: clone(manifest), status: 'online', lastSeenAt: now, offlineAfterMs };
    this.#nodes.set(key(tenantId, claims.nodeId), record);
    this.appendTenantAudit(tenantId, 'node.registered', claims.nodeId, claims.nodeId, 'system:relay', now, { agentVersion: claims.agentVersion });
    return clone(record);
  }

  async heartbeat(tenantId: string, claims: HeartbeatClaims, now: string): Promise<FleetNodeRecord> {
    this.advanceClock(now);
    const nodeKey = key(tenantId, claims.nodeId);
    const node = this.#nodes.get(nodeKey);
    if (!node) throw new FleetRejectedError('node_unknown', 'heartbeat node is not registered for this tenant');
    const activeLeases = [...this.#tasks.values()].filter((task) =>
      task.tenantId === tenantId
      && task.status === 'leased'
      && task.leaseOwnerNodeId === claims.nodeId
      && task.leaseExpiresAt !== null
      && Date.parse(task.leaseExpiresAt) > Date.parse(now)).length;
    if (claims.running !== activeLeases) {
      throw new FleetRejectedError(
        'heartbeat_load_mismatch',
        `heartbeat reports ${claims.running} running tasks but Relay has ${activeLeases} active leases`,
      );
    }
    this.recoverExpiredLeases(tenantId, now);
    node.lastSeenAt = now;
    node.status = 'online';
    return clone(node);
  }

  async getNode(tenantId: string, nodeId: string, now: string): Promise<FleetNodeRecord | null> {
    this.advanceClock(now);
    const node = this.#nodes.get(key(tenantId, nodeId));
    if (!node) return null;
    this.refreshNode(node, now);
    return clone(node);
  }

  async listNodes(tenantId: string, now: string): Promise<readonly FleetNodeRecord[]> {
    this.advanceClock(now);
    return [...this.#nodes.values()]
      .filter((node) => node.tenantId === tenantId)
      .map((node) => {
        this.refreshNode(node, now);
        return clone(node);
      })
      .sort((left, right) => left.nodeId.localeCompare(right.nodeId));
  }

  async enqueueTask(tenantId: string, envelope: FleetObject, claims: TaskClaims, retryOfTaskId: string | null, now: string): Promise<EnqueueResult> {
    this.advanceClock(now);
    const expiresAt = canonicalUtcTimestamp(claims.expiresAt, 'task expiresAt');
    if (Date.parse(expiresAt) <= Date.parse(now)) throw new FleetRejectedError('task_expired', 'expired task cannot be queued');
    const duplicateTaskId = this.#taskByIdempotency.get(key(tenantId, claims.idempotencyKey));
    if (duplicateTaskId) {
      const duplicate = this.#tasks.get(key(tenantId, duplicateTaskId))!;
      if (canonicalJson(duplicate.envelope) !== canonicalJson(envelope)) {
        throw new FleetRejectedError('duplicate_delivery', 'idempotency key was reused with a different task envelope');
      }
      return { task: clone(duplicate), inserted: false };
    }
    this.assertQuotaAvailable(tenantId, claims.targetNodeId, now);
    const record: FleetTaskRecord = {
      ...claims,
      expiresAt,
      tenantId,
      envelope: clone(envelope),
      status: 'queued',
      attempt: 0,
      leaseOwnerNodeId: null,
      leaseExpiresAt: null,
      retryOfTaskId,
    };
    if (this.#tasks.has(key(tenantId, record.taskId))) throw new FleetRejectedError('duplicate_delivery', 'task id already exists');
    this.#tasks.set(key(tenantId, record.taskId), record);
    this.#taskByIdempotency.set(key(tenantId, record.idempotencyKey), record.taskId);
    this.appendTenantAudit(tenantId, 'task.enqueued', record.taskId, record.targetNodeId, 'system:relay', now, { workOrderId: record.workOrderId });
    if (retryOfTaskId) {
      this.#audit.push({ tenantId, action: 'retry', taskId: record.taskId, actorRef: 'system:relay', at: now, detail: `retry-of:${retryOfTaskId}` });
      this.appendTenantAudit(tenantId, 'task.retried', record.taskId, record.targetNodeId, 'system:relay', now, { retryOfTaskId });
    }
    this.incrementQuota(tenantId, record.targetNodeId, utcDay(now), 'tasks', 1, now);
    return { task: clone(record), inserted: true };
  }

  async claimTask(tenantId: string, nodeId: string, now: string): Promise<FleetTaskRecord | null> {
    this.advanceClock(now);
    const node = this.#nodes.get(key(tenantId, nodeId));
    if (!node) throw new FleetRejectedError('node_unknown', 'claiming node is not registered');
    this.refreshNode(node, now);
    if (node.status !== 'online') throw new FleetRejectedError('node_offline', 'offline node cannot claim tasks');
    this.recoverExpiredLeases(tenantId, now);
    const task = [...this.#tasks.values()].find((candidate) =>
      candidate.tenantId === tenantId && candidate.targetNodeId === nodeId && candidate.status === 'queued' && Date.parse(candidate.expiresAt) > Date.parse(now));
    if (!task) return null;
    task.status = 'leased';
    task.attempt += 1;
    task.leaseOwnerNodeId = nodeId;
    task.leaseExpiresAt = new Date(Date.parse(now) + task.leaseMs).toISOString();
    this.appendTenantAudit(tenantId, 'task.claimed', task.taskId, nodeId, `system:${nodeId}`, now, { attempt: task.attempt });
    return clone(task);
  }

  async putEvent(tenantId: string, event: FleetObject, claims: RunEventClaims, now: string): Promise<EventResult> {
    this.advanceClock(now);
    const duplicate = this.#eventByIdempotency.get(key(tenantId, claims.idempotencyKey));
    if (duplicate) {
      const stored = (this.#events.get(key(tenantId, claims.workOrderId)) ?? [])
        .find((entry) => entry.claims.idempotencyKey === claims.idempotencyKey);
      if (!stored || canonicalJson(stored.event) !== canonicalJson(event)) {
        throw new FleetRejectedError('duplicate_delivery', 'idempotency key was reused with a different run event');
      }
      return { inserted: false, task: clone(duplicate.task) };
    }
    const node = this.#nodes.get(key(tenantId, claims.nodeId));
    if (!node) throw new FleetRejectedError('node_unknown', 'event node is not registered');
    this.refreshNode(node, now);
    if (node.status !== 'online') throw new FleetRejectedError('node_offline', 'offline node cannot append run events');
    const task = [...this.#tasks.values()].reverse().find((candidate) => candidate.tenantId === tenantId && candidate.workOrderId === claims.workOrderId);
    if (!task) throw new FleetRejectedError('invalid_transition', 'event work order is not queued');
    this.assertActiveLease(task, claims.nodeId, now);
    assertEventWithinLease(claims.occurredAt, now, task.leaseExpiresAt!, task.leaseMs);
    const events = this.#events.get(key(tenantId, claims.workOrderId)) ?? [];
    const expectedSeq = events.length + 1;
    if (claims.seq !== expectedSeq) throw new FleetRejectedError('sequence_gap', `expected event sequence ${expectedSeq}`);
    if (claims.type === 'completed' && !events.some((entry) => entry.claims.type === 'artifact')) {
      throw new FleetRejectedError('invalid_transition', 'completed requires at least one artifact event');
    }
    events.push({ claims: clone(claims), event: clone(event) });
    this.#events.set(key(tenantId, claims.workOrderId), events);
    if (claims.type === 'completed') task.status = 'completed';
    else if (claims.type === 'failed') task.status = 'failed';
    else if (claims.type === 'cancelled' || claims.type === 'needs_approval') task.status = 'blocked';
    if (task.status !== 'leased') {
      task.leaseOwnerNodeId = null;
      task.leaseExpiresAt = null;
    }
    const result = { inserted: true, task: clone(task) };
    this.#eventByIdempotency.set(key(tenantId, claims.idempotencyKey), result);
    this.appendTenantAudit(tenantId, 'run.event', claims.eventId, claims.nodeId, `system:${claims.nodeId}`, now, {
      workOrderId: claims.workOrderId, seq: claims.seq, type: claims.type,
    });
    return result;
  }

  async stopTask(tenantId: string, taskId: string, actorRef: string, now: string): Promise<FleetTaskRecord> {
    this.advanceClock(now);
    const task = this.#tasks.get(key(tenantId, taskId));
    if (!task) throw new FleetRejectedError('invalid_transition', 'task was not found');
    if (task.status === 'completed' || task.status === 'failed') throw new FleetRejectedError('invalid_transition', 'terminal task cannot be stopped');
    task.status = 'blocked';
    task.leaseOwnerNodeId = null;
    task.leaseExpiresAt = null;
    this.#audit.push({ tenantId, action: 'stop', taskId, actorRef, at: now, detail: 'task-blocked' });
    this.appendTenantAudit(tenantId, 'task.stopped', taskId, task.targetNodeId, actorRef, now, {});
    return clone(task);
  }

  async getTask(tenantId: string, taskId: string, now: string): Promise<FleetTaskRecord | null> {
    this.advanceClock(now);
    this.recoverExpiredLeases(tenantId, now);
    const task = this.#tasks.get(key(tenantId, taskId));
    return task ? clone(task) : null;
  }

  async listTasks(tenantId: string, now: string): Promise<readonly FleetTaskRecord[]> {
    this.advanceClock(now);
    this.recoverExpiredLeases(tenantId, now);
    return [...this.#tasks.values()]
      .filter((task) => task.tenantId === tenantId)
      .map((task) => clone(task))
      .sort((left, right) => left.taskId.localeCompare(right.taskId));
  }

  async putApprovalRequest(
    tenantId: string,
    taskId: string,
    request: FleetObject,
    claims: ApprovalRequestClaims,
    now: string,
  ): Promise<ApprovalRequestRecord> {
    this.advanceClock(now);
    if (Date.parse(claims.expiresAt) <= Date.parse(now)) {
      throw new FleetRejectedError('approval_expired', 'expired approval request cannot be recorded');
    }
    const task = this.#tasks.get(key(tenantId, taskId));
    if (!task) throw new FleetRejectedError('approval_not_found', 'pending claim was not found');
    this.assertActiveLease(task, claims.nodeId, now);
    if (task.workOrderId !== claims.workOrderId || task.leaseOwnerNodeId !== claims.nodeId) {
      throw new FleetRejectedError('lease_owner_mismatch', 'approval request does not match the pending claim');
    }
    if (this.#approvalRequests.has(key(tenantId, claims.requestId)) || this.#approvalRequestByTask.has(key(tenantId, taskId))) {
      throw new FleetRejectedError('approval_replayed', 'pending claim already has an approval request');
    }
    const record: ApprovalRequestRecord = {
      ...claims,
      requestedScope: clone(claims.requestedScope),
      taskId,
      request: clone(request),
      createdAt: now,
    };
    this.#approvalRequests.set(key(tenantId, claims.requestId), record);
    this.#approvalRequestByTask.set(key(tenantId, taskId), claims.requestId);
    this.appendTenantAudit(tenantId, 'approval.requested', claims.requestId, claims.nodeId, claims.requestedBy, now, { taskId, workOrderId: claims.workOrderId });
    return clone(record);
  }

  async putApprovalDecision(
    tenantId: string,
    decision: FleetObject,
    claims: ApprovalDecisionClaims,
    now: string,
  ): Promise<ApprovalDecisionRecord> {
    this.advanceClock(now);
    const request = this.#approvalRequests.get(key(tenantId, claims.requestId));
    if (!request) throw new FleetRejectedError('approval_not_found', 'approval request was not found');
    if (this.#approvalDecisions.has(key(tenantId, claims.requestId)) || this.#approvalDecisionIds.has(key(tenantId, claims.decisionId))) {
      throw new FleetRejectedError('approval_replayed', 'approval request already has an immutable decision');
    }
    assertDecisionWithinRequest(request, claims, now);
    const task = this.#tasks.get(key(tenantId, request.taskId));
    if (!task) throw new FleetRejectedError('approval_not_found', 'pending claim was not found');
    if (claims.decision !== 'approved' && task.status !== 'queued' && task.status !== 'leased') {
      throw new FleetRejectedError('invalid_transition', 'non-approved decision cannot replace a terminal or stopped task state');
    }
    const record: ApprovalDecisionRecord = {
      ...claims,
      ...(claims.grantedScope ? { grantedScope: clone(claims.grantedScope) } : {}),
      decisionRecord: clone(decision),
      createdAt: now,
    };
    this.#approvalDecisions.set(key(tenantId, claims.requestId), record);
    this.#approvalDecisionIds.add(key(tenantId, claims.decisionId));
    if (claims.decision !== 'approved') {
      task.status = 'failed';
      task.leaseOwnerNodeId = null;
      task.leaseExpiresAt = null;
    }
    this.appendTenantAudit(tenantId, 'approval.decided', claims.decisionId, request.nodeId, claims.deciderActorRef, now, {
      requestId: claims.requestId, taskId: request.taskId, decision: claims.decision,
      taskStatus: claims.decision === 'approved' ? task.status : 'failed',
    });
    return clone(record);
  }

  async consumeApprovalDecision(
    tenantId: string,
    nodeId: string,
    taskId: string,
    requestId: string,
    now: string,
  ): Promise<ApprovalBundle> {
    this.advanceClock(now);
    const request = this.#approvalRequests.get(key(tenantId, requestId));
    const decision = this.#approvalDecisions.get(key(tenantId, requestId));
    if (!request || request.taskId !== taskId) throw new FleetRejectedError('approval_not_found', 'approval request is not bound to this claim');
    if (request.nodeId !== nodeId) throw new FleetRejectedError('lease_owner_mismatch', 'approval request is not bound to this node');
    const task = this.#tasks.get(key(tenantId, taskId));
    if (!task) throw new FleetRejectedError('approval_not_found', 'pending claim was not found');
    if (!decision) throw new FleetRejectedError('approval_not_found', 'approval decision is not available');
    if (this.#approvalRevocations.has(key(tenantId, requestId))) {
      throw new FleetRejectedError('approval_replayed', 'approval authorization has been revoked');
    }
    const consumptionKey = key(tenantId, requestId);
    if (this.#approvalConsumptions.has(consumptionKey)) {
      throw new FleetRejectedError('approval_replayed', 'approval decision was already consumed');
    }
    if (decision.decision === 'approved') {
      this.assertActiveLease(task, nodeId, now);
      assertDecisionWithinRequest(request, decision, now);
    } else if (task.status !== 'failed' || task.leaseOwnerNodeId !== null || task.leaseExpiresAt !== null) {
      throw new FleetRejectedError('invalid_transition', 'non-approved decision is not bound to a terminal task state');
    }
    this.#approvalConsumptions.add(consumptionKey);
    this.appendTenantAudit(tenantId, 'approval.consumed', requestId, nodeId, `system:${nodeId}`, now, {
      taskId, decisionId: decision.decisionId, decision: decision.decision,
    });
    return { request: clone(request.request), decision: clone(decision.decisionRecord) };
  }

  async revokeApprovalAuthorization(
    tenantId: string,
    requestId: string,
    actorRef: string,
    now: string,
  ): Promise<ApprovalRevocationRecord> {
    this.advanceClock(now);
    const bindingKey = key(tenantId, requestId);
    if (this.#approvalRevocations.has(bindingKey)) {
      throw new FleetRejectedError('approval_replayed', 'approval authorization was already revoked');
    }
    const request = this.#approvalRequests.get(bindingKey);
    const decision = this.#approvalDecisions.get(bindingKey);
    if (!request || !decision || decision.decision !== 'approved') {
      throw new FleetRejectedError('approval_not_found', 'approved authorization was not found');
    }
    const task = this.#tasks.get(key(tenantId, request.taskId));
    if (!task) throw new FleetRejectedError('approval_not_found', 'approval task was not found');
    if (task.status !== 'leased' && task.status !== 'blocked') {
      throw new FleetRejectedError('invalid_transition', 'terminal approval task cannot be revoked');
    }
    const record: ApprovalRevocationRecord = {
      tenantId,
      requestId,
      actorRef,
      revokedAt: now,
      reasonCode: 'operator_revoked',
    };
    this.#approvalRevocations.set(bindingKey, record);
    task.status = 'failed';
    task.leaseOwnerNodeId = null;
    task.leaseExpiresAt = null;
    this.appendTenantAudit(tenantId, 'approval.revoked', requestId, request.nodeId, actorRef, now, {
      taskId: request.taskId, decisionId: decision.decisionId, reasonCode: record.reasonCode,
    });
    return clone(record);
  }

  async getApprovalAuthorization(
    tenantId: string,
    nodeId: string,
    taskId: string,
    requestId: string,
    now: string,
  ): Promise<ApprovalAuthorization> {
    this.advanceClock(now);
    const bindingKey = key(tenantId, requestId);
    const request = this.#approvalRequests.get(bindingKey);
    const decision = this.#approvalDecisions.get(bindingKey);
    if (!request || request.taskId !== taskId || !decision || decision.decision !== 'approved') {
      throw new FleetRejectedError('approval_not_found', 'approved authorization is not bound to this claim');
    }
    if (request.nodeId !== nodeId) {
      throw new FleetRejectedError('lease_owner_mismatch', 'approval authorization is not bound to this node');
    }
    const expiresAt = decision.grantedScope?.expiresAt ?? request.expiresAt;
    const revocation = this.#approvalRevocations.get(bindingKey);
    return {
      state: revocation ? 'revoked' : Date.parse(expiresAt) <= Date.parse(now) ? 'expired' : 'approved',
      requestId,
      taskId,
      nodeId,
      expiresAt,
      ...(revocation ? { revokedAt: revocation.revokedAt } : {}),
    };
  }

  async getApprovalRequest(tenantId: string, requestId: string): Promise<ApprovalRequestRecord | null> {
    const record = this.#approvalRequests.get(key(tenantId, requestId));
    return record ? clone(record) : null;
  }

  async listApprovalRequests(tenantId: string): Promise<readonly ApprovalRequestRecord[]> {
    return [...this.#approvalRequests.values()]
      .filter((request) => request.tenantId === tenantId)
      .map((request) => clone(request))
      .sort((left, right) => left.requestId.localeCompare(right.requestId));
  }

  async getApprovalDecision(tenantId: string, requestId: string): Promise<ApprovalDecisionRecord | null> {
    const record = this.#approvalDecisions.get(key(tenantId, requestId));
    return record ? clone(record) : null;
  }

  async getApprovalRevocation(tenantId: string, requestId: string): Promise<ApprovalRevocationRecord | null> {
    const record = this.#approvalRevocations.get(key(tenantId, requestId));
    return record ? clone(record) : null;
  }

  async listEvents(tenantId: string, workOrderId: string): Promise<readonly RunEventClaims[]> {
    return clone((this.#events.get(key(tenantId, workOrderId)) ?? []).map((entry) => entry.claims));
  }

  async listAudit(tenantId: string): Promise<readonly RelayAuditEntry[]> {
    return clone(this.#audit.filter((entry) => entry.tenantId === tenantId));
  }

  async configureQuota(
    tenantId: string,
    nodeId: string,
    day: string,
    limits: TenantQuotaLimits,
    actorRef: string,
    now: string,
  ): Promise<readonly TenantQuotaCounter[]> {
    this.advanceClock(now);
    assertQuotaDay(day);
    const validated = validateQuotaLimits(limits);
    this.requireNode(tenantId, nodeId);
    const warnings: TenantQuotaCounter[] = [];
    for (const metric of TENANT_QUOTA_METRICS) {
      const limit = validated[metric];
      if (limit === undefined) continue;
      const counter = this.getOrCreateCounter(tenantId, nodeId, day, metric, now);
      counter.limit = limit;
      counter.updatedAt = now;
      if (counter.used < limit * 0.8) counter.warningEmitted = false;
      if (counter.used >= limit * 0.8 && !counter.warningEmitted) {
        counter.warningEmitted = true;
        warnings.push(counter);
      }
    }
    this.appendTenantAudit(tenantId, 'quota.configured', `${nodeId}:${day}`, nodeId, actorRef, now, { limits: validated });
    for (const counter of warnings) this.appendQuotaWarning(counter, actorRef, now);
    return this.listQuotaCounters(tenantId, nodeId, day);
  }

  async recordQuotaUsage(
    tenantId: string,
    nodeId: string,
    usage: TenantQuotaUsage,
    actorRef: string,
    now: string,
  ): Promise<readonly TenantQuotaCounter[]> {
    this.advanceClock(now);
    const validated = validateQuotaUsage(usage);
    this.requireNode(tenantId, nodeId);
    const day = utcDay(now);
    for (const metric of ['tokens', 'costCny'] as const) {
      const amount = validated[metric];
      if (amount === undefined) continue;
      const current = this.#quotaCounters.get(quotaKey(tenantId, nodeId, day, metric))?.used ?? 0;
      if (!Number.isFinite(current + amount) || current + amount > Number.MAX_SAFE_INTEGER) {
        throw new FleetRejectedError('invalid_contract', 'quota usage exceeds the supported range');
      }
    }
    const warnings: TenantQuotaCounter[] = [];
    for (const metric of ['tokens', 'costCny'] as const) {
      const amount = validated[metric];
      if (amount === undefined) continue;
      const warning = this.incrementQuota(tenantId, nodeId, day, metric, amount, now, false);
      if (warning) warnings.push(warning);
    }
    this.appendTenantAudit(tenantId, 'quota.usage', `${nodeId}:${day}`, nodeId, actorRef, now, { usage: validated });
    for (const counter of warnings) this.appendQuotaWarning(counter, actorRef, now);
    return this.listQuotaCounters(tenantId, nodeId, day);
  }

  async listQuotaCounters(tenantId: string, nodeId: string, day: string): Promise<readonly TenantQuotaCounter[]> {
    assertQuotaDay(day);
    return clone([...this.#quotaCounters.values()]
      .filter((counter) => counter.tenantId === tenantId && counter.nodeId === nodeId && counter.day === day)
      .sort((left, right) => TENANT_QUOTA_METRICS.indexOf(left.metric) - TENANT_QUOTA_METRICS.indexOf(right.metric)));
  }

  async getTenantChainHead(tenantId: string): Promise<TenantChainHead | null> {
    const event = this.#tenantAudit.get(tenantId)?.at(-1);
    return event ? clone(chainHeadFrom(event)) : null;
  }

  async listTenantAudit(tenantId: string, rangeFrom?: number, rangeTo?: number): Promise<readonly TenantAuditEvent[]> {
    const events = this.#tenantAudit.get(tenantId) ?? [];
    const from = rangeFrom ?? 1;
    const to = rangeTo ?? events.length;
    if (!Number.isInteger(from) || from < 1 || !Number.isInteger(to) || to < from) {
      throw new FleetRejectedError('invalid_contract', 'audit range is invalid');
    }
    return clone(events.filter((event) => event.position >= from && event.position <= to));
  }

  async createAuditExport(
    tenantId: string,
    rangeFrom: number | undefined,
    rangeTo: number | undefined,
    actorRef: string,
    now: string,
  ): Promise<TenantAuditExport> {
    this.advanceClock(now);
    const events = await this.listTenantAudit(tenantId, rangeFrom, rangeTo);
    if ((rangeFrom !== undefined && events[0]?.position !== rangeFrom)
      || (rangeTo !== undefined && events.at(-1)?.position !== rangeTo)) {
      throw new FleetRejectedError('audit_export_not_found', 'audit range was not found');
    }
    const auditExport = buildAuditExport(tenantId, events, now);
    const exportKey = key(tenantId, auditExport.exportId);
    const existing = this.#auditExports.get(exportKey);
    if (existing) return clone(existing);
    this.#auditExports.set(exportKey, clone(auditExport));
    this.appendTenantAudit(tenantId, 'audit.exported', auditExport.exportId, null, actorRef, now, {
      rangeFrom: auditExport.rangeFrom, rangeTo: auditExport.rangeTo, sha256: auditExport.sha256,
    });
    return clone(auditExport);
  }

  async getAuditExport(tenantId: string, exportId: string): Promise<TenantAuditExport | null> {
    const record = this.#auditExports.get(key(tenantId, exportId));
    return record ? clone(record) : null;
  }

  async createCapabilityVersion(
    tenantId: string,
    input: CapabilityVersionCreateInput,
    actorRef: string,
    now: string,
  ): Promise<CapabilityRegistryRecord> {
    this.advanceClock(now);
    if (input.author.tenantId !== tenantId || input.author.status !== 'draft') {
      throw new FleetRejectedError('tenant_mismatch', 'capability author tenant does not match the authenticated session');
    }
    const task = this.#tasks.get(key(tenantId, input.sourceTaskId));
    if (!task || task.status !== 'completed') throw new FleetRejectedError('capability_not_found', 'completed source task was not found');
    const events = this.#events.get(key(tenantId, task.workOrderId)) ?? [];
    const artifact = events.find((entry) => entry.claims.eventId === input.artifactEventId && entry.claims.type === 'artifact');
    const completed = events.find((entry) => entry.claims.eventId === input.completedEventId && entry.claims.type === 'completed');
    if (!artifact || !completed) {
      throw new FleetRejectedError('capability_not_found', 'completed task evidence was not found');
    }
    assertCapabilityDraftSource({ tenantId, input, task, events });
    const history = [...this.#capabilityPackages.values()].filter((record) =>
      record.tenantId === tenantId && record.packageId === input.author.packageId);
    const packageDigest = assertCapabilityHistory(history, input.author);
    const record: CapabilityRegistryRecord = {
      tenantId,
      packageId: input.author.packageId,
      packageVersion: input.author.packageVersion,
      packageDigest,
      author: clone(input.author),
      trialRecord: null,
      status: 'draft',
      sourceTaskId: input.sourceTaskId,
      artifactEventId: input.artifactEventId,
      completedEventId: input.completedEventId,
      createdAt: now,
    };
    const recordKey = capabilityVersionKey(tenantId, record.packageId, record.packageVersion);
    if (this.#capabilityPackages.has(recordKey)) throw new FleetRejectedError('capability_conflict', 'capability version already exists');
    this.#capabilityPackages.set(recordKey, clone(record));
    this.appendTenantAudit(tenantId, 'capability.version_created', `${record.packageId}:${record.packageVersion}`, null, actorRef, now, {
      packageDigest, sourceTaskId: input.sourceTaskId,
    });
    return clone(record);
  }

  async recordCapabilityTrial(
    tenantId: string,
    input: CapabilityTrialRecordInput,
    nodeId: string,
    now: string,
  ): Promise<CapabilityRegistryRecord> {
    this.advanceClock(now);
    const trial = input.trial;
    if (trial.tenantId !== tenantId || trial.environment.nodeId !== nodeId) {
      throw new FleetRejectedError('capability_trust_denied', 'trial identity does not match the trusted node session');
    }
    this.requireNode(tenantId, nodeId);
    const recordKey = capabilityVersionKey(tenantId, trial.packageId, trial.packageVersion);
    const record = this.#capabilityPackages.get(recordKey);
    if (!record || record.packageDigest !== trial.packageDigest) {
      throw new FleetRejectedError('capability_not_found', 'capability version was not found');
    }
    if (record.status === 'shared') throw new FleetRejectedError('capability_conflict', 'shared capability trial snapshot is immutable');
    const trialKey = key(tenantId, trial.trialId);
    if (this.#capabilityTrials.has(trialKey)) throw new FleetRejectedError('capability_conflict', 'SkillTrial trialId already exists');
    const trials = [...this.#capabilityTrials.values()].filter((item) => item.tenantId === tenantId
      && item.packageId === trial.packageId && item.packageVersion === trial.packageVersion);
    const aggregate = createTrialAggregate([...trials, trial], input.regression);
    this.#capabilityTrials.set(trialKey, clone(trial));
    record.trialRecord = aggregate;
    record.status = aggregate.shadowRuns >= 5 && aggregate.failure === 0 && aggregate.regressionPassed ? 'verified' : 'shadow';
    this.appendTenantAudit(tenantId, 'capability.trial_recorded', trial.trialId, nodeId, 'system:skill-trial', now, {
      packageId: trial.packageId, packageVersion: trial.packageVersion, packageDigest: trial.packageDigest, ok: trial.ok,
    });
    return clone(record);
  }

  async createCapabilityShare(
    sourceTenantId: string,
    input: CapabilityShareCreateInput,
    invitation: CapabilityShareInvitation | undefined,
    actorRef: string,
    now: string,
  ): Promise<TeamReadOnlyShare> {
    this.advanceClock(now);
    const record = this.#capabilityPackages.get(capabilityVersionKey(sourceTenantId, input.packageId, input.packageVersion));
    if (!record) throw new FleetRejectedError('capability_not_found', 'capability version was not found');
    if (record.status !== 'verified' && record.status !== 'shared') {
      throw new FleetRejectedError('capability_trust_denied', 'capability has not passed trusted trials');
    }
    const shareKey = key(input.targetTenantId, input.shareId);
    if (this.#capabilityShares.has(shareKey)) throw new FleetRejectedError('capability_conflict', 'capability share already exists');
    const share = buildCapabilityShare({ shareId: input.shareId, record, targetTenantId: input.targetTenantId, invitation, actorRef, now });
    this.#capabilityShares.set(shareKey, clone(share));
    record.status = 'shared';
    this.appendTenantAudit(sourceTenantId, 'capability.shared', input.shareId, null, actorRef, now, {
      targetTenantId: input.targetTenantId, packageId: input.packageId, packageVersion: input.packageVersion, packageDigest: record.packageDigest,
    });
    return clone(share);
  }

  async listCapabilities(tenantId: string): Promise<readonly CapabilityCatalogItem[]> {
    const owned = [...this.#capabilityPackages.values()].filter((record) => record.tenantId === tenantId)
      .map((record): CapabilityCatalogItem => ({ access: 'owner', record: clone(record), share: null }));
    const shared = [...this.#capabilityShares.values()].filter((share) => share.targetTenantId === tenantId)
      .map((share): CapabilityCatalogItem => {
        const record = this.#capabilityPackages.get(capabilityVersionKey(share.sourceTenantId, share.packageId, share.packageVersion));
        if (!record) throw new FleetRejectedError('capability_not_found', 'shared capability source was not found');
        return { access: 'read_only', record: capabilityRecordFromShare(clone(record), clone(share)), share: clone(share) };
      });
    return [...owned, ...shared].sort((left, right) => `${left.record.packageId}:${left.record.packageVersion}`.localeCompare(`${right.record.packageId}:${right.record.packageVersion}`));
  }

  async getCapability(tenantId: string, packageId: string, packageVersion?: number): Promise<CapabilityCatalogItem | null> {
    const candidates = (await this.listCapabilities(tenantId)).filter((item) => item.record.packageId === packageId
      && (packageVersion === undefined || item.record.packageVersion === packageVersion));
    return candidates.sort((left, right) => right.record.packageVersion - left.record.packageVersion)[0] ?? null;
  }

  async getCapabilityShare(targetTenantId: string, shareId: string): Promise<TeamReadOnlyShare | null> {
    const share = this.#capabilityShares.get(key(targetTenantId, shareId));
    return share ? clone(share) : null;
  }

  async recordCapabilityInstallDecision(
    targetTenantId: string,
    input: CapabilityInstallGateInput,
    actorRef: string,
    now: string,
  ): Promise<CapabilityInstallGateDecision> {
    this.advanceClock(now);
    const shareId = input.share.shareId;
    const share = this.#capabilityShares.get(key(targetTenantId, shareId));
    if (!share) throw new FleetRejectedError('capability_not_found', 'capability share was not found');
    const gateKey = key(targetTenantId, input.gateId);
    if (this.#capabilityInstallDecisions.has(gateKey)) throw new FleetRejectedError('capability_conflict', 'install gate id already exists');
    const decision = rebindCapabilityInstallDecision({ share, targetTenantId, input, now });
    this.#capabilityInstallDecisions.set(gateKey, clone(decision));
    this.appendTenantAudit(targetTenantId, 'capability.install_evaluated', input.gateId, null, actorRef, now, {
      shareId, packageDigest: share.packageDigest, decision: decision.decision, requestDigest: decision.requestDigest,
    });
    return clone(decision);
  }

  close(): void {}

  private advanceClock(now: string): void {
    const observedMs = Date.parse(now);
    if (!Number.isFinite(observedMs)) throw new FleetRejectedError('clock_regression', 'Relay clock produced an invalid timestamp');
    if (observedMs < this.#clockHighWaterMs) {
      throw new FleetRejectedError('clock_regression', 'Relay clock moved behind its last accepted timestamp');
    }
    this.#clockHighWaterMs = observedMs;
  }

  private refreshNode(node: FleetNodeRecord, now: string): void {
    if (Date.parse(now) - Date.parse(node.lastSeenAt) >= node.offlineAfterMs) node.status = 'offline';
  }

  private recoverExpiredLeases(tenantId: string, now: string): void {
    for (const task of this.#tasks.values()) {
      if (task.tenantId === tenantId && task.status === 'leased' && task.leaseExpiresAt && Date.parse(task.leaseExpiresAt) <= Date.parse(now)) {
        task.status = 'queued';
        task.leaseOwnerNodeId = null;
        task.leaseExpiresAt = null;
      }
    }
  }

  private assertActiveLease(task: FleetTaskRecord, nodeId: string, now: string): void {
    if (task.status !== 'leased' || !task.leaseExpiresAt) throw new FleetRejectedError('invalid_transition', 'task has no active lease');
    if (task.leaseOwnerNodeId !== nodeId) throw new FleetRejectedError('lease_owner_mismatch', 'event node does not own the task lease');
    if (Date.parse(task.leaseExpiresAt) <= Date.parse(now)) {
      task.status = 'queued';
      task.leaseOwnerNodeId = null;
      task.leaseExpiresAt = null;
      throw new FleetRejectedError('lease_expired', 'task lease has expired');
    }
  }

  private requireNode(tenantId: string, nodeId: string): FleetNodeRecord {
    const node = this.#nodes.get(key(tenantId, nodeId));
    if (!node) throw new FleetRejectedError('node_unknown', 'node was not found');
    return node;
  }

  private appendTenantAudit(
    tenantId: string,
    action: TenantAuditAction,
    subjectRef: string,
    nodeId: string | null,
    actorRef: string,
    at: string,
    metadata: FleetObject,
  ): TenantAuditEvent {
    const events = this.#tenantAudit.get(tenantId) ?? [];
    const event = buildTenantAuditEvent({
      tenantId,
      position: events.length + 1,
      action,
      subjectRef,
      nodeId,
      actorRef,
      at,
      metadata: clone(metadata),
      previousHash: events.at(-1)?.hash ?? null,
    });
    events.push(event);
    this.#tenantAudit.set(tenantId, events);
    return event;
  }

  private getOrCreateCounter(
    tenantId: string,
    nodeId: string,
    day: string,
    metric: TenantQuotaMetric,
    now: string,
  ): TenantQuotaCounter {
    const counterKey = quotaKey(tenantId, nodeId, day, metric);
    let counter = this.#quotaCounters.get(counterKey);
    if (!counter) {
      counter = { tenantId, nodeId, day, metric, used: 0, limit: null, warningEmitted: false, updatedAt: now };
      this.#quotaCounters.set(counterKey, counter);
    }
    return counter;
  }

  private incrementQuota(
    tenantId: string,
    nodeId: string,
    day: string,
    metric: TenantQuotaMetric,
    amount: number,
    now: string,
    appendWarning = true,
  ): TenantQuotaCounter | null {
    const counter = this.getOrCreateCounter(tenantId, nodeId, day, metric, now);
    const nextUsed = counter.used + amount;
    if (!Number.isFinite(nextUsed) || nextUsed > Number.MAX_SAFE_INTEGER) {
      throw new FleetRejectedError('invalid_contract', 'quota usage exceeds the supported range');
    }
    counter.used = nextUsed;
    counter.updatedAt = now;
    if (counter.limit !== null && counter.used >= counter.limit * 0.8 && !counter.warningEmitted) {
      counter.warningEmitted = true;
      if (appendWarning) this.appendQuotaWarning(counter, 'system:relay', now);
      return counter;
    }
    return null;
  }

  private appendQuotaWarning(counter: TenantQuotaCounter, actorRef: string, now: string): void {
    this.appendTenantAudit(counter.tenantId, 'quota.warning', `${counter.nodeId}:${counter.day}:${counter.metric}`, counter.nodeId, actorRef, now, {
      metric: counter.metric, used: counter.used, limit: counter.limit,
    });
  }

  private assertQuotaAvailable(tenantId: string, nodeId: string, now: string): void {
    const day = utcDay(now);
    const taskUsed = this.#quotaCounters.get(quotaKey(tenantId, nodeId, day, 'tasks'))?.used ?? 0;
    if (!Number.isSafeInteger(taskUsed + 1)) {
      throw new FleetRejectedError('invalid_contract', 'quota usage exceeds the supported range');
    }
    const exceeded = [...this.#quotaCounters.values()]
      .filter((counter) => counter.tenantId === tenantId && counter.nodeId === nodeId && counter.day === day
        && counter.limit !== null && counter.used >= counter.limit)
      .map((counter) => counter.metric)
      .sort();
    if (exceeded.length === 0) return;
    this.appendTenantAudit(tenantId, 'quota.exceeded', `${nodeId}:${day}`, nodeId, 'system:relay', now, { metrics: exceeded });
    throw new FleetRejectedError('quota_exceeded', 'tenant node daily quota is exhausted');
  }
}
