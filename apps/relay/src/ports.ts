export type FleetObject = Readonly<Record<string, unknown>>;

export type FleetRejectionCode =
  | 'invalid_contract'
  | 'tenant_mismatch'
  | 'node_offline'
  | 'node_unknown'
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
  | 'approval_replayed';

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

export interface FleetStore {
  registerNode(tenantId: string, manifest: FleetObject, claims: NodeClaims, now: string, offlineAfterMs: number): Promise<FleetNodeRecord>;
  heartbeat(tenantId: string, claims: HeartbeatClaims, now: string): Promise<FleetNodeRecord>;
  getNode(tenantId: string, nodeId: string, now: string): Promise<FleetNodeRecord | null>;
  enqueueTask(tenantId: string, envelope: FleetObject, claims: TaskClaims, retryOfTaskId: string | null, now: string): Promise<EnqueueResult>;
  claimTask(tenantId: string, nodeId: string, now: string): Promise<FleetTaskRecord | null>;
  putEvent(tenantId: string, event: FleetObject, claims: RunEventClaims, now: string): Promise<EventResult>;
  stopTask(tenantId: string, taskId: string, actorRef: string, now: string): Promise<FleetTaskRecord>;
  getTask(tenantId: string, taskId: string, now: string): Promise<FleetTaskRecord | null>;
  putApprovalRequest(tenantId: string, taskId: string, request: FleetObject, claims: ApprovalRequestClaims, now: string): Promise<ApprovalRequestRecord>;
  putApprovalDecision(tenantId: string, decision: FleetObject, claims: ApprovalDecisionClaims, now: string): Promise<ApprovalDecisionRecord>;
  consumeApprovalDecision(tenantId: string, nodeId: string, taskId: string, requestId: string, now: string): Promise<ApprovalBundle>;
  getApprovalRequest(tenantId: string, requestId: string): Promise<ApprovalRequestRecord | null>;
  getApprovalDecision(tenantId: string, requestId: string): Promise<ApprovalDecisionRecord | null>;
  listEvents(tenantId: string, workOrderId: string): Promise<readonly RunEventClaims[]>;
  listAudit(tenantId: string): Promise<readonly RelayAuditEntry[]>;
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
  stop(session: AuthenticatedFleetSession, taskId: string): Promise<FleetTaskRecord>;
  retry(session: AuthenticatedFleetSession, previousTaskId: string, nextEnvelope: unknown): Promise<EnqueueResult>;
}

/** Thin delivery adapters (Fastify/WSS/SSE) must implement this port only. */
export interface FleetTransport {
  start(ingress: FleetIngress): Promise<void>;
  publishTask(nodeId: string, task: FleetTaskRecord): Promise<void>;
  publishControl(tenantId: string, nodeId: string, command: 'stop', taskId: string): Promise<void>;
  close(): Promise<void>;
}
