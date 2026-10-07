import type {
  CapabilityInstallGateDecision,
  CapabilityInstallGateInput,
  CapabilityPackageAuthorInput,
  CapabilityShareInvitation,
  SkillTrialSystemRecordInput,
  TeamReadOnlyShare,
  TrialRecord,
} from '@hummer/contracts';

export type FleetObject = Readonly<Record<string, unknown>>;

export type FleetRejectionCode =
  | 'invalid_contract'
  | 'tenant_mismatch'
  | 'node_offline'
  | 'node_unknown'
  | 'heartbeat_load_mismatch'
  | 'clock_regression'
  | 'task_expired'
  | 'lease_expired'
  | 'lease_owner_mismatch'
  | 'invalid_transition'
  | 'duplicate_delivery'
  | 'retry_key_reused'
  | 'sequence_gap'
  | 'actor_mismatch'
  | 'approval_not_found'
  | 'approval_expired'
  | 'approval_scope_exceeded'
  | 'approval_replayed'
  | 'quota_exceeded'
  | 'audit_export_not_found'
  | 'capability_not_found'
  | 'capability_conflict'
  | 'capability_trust_denied';

export class FleetRejectedError extends Error {
  constructor(
    readonly code: FleetRejectionCode,
    message: string,
  ) {
    super(message);
    this.name = 'FleetRejectedError';
  }
}

export interface ValidationFailure {
  ok: false;
  reason: string;
}

export interface ValidationSuccess<TMeta> {
  ok: true;
  value: FleetObject;
  meta: TMeta;
}

export type ValidationResult<TMeta> = ValidationFailure | ValidationSuccess<TMeta>;

/**
 * Relay deliberately does not know shared schema fields. The adapter backed by
 * @hummer/contracts validates and projects only routing claims into this port.
 */
export interface InboundFleetValidator<TMeta> {
  validate(input: unknown): ValidationResult<TMeta>;
}

export interface NodeClaims {
  nodeId: string;
  tenantIds: readonly string[];
  agentVersion: string;
}

export interface HeartbeatClaims {
  nodeId: string;
  running: number;
}

export interface TaskClaims {
  taskId: string;
  workOrderId: string;
  tenantId: string;
  targetNodeId: string;
  targetRuntime: string;
  idempotencyKey: string;
  leaseMs: number;
  expiresAt: string;
  originRef: string;
}

export type RunEventType =
  | 'started'
  | 'progress'
  | 'needs_approval'
  | 'artifact'
  | 'failed'
  | 'completed'
  | 'cancelled';

export interface RunEventClaims {
  eventId: string;
  tenantId: string;
  workOrderId: string;
  nodeId: string;
  seq: number;
  occurredAt: string;
  type: RunEventType;
  idempotencyKey: string;
}

export interface ApprovalScopeClaims {
  capabilities: readonly string[];
  paths?: readonly string[];
  maxUses?: number;
}

export interface GrantedApprovalScopeClaims extends ApprovalScopeClaims {
  expiresAt: string;
}

export interface ApprovalRequestClaims {
  requestId: string;
  tenantId: string;
  workOrderId: string;
  nodeId: string;
  runId: string;
  riskClass: string;
  action: string;
  target: string;
  requestedScope: ApprovalScopeClaims;
  expiresAt: string;
  requestedBy: string;
}

export interface ApprovalDecisionClaims {
  decisionId: string;
  requestId: string;
  tenantId: string;
  deciderActorRef: string;
  decidedAt: string;
  decision: 'approved' | 'denied' | 'expired' | 'revoked';
  grantedScope?: GrantedApprovalScopeClaims;
}

export interface FleetValidators {
  nodeManifest: InboundFleetValidator<NodeClaims>;
  heartbeat: InboundFleetValidator<HeartbeatClaims>;
  taskEnvelope: InboundFleetValidator<TaskClaims>;
  runEvent: InboundFleetValidator<RunEventClaims>;
  approvalRequest: InboundFleetValidator<ApprovalRequestClaims>;
  approvalDecision: InboundFleetValidator<ApprovalDecisionClaims>;
}

export interface AuthenticatedFleetSession {
  tenantId: string;
  actorRef: string;
  /** Present for node badge tokens. Transport adapters must never trust a caller-supplied node id. */
  nodeId?: string;
  /** Omitted means exactly `tenantId`; multiple tenants require an explicit identity-provider grant. */
  authorizedTenantIds?: readonly string[];
  /** Required opaque reference when `authorizedTenantIds` contains multiple tenants. */
  tenantGrantRef?: string;
  /** Token expiry is transport-authenticated and bounds cross-tenant share invitations. */
  authExpiresAt?: string;
}

export type NodeStatus = 'online' | 'offline';
export interface FleetNodeRecord extends NodeClaims {
  tenantId: string;
  manifest: FleetObject;
  status: NodeStatus;
  lastSeenAt: string;
  offlineAfterMs: number;
}

export type FleetTaskStatus = 'queued' | 'leased' | 'blocked' | 'completed' | 'failed';
export interface FleetTaskRecord extends TaskClaims {
  envelope: FleetObject;
  status: FleetTaskStatus;
  attempt: number;
  leaseOwnerNodeId: string | null;
  leaseExpiresAt: string | null;
  retryOfTaskId: string | null;
}

export interface EnqueueResult {
  task: FleetTaskRecord;
  inserted: boolean;
}

export interface EventResult {
  inserted: boolean;
  task: FleetTaskRecord;
}

export interface ApprovalRequestRecord extends ApprovalRequestClaims {
  taskId: string;
  request: FleetObject;
  createdAt: string;
}

export interface ApprovalDecisionRecord extends ApprovalDecisionClaims {
  decisionRecord: FleetObject;
  createdAt: string;
}

/** Append-only withdrawal of a previously-approved authorization grant. */
export interface ApprovalRevocationRecord {
  tenantId: string;
  requestId: string;
  actorRef: string;
  revokedAt: string;
  reasonCode: 'operator_revoked';
}

export interface ApprovalAuthorization {
  state: 'approved' | 'revoked' | 'expired';
  requestId: string;
  taskId: string;
  nodeId: string;
  expiresAt: string;
  revokedAt?: string;
}

export interface ApprovalRequestProjection extends ApprovalRequestRecord {
  decision?: ApprovalDecisionRecord;
  revocation?: ApprovalRevocationRecord;
  authorization?: ApprovalAuthorization;
}

export interface ApprovalBundle {
  request: FleetObject;
  decision: FleetObject;
}

export interface RelayAuditEntry {
  tenantId: string;
  action: 'stop' | 'retry';
  taskId: string;
  actorRef: string;
  at: string;
  detail: string;
}

export type TenantAuditAction =
  | 'node.registered'
  | 'task.enqueued'
  | 'task.claimed'
  | 'run.event'
  | 'task.stopped'
  | 'task.retried'
  | 'approval.requested'
  | 'approval.decided'
  | 'approval.consumed'
  | 'approval.revoked'
  | 'quota.configured'
  | 'quota.usage'
  | 'quota.warning'
  | 'quota.exceeded'
  | 'audit.exported'
  | 'capability.version_created'
  | 'capability.trial_recorded'
  | 'capability.shared'
  | 'capability.install_evaluated';

export interface CapabilityVersionSource {
  sourceTaskId: string;
  artifactEventId: string;
  completedEventId: string;
}

export interface CapabilityVersionCreateInput extends CapabilityVersionSource {
  author: CapabilityPackageAuthorInput;
  /** Transient verification input; never persisted by the capability registry. */
  outcomeReceipt: unknown;
  /** Canonical base64 artifact bytes; transient and never persisted. */
  artifactContentBase64: string;
}

export interface CapabilityRegistryRecord extends CapabilityVersionSource {
  tenantId: string;
  packageId: string;
  packageVersion: number;
  packageDigest: string;
  author: CapabilityPackageAuthorInput;
  trialRecord: TrialRecord | null;
  status: 'draft' | 'shadow' | 'verified' | 'shared';
  createdAt: string;
}

export interface CapabilityTrialRecordInput {
  trial: SkillTrialSystemRecordInput;
  regression: { passed: boolean; evidenceDigest: string };
}

export interface CapabilityShareCreateInput {
  shareId: string;
  packageId: string;
  packageVersion: number;
  targetTenantId: string;
}

export interface CapabilityCatalogItem {
  access: 'owner' | 'read_only';
  record: CapabilityRegistryRecord;
  share: TeamReadOnlyShare | null;
}

export interface TenantAuditEvent {
  tenantId: string;
  position: number;
  action: TenantAuditAction;
  subjectRef: string;
  nodeId: string | null;
  actorRef: string;
  at: string;
  metadata: FleetObject;
  previousHash: string | null;
  hash: string;
}

export interface TenantChainHead {
  tenantId: string;
  position: number;
  hash: string;
  updatedAt: string;
}

export type TenantQuotaMetric = 'tasks' | 'tokens' | 'costCny';
export type TenantQuotaLimits = Partial<Record<TenantQuotaMetric, number>>;
export interface TenantQuotaUsage { tokens?: number; costCny?: number }

export interface TenantQuotaCounter {
  tenantId: string;
  nodeId: string;
  day: string;
  metric: TenantQuotaMetric;
  used: number;
  limit: number | null;
  warningEmitted: boolean;
  updatedAt: string;
}

export interface TenantAuditExportManifest extends FleetObject {
  schema: 'hummer.relay-audit-export';
  version: 1;
  tenantId: string;
  rangeFrom: number;
  rangeTo: number;
  eventCount: number;
  firstPreviousHash: string | null;
  chainHeadHash: string;
  entriesSha256: string;
  createdAt: string;
}

export interface TenantAuditExport {
  exportId: string;
  tenantId: string;
  rangeFrom: number;
  rangeTo: number;
  sha256: string;
  createdAt: string;
  manifest: TenantAuditExportManifest;
}

export interface FleetStore {
  registerNode(tenantId: string, manifest: FleetObject, claims: NodeClaims, authorizedTenantIds: readonly string[], tenantGrantRef: string | undefined, now: string, offlineAfterMs: number): Promise<FleetNodeRecord>;
  heartbeat(tenantId: string, claims: HeartbeatClaims, now: string): Promise<FleetNodeRecord>;
  getNode(tenantId: string, nodeId: string, now: string): Promise<FleetNodeRecord | null>;
  listNodes(tenantId: string, now: string): Promise<readonly FleetNodeRecord[]>;
  enqueueTask(tenantId: string, envelope: FleetObject, claims: TaskClaims, retryOfTaskId: string | null, now: string): Promise<EnqueueResult>;
  claimTask(tenantId: string, nodeId: string, now: string): Promise<FleetTaskRecord | null>;
  putEvent(tenantId: string, event: FleetObject, claims: RunEventClaims, now: string): Promise<EventResult>;
  stopTask(tenantId: string, taskId: string, actorRef: string, now: string): Promise<FleetTaskRecord>;
  getTask(tenantId: string, taskId: string, now: string): Promise<FleetTaskRecord | null>;
  listTasks(tenantId: string, now: string): Promise<readonly FleetTaskRecord[]>;
  putApprovalRequest(tenantId: string, taskId: string, request: FleetObject, claims: ApprovalRequestClaims, now: string): Promise<ApprovalRequestRecord>;
  putApprovalDecision(tenantId: string, decision: FleetObject, claims: ApprovalDecisionClaims, now: string): Promise<ApprovalDecisionRecord>;
  consumeApprovalDecision(tenantId: string, nodeId: string, taskId: string, requestId: string, now: string): Promise<ApprovalBundle>;
  revokeApprovalAuthorization(tenantId: string, requestId: string, actorRef: string, now: string): Promise<ApprovalRevocationRecord>;
  getApprovalAuthorization(tenantId: string, nodeId: string, taskId: string, requestId: string, now: string): Promise<ApprovalAuthorization>;
  getApprovalRequest(tenantId: string, requestId: string): Promise<ApprovalRequestRecord | null>;
  listApprovalRequests(tenantId: string): Promise<readonly ApprovalRequestRecord[]>;
  getApprovalDecision(tenantId: string, requestId: string): Promise<ApprovalDecisionRecord | null>;
  getApprovalRevocation(tenantId: string, requestId: string): Promise<ApprovalRevocationRecord | null>;
  listEvents(tenantId: string, workOrderId: string): Promise<readonly RunEventClaims[]>;
  listAudit(tenantId: string): Promise<readonly RelayAuditEntry[]>;
  configureQuota(tenantId: string, nodeId: string, day: string, limits: TenantQuotaLimits, actorRef: string, now: string): Promise<readonly TenantQuotaCounter[]>;
  recordQuotaUsage(tenantId: string, nodeId: string, usage: TenantQuotaUsage, actorRef: string, now: string): Promise<readonly TenantQuotaCounter[]>;
  listQuotaCounters(tenantId: string, nodeId: string, day: string): Promise<readonly TenantQuotaCounter[]>;
  getTenantChainHead(tenantId: string): Promise<TenantChainHead | null>;
  listTenantAudit(tenantId: string, rangeFrom?: number, rangeTo?: number): Promise<readonly TenantAuditEvent[]>;
  createAuditExport(tenantId: string, rangeFrom: number | undefined, rangeTo: number | undefined, actorRef: string, now: string): Promise<TenantAuditExport>;
  getAuditExport(tenantId: string, exportId: string): Promise<TenantAuditExport | null>;
  createCapabilityVersion(tenantId: string, input: CapabilityVersionCreateInput, actorRef: string, now: string): Promise<CapabilityRegistryRecord>;
  recordCapabilityTrial(tenantId: string, input: CapabilityTrialRecordInput, nodeId: string, now: string): Promise<CapabilityRegistryRecord>;
  createCapabilityShare(sourceTenantId: string, input: CapabilityShareCreateInput, invitation: CapabilityShareInvitation | undefined, actorRef: string, now: string): Promise<TeamReadOnlyShare>;
  listCapabilities(tenantId: string): Promise<readonly CapabilityCatalogItem[]>;
  getCapability(tenantId: string, packageId: string, packageVersion?: number): Promise<CapabilityCatalogItem | null>;
  getCapabilityShare(targetTenantId: string, shareId: string): Promise<TeamReadOnlyShare | null>;
  recordCapabilityInstallDecision(targetTenantId: string, input: CapabilityInstallGateInput, actorRef: string, now: string): Promise<CapabilityInstallGateDecision>;
  close(): void;
}

export interface FleetIngress {
  register(session: AuthenticatedFleetSession, input: unknown): Promise<FleetNodeRecord>;
  heartbeat(session: AuthenticatedFleetSession, input: unknown): Promise<FleetNodeRecord>;
  enqueue(session: AuthenticatedFleetSession, input: unknown): Promise<EnqueueResult>;
  claim(session: AuthenticatedFleetSession, nodeId: string): Promise<FleetTaskRecord | null>;
  event(session: AuthenticatedFleetSession, input: unknown): Promise<EventResult>;
  ack(session: AuthenticatedFleetSession, input: unknown): Promise<EventResult>;
  complete(session: AuthenticatedFleetSession, input: unknown): Promise<EventResult>;
  fail(session: AuthenticatedFleetSession, input: unknown): Promise<EventResult>;
  requestApproval(session: AuthenticatedFleetSession, taskId: string, input: unknown): Promise<ApprovalRequestRecord>;
  decideApproval(session: AuthenticatedFleetSession, requestId: string, input: unknown): Promise<ApprovalDecisionRecord>;
  consumeApproval(session: AuthenticatedFleetSession, nodeId: string, taskId: string, requestId: string): Promise<ApprovalBundle>;
  revokeApproval(session: AuthenticatedFleetSession, requestId: string): Promise<ApprovalRevocationRecord>;
  getApprovalAuthorization(session: AuthenticatedFleetSession, nodeId: string, taskId: string, requestId: string): Promise<ApprovalAuthorization>;
  stop(session: AuthenticatedFleetSession, taskId: string): Promise<FleetTaskRecord>;
  retry(session: AuthenticatedFleetSession, previousTaskId: string, nextEnvelope: unknown): Promise<EnqueueResult>;
  getNode(session: AuthenticatedFleetSession, nodeId: string): Promise<FleetNodeRecord | null>;
  listNodes(session: AuthenticatedFleetSession): Promise<readonly FleetNodeRecord[]>;
  getTask(session: AuthenticatedFleetSession, taskId: string): Promise<FleetTaskRecord | null>;
  listTasks(session: AuthenticatedFleetSession): Promise<readonly FleetTaskRecord[]>;
  getApprovalRequest(session: AuthenticatedFleetSession, requestId: string): Promise<ApprovalRequestProjection | null>;
  listApprovalRequests(session: AuthenticatedFleetSession): Promise<readonly ApprovalRequestProjection[]>;
  configureQuota(session: AuthenticatedFleetSession, nodeId: string, day: string, input: unknown): Promise<readonly TenantQuotaCounter[]>;
  recordQuotaUsage(session: AuthenticatedFleetSession, nodeId: string, input: unknown): Promise<readonly TenantQuotaCounter[]>;
  listQuotaCounters(session: AuthenticatedFleetSession, nodeId: string, day: string): Promise<readonly TenantQuotaCounter[]>;
  getTenantChainHead(session: AuthenticatedFleetSession): Promise<TenantChainHead | null>;
  listTenantAudit(session: AuthenticatedFleetSession, rangeFrom?: number, rangeTo?: number): Promise<readonly TenantAuditEvent[]>;
  createAuditExport(session: AuthenticatedFleetSession, input: unknown): Promise<TenantAuditExport>;
  getAuditExport(session: AuthenticatedFleetSession, exportId: string): Promise<TenantAuditExport | null>;
  createCapabilityVersion(session: AuthenticatedFleetSession, input: unknown): Promise<CapabilityRegistryRecord>;
  recordCapabilityTrial(session: AuthenticatedFleetSession, input: unknown): Promise<CapabilityRegistryRecord>;
  createCapabilityShare(session: AuthenticatedFleetSession, input: unknown): Promise<TeamReadOnlyShare>;
  listCapabilities(session: AuthenticatedFleetSession): Promise<readonly CapabilityCatalogItem[]>;
  getCapability(session: AuthenticatedFleetSession, packageId: string, packageVersion?: number): Promise<CapabilityCatalogItem | null>;
  evaluateCapabilityInstall(session: AuthenticatedFleetSession, input: unknown): Promise<CapabilityInstallGateDecision>;
}

/** Thin delivery adapters (Fastify/WSS/SSE) must implement this port only. */
export interface FleetTransport {
  start(ingress: FleetIngress): Promise<void>;
  publishTask(nodeId: string, task: FleetTaskRecord): Promise<void>;
  publishControl(tenantId: string, nodeId: string, command: 'stop', taskId: string): Promise<void>;
  close(): Promise<void>;
}
