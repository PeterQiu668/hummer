import { randomUUID } from 'node:crypto';
import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { FleetDispatchOutboxRecord, FleetDispatchOutboxStore } from './persistence/fleet-dispatch-outbox-store.js';

export const DESKTOP_RELAY_CHANNELS = {
  status: 'hummer:relay:status',
  listNodes: 'hummer:relay:list-nodes',
  enqueueTask: 'hummer:relay:enqueue-task',
  listTasks: 'hummer:relay:list-tasks',
  listApprovalRequests: 'hummer:relay:list-approval-requests',
  decideApproval: 'hummer:relay:decide-approval',
  revokeApproval: 'hummer:relay:revoke-approval',
  stopTask: 'hummer:relay:stop-task',
} as const;

export interface DesktopRelayTrustedConfig {
  baseUrl: string;
  badgeToken: string;
  tenantId: string;
  actorRef: string;
}

export interface DesktopRelayIdentity {
  tenantId: string;
  actorRef: string;
}

export interface DesktopRelayHostOptions {
  config: DesktopRelayTrustedConfig | null;
  resolveIdentity(token: string): DesktopRelayIdentity;
  outbox: Pick<FleetDispatchOutboxStore, 'stage' | 'recordAttempt' | 'recordFailure' | 'recordRejected' | 'recordDelivered' | 'listPending'>;
  fetch?: typeof fetch;
  now?: () => Date;
  decisionIdFactory?: () => string;
  outboxRetryIntervalMs?: number;
}

export interface DesktopRelayHostRegistration {
  configure(config: DesktopRelayTrustedConfig): void;
  replayPending(): Promise<{ delivered: number; failed: number }>;
  close(): void;
}

export interface DesktopRelayDecisionRequest {
  token: string;
  requestId: string;
  decision: 'approved' | 'denied';
  rationale?: string;
}

interface RelaySessionProjection {
  tenantId: string;
  actorRef: string;
}

interface RelayNodeProjection extends TenantRecord {
  nodeId: string;
  status: 'online' | 'offline';
  lastSeenAt: string;
  manifest: Record<string, unknown>;
}

interface RelayTaskProjection extends TenantRecord {
  taskId: string;
  status: string;
  envelope: Record<string, unknown>;
  [key: string]: unknown;
}

interface RelayApprovalProjection extends TenantRecord {
  requestId: string;
  taskId: string;
  request: Record<string, unknown>;
  [key: string]: unknown;
}

interface TenantRecord {
  tenantId: string;
  [key: string]: unknown;
}

export function readDesktopRelayTrustedConfig(
  env: NodeJS.ProcessEnv,
): DesktopRelayTrustedConfig | null {
  const config = {
    baseUrl: env.HUMMER_RELAY_BASE_URL?.trim() ?? '',
    badgeToken: env.HUMMER_RELAY_BADGE_TOKEN?.trim() ?? '',
    tenantId: env.HUMMER_RELAY_TENANT_ID?.trim() ?? '',
    actorRef: env.HUMMER_RELAY_ACTOR_REF?.trim() ?? '',
  };
  if (Object.values(config).every((value) => value === '')) return null;
  if (Object.values(config).some((value) => value === '')) {
    throw new Error('Desktop Relay configuration is incomplete');
  }
  validateTenantId(config.tenantId);
  validateActorRef(config.actorRef);
  return config;
}

export function consumeDesktopRelayTrustedConfig(env: NodeJS.ProcessEnv): DesktopRelayTrustedConfig | null {
  const config = readDesktopRelayTrustedConfig(env);
  if (config) delete env.HUMMER_RELAY_BADGE_TOKEN;
  return config;
}

export function registerDesktopRelayHost(options: DesktopRelayHostOptions): DesktopRelayHostRegistration {
  let config = options.config;
  let client = config
    ? new DesktopRelayHttpClient(config, options.fetch, options.now, options.decisionIdFactory)
    : null;
  const authenticate = (token: unknown): DesktopRelayIdentity => {
    if (typeof token !== 'string' || token.length < 8) {
      throw new DesktopRelayError(401, 'invalid_session', 'An authenticated desktop session is required');
    }
    const identity = options.resolveIdentity(token);
    if (!client || !config) {
      throw new DesktopRelayError(503, 'relay_not_configured', 'Desktop Relay is not configured');
    }
    if (identity.tenantId !== config.tenantId || identity.actorRef !== config.actorRef) {
      throw new DesktopRelayError(403, 'identity_mismatch', 'Desktop session is not authorized for the configured Relay identity');
    }
    return identity;
  };
  const deliveries = new Map<string, Promise<unknown>>();
  let replayInFlight: Promise<{ delivered: number; failed: number }> | null = null;
  let retryTimer: ReturnType<typeof setInterval> | null = null;
  const deliver = (record: FleetDispatchOutboxRecord): Promise<unknown> => {
    if (record.status === 'delivered' && record.response) return Promise.resolve(record.response);
    const existing = deliveries.get(record.outboxId);
    if (existing) return existing;
    const pending = (async () => {
      if (!client) throw new DesktopRelayError(503, 'relay_not_configured', 'Desktop Relay is not configured');
      const clock = options.now ?? (() => new Date());
      const taskExpiry = typeof record.envelope.expiresAt === 'string' ? Date.parse(record.envelope.expiresAt) : NaN;
      if (!Number.isFinite(taskExpiry) || taskExpiry <= clock().getTime()) {
        options.outbox.recordRejected(record.outboxId, 'task_expired', clock().toISOString());
        throw new DesktopRelayError(409, 'task_expired', 'Pending TaskEnvelope expired before delivery');
      }
      options.outbox.recordAttempt(record.outboxId, clock().toISOString());
      let response: unknown;
      try {
        response = await client.enqueueTask(record.envelope);
      } catch (error) {
        const code = relayFailureCode(error);
        if (isPermanentRelayFailure(error)) options.outbox.recordRejected(record.outboxId, code, clock().toISOString());
        else options.outbox.recordFailure(record.outboxId, code, clock().toISOString());
        throw error;
      }
      try {
        options.outbox.recordDelivered(record.outboxId, response, clock().toISOString());
      } catch (error) {
        options.outbox.recordFailure(record.outboxId, 'relay_response_mismatch', clock().toISOString());
        throw error;
      }
      return response;
    })().finally(() => { deliveries.delete(record.outboxId); });
    deliveries.set(record.outboxId, pending);
    return pending;
  };

  ipcMain.handle(DESKTOP_RELAY_CHANNELS.status, (event: IpcMainInvokeEvent) => {
    requireTrustedMainFrame(event);
    return { configured: Boolean(client) };
  });
  ipcMain.handle(DESKTOP_RELAY_CHANNELS.listNodes, async (event: IpcMainInvokeEvent, token: unknown) => {
    requireTrustedMainFrame(event);
    return clientFor(authenticate(token), client).listNodes();
  });
  ipcMain.handle(DESKTOP_RELAY_CHANNELS.enqueueTask, async (
    event: IpcMainInvokeEvent,
    token: unknown,
    envelope: unknown,
  ) => {
    requireTrustedMainFrame(event);
    const identity = authenticate(token);
    if (containsSecret(envelope, String(token))) {
      throw new DesktopRelayError(400, 'credential_in_payload', 'TaskEnvelope must not contain the desktop session credential');
    }
    clientFor(identity, client);
    const record = options.outbox.stage({
      tenantId: identity.tenantId,
      actorRef: identity.actorRef,
      envelope,
      occurredAt: (options.now ?? (() => new Date()))().toISOString(),
    });
    return deliver(record);
  });
  ipcMain.handle(DESKTOP_RELAY_CHANNELS.listTasks, async (event: IpcMainInvokeEvent, token: unknown) => {
    requireTrustedMainFrame(event);
    return clientFor(authenticate(token), client).listTasks();
  });
  ipcMain.handle(DESKTOP_RELAY_CHANNELS.listApprovalRequests, async (
    event: IpcMainInvokeEvent,
    token: unknown,
  ) => {
    requireTrustedMainFrame(event);
    return clientFor(authenticate(token), client).listApprovalRequests();
  });
  ipcMain.handle(DESKTOP_RELAY_CHANNELS.decideApproval, async (
    event: IpcMainInvokeEvent,
    input: unknown,
  ) => {
    requireTrustedMainFrame(event);
    const decision = parseDecisionRequest(input);
    return clientFor(authenticate(decision.token), client).decideApproval(decision);
  });
  ipcMain.handle(DESKTOP_RELAY_CHANNELS.revokeApproval, async (
    event: IpcMainInvokeEvent,
    token: unknown,
    requestId: unknown,
  ) => {
    requireTrustedMainFrame(event);
    return clientFor(authenticate(token), client).revokeApproval(requireIdentifier(requestId, 'approval request id'));
  });
  ipcMain.handle(DESKTOP_RELAY_CHANNELS.stopTask, async (
    event: IpcMainInvokeEvent,
    token: unknown,
    taskId: unknown,
  ) => {
    requireTrustedMainFrame(event);
    return clientFor(authenticate(token), client).stopTask(requireIdentifier(taskId, 'task id'));
  });

  const registration: DesktopRelayHostRegistration = {
    configure(nextConfig) {
      const nextClient = new DesktopRelayHttpClient(nextConfig, options.fetch, options.now, options.decisionIdFactory);
      if (config || client) {
        throw new DesktopRelayError(409, 'relay_already_configured', 'Desktop Relay configuration is immutable after bootstrap');
      }
      config = { ...nextConfig };
      client = nextClient;
      startRetryTimer();
    },
    replayPending() {
      if (replayInFlight) return replayInFlight;
      replayInFlight = (async () => {
        if (!client || !config) return { delivered: 0, failed: 0 };
        const activeConfig = config;
        let delivered = 0;
        let failed = 0;
        for (const record of options.outbox.listPending(activeConfig.tenantId, activeConfig.actorRef)) {
          try {
            await deliver(record);
            delivered += 1;
          } catch {
            failed += 1;
          }
        }
        return { delivered, failed };
      })().finally(() => { replayInFlight = null; });
      return replayInFlight;
    },
    close() {
      if (retryTimer) clearInterval(retryTimer);
      Object.values(DESKTOP_RELAY_CHANNELS).forEach((channel) => ipcMain.removeHandler(channel));
    },
  };
  const retryIntervalMs = options.outboxRetryIntervalMs ?? 15_000;
  const startRetryTimer = () => {
    if (!client || retryIntervalMs <= 0 || retryTimer) return;
    retryTimer = setInterval(() => {
      void registration.replayPending().catch(() => {
        process.stderr.write('{"event":"fleet.outbox.replay_failed"}\n');
      });
    }, retryIntervalMs);
    retryTimer.unref();
  };
  startRetryTimer();
  return registration;
}

function relayFailureCode(error: unknown): string {
  if (error instanceof DesktopRelayError && /^[a-z][a-z0-9_]{0,63}$/u.test(error.code)) return error.code;
  return 'relay_error';
}

function isPermanentRelayFailure(error: unknown): boolean {
  return error instanceof DesktopRelayError && [400, 404, 409, 422].includes(error.status);
}

function clientFor(identity: DesktopRelayIdentity, client: DesktopRelayHttpClient | null): DesktopRelayHttpClient {
  if (!client) throw new DesktopRelayError(503, 'relay_not_configured', 'Desktop Relay is not configured');
  client.assertLocalIdentity(identity);
  return client;
}

class DesktopRelayHttpClient {
  readonly #baseUrl: string;
  readonly #badgeToken: string;
  readonly #tenantId: string;
  readonly #actorRef: string;
  readonly #fetch: typeof fetch;
  readonly #now: () => Date;
  readonly #decisionIdFactory: () => string;

  constructor(
    config: DesktopRelayTrustedConfig,
    fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
    now: () => Date = () => new Date(),
    decisionIdFactory: () => string = () => `decision-${randomUUID()}`,
  ) {
    const baseUrl = validateRelayUrl(config.baseUrl);
    if (!config.badgeToken || /\s/.test(config.badgeToken)) {
      throw new Error('Desktop Relay badge token must be a non-empty opaque value');
    }
    validateTenantId(config.tenantId);
    validateActorRef(config.actorRef);
    this.#baseUrl = baseUrl;
    this.#badgeToken = config.badgeToken;
    this.#tenantId = config.tenantId;
    this.#actorRef = config.actorRef;
    this.#fetch = fetchImpl;
    this.#now = now;
    this.#decisionIdFactory = decisionIdFactory;
  }

  assertLocalIdentity(identity: DesktopRelayIdentity): void {
    if (identity.tenantId !== this.#tenantId || identity.actorRef !== this.#actorRef) {
      throw new DesktopRelayError(403, 'identity_mismatch', 'Desktop session is not authorized for the configured Relay identity');
    }
  }

  async listNodes(): Promise<readonly RelayNodeProjection[]> {
    await this.#assertRemoteIdentity();
    const payload = await this.#request('/v1/control/nodes');
    const nodes = requireArray(payload, 'nodes').map((value) => requireNode(value));
    nodes.forEach((node) => assertTenant(node, this.#tenantId, 'Relay node'));
    return nodes;
  }

  async enqueueTask(envelope: unknown): Promise<unknown> {
    const record = requireRecord(envelope, 'task envelope');
    assertTenant(record, this.#tenantId, 'Task envelope');
    await this.#assertRemoteIdentity();
    const payload = requireRecord(await this.#request('/v1/tasks/enqueue', {
      method: 'POST',
      body: JSON.stringify(record),
    }), 'enqueue response');
    const task = requireTask(payload.task);
    assertTenant(task, this.#tenantId, 'Enqueued task');
    const nestedEnvelope = requireRecord(task.envelope, 'enqueued task envelope');
    assertTenant(nestedEnvelope, this.#tenantId, 'Enqueued task envelope');
    return payload;
  }

  async listTasks(): Promise<readonly RelayTaskProjection[]> {
    await this.#assertRemoteIdentity();
    const payload = await this.#request('/v1/control/tasks');
    const tasks = requireArray(payload, 'tasks').map((value) => requireTask(value));
    tasks.forEach((task) => {
      assertTenant(task, this.#tenantId, 'Relay task');
      assertTenant(requireRecord(task.envelope, 'Relay task envelope'), this.#tenantId, 'Relay task envelope');
    });
    return tasks;
  }

  async listApprovalRequests(): Promise<readonly RelayApprovalProjection[]> {
    await this.#assertRemoteIdentity();
    const payload = await this.#request('/v1/control/approval-requests');
    const approvals = requireArray(payload, 'approvalRequests').map((value) => requireApproval(value));
    approvals.forEach((approval) => this.#assertApprovalTenant(approval));
    return approvals;
  }

  async decideApproval(input: DesktopRelayDecisionRequest): Promise<unknown> {
    await this.#assertRemoteIdentity();
    const approval = requireApproval(property(
      await this.#request(`/v1/control/approval-requests/${segment(input.requestId)}`),
      'approvalRequest',
    ));
    this.#assertApprovalTenant(approval);
    if (approval.requestId !== input.requestId) {
      throw new DesktopRelayError(502, 'request_mismatch', 'Relay returned a different approval request');
    }
    const request = approval.request;
    const expiresAt = requireIsoTimestamp(request.expiresAt, 'approval request expiry');
    if (Date.parse(expiresAt) <= this.#now().getTime()) {
      throw new DesktopRelayError(409, 'approval_expired', 'Approval request has expired');
    }
    const decision = {
      schema: 'hummer.approval-decision',
      version: 1,
      decisionId: requireIdentifier(this.#decisionIdFactory(), 'decision id'),
      requestId: input.requestId,
      tenantId: this.#tenantId,
      deciderActorRef: this.#actorRef,
      decidedAt: this.#now().toISOString(),
      decision: input.decision,
      ...(input.rationale ? { rationale: input.rationale } : {}),
      ...(input.decision === 'approved'
        ? { grantedScope: deriveGrantedScope(request.requestedScope, expiresAt) }
        : {}),
    };
    const payload = requireRecord(await this.#request(
      `/v1/approval-requests/${segment(input.requestId)}/decision`,
      { method: 'POST', body: JSON.stringify(decision) },
    ), 'approval decision response');
    const stored = requireRecord(payload.decision, 'approval decision');
    assertTenant(stored, this.#tenantId, 'Approval decision');
    if (stored.requestId !== input.requestId || stored.deciderActorRef !== this.#actorRef || stored.decision !== input.decision) {
      throw new DesktopRelayError(502, 'decision_mismatch', 'Relay returned a mismatched approval decision');
    }
    return payload;
  }

  async revokeApproval(requestId: string): Promise<unknown> {
    await this.#assertRemoteIdentity();
    const approval = requireApproval(property(
      await this.#request(`/v1/control/approval-requests/${segment(requestId)}`),
      'approvalRequest',
    ));
    this.#assertApprovalTenant(approval);
    if (approval.requestId !== requestId) {
      throw new DesktopRelayError(502, 'request_mismatch', 'Relay returned a different approval request');
    }
    const payload = requireRecord(await this.#request(
      `/v1/approval-requests/${segment(requestId)}/revoke`,
      { method: 'POST', body: '{}' },
    ), 'approval revocation response');
    const revocation = requireRecord(payload.revocation, 'approval revocation');
    assertTenant(revocation, this.#tenantId, 'Approval revocation');
    if (revocation.requestId !== requestId || revocation.actorRef !== this.#actorRef) {
      throw new DesktopRelayError(502, 'revocation_mismatch', 'Relay returned a mismatched approval revocation');
    }
    return payload;
  }

  async stopTask(taskId: string): Promise<unknown> {
    await this.#assertRemoteIdentity();
    const before = requireTask(property(
      await this.#request(`/v1/control/tasks/${segment(taskId)}`),
      'task',
    ));
    assertTenant(before, this.#tenantId, 'Relay task');
    if (before.taskId !== taskId) throw new DesktopRelayError(502, 'task_mismatch', 'Relay returned a different task');
    const payload = requireRecord(await this.#request(`/v1/tasks/${segment(taskId)}/stop`, {
      method: 'POST', body: '{}',
    }), 'stop response');
    const stopped = requireTask(payload.task);
    assertTenant(stopped, this.#tenantId, 'Stopped task');
    if (stopped.taskId !== taskId) throw new DesktopRelayError(502, 'task_mismatch', 'Relay stopped a different task');
    return payload;
  }

  async #assertRemoteIdentity(): Promise<void> {
    const payload = requireRecord(await this.#request('/v1/control/session'), 'Relay session response');
    const session = requireRecord(payload.session, 'Relay session');
    const projection: RelaySessionProjection = {
      tenantId: requireIdentifier(session.tenantId, 'Relay session tenant'),
      actorRef: requireActorRef(session.actorRef, 'Relay session actor'),
    };
    if (projection.tenantId !== this.#tenantId || projection.actorRef !== this.#actorRef) {
      throw new DesktopRelayError(403, 'relay_identity_mismatch', 'Relay badge identity does not match the trusted Desktop configuration');
    }
  }

  #assertApprovalTenant(approval: RelayApprovalProjection): void {
    assertTenant(approval, this.#tenantId, 'Approval request');
    assertTenant(approval.request, this.#tenantId, 'Approval request body');
    if (approval.request.requestId !== approval.requestId) {
      throw new DesktopRelayError(502, 'request_mismatch', 'Relay approval request binding is invalid');
    }
  }

  async #request(path: string, init: RequestInit = {}): Promise<unknown> {
    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}${path}`, {
        ...init,
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${this.#badgeToken}`,
          ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
          ...init.headers,
        },
      });
    } catch {
      throw new DesktopRelayError(0, 'network_error', 'Relay request failed');
    }
    const payload = await parseResponse(response);
    if (!response.ok) {
      const candidate = relayError(payload);
      throw new DesktopRelayError(
        response.status,
        redact(candidate.code, this.#badgeToken),
        redact(candidate.message, this.#badgeToken),
      );
    }
    if (containsSecret(payload, this.#badgeToken)) {
      throw new DesktopRelayError(502, 'invalid_response', 'Relay response contained forbidden credential material');
    }
    return payload;
  }
}

export class DesktopRelayError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = 'DesktopRelayError';
  }
}

function parseDecisionRequest(value: unknown): DesktopRelayDecisionRequest {
  const input = requireRecord(value, 'approval decision request');
  const allowed = new Set(['token', 'requestId', 'decision', 'rationale']);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    throw new DesktopRelayError(400, 'invalid_request', 'Approval decision request contains an unknown field');
  }
  if (input.decision !== 'approved' && input.decision !== 'denied') {
    throw new DesktopRelayError(400, 'invalid_request', 'Approval decision must be approved or denied');
  }
  const rationale = input.rationale;
  if (rationale !== undefined && (typeof rationale !== 'string' || rationale.length > 4096)) {
    throw new DesktopRelayError(400, 'invalid_request', 'Approval rationale is invalid');
  }
  return {
    token: requireString(input.token, 'session token'),
    requestId: requireIdentifier(input.requestId, 'approval request id'),
    decision: input.decision,
    ...(rationale ? { rationale } : {}),
  };
}

function deriveGrantedScope(value: unknown, expiresAt: string): Record<string, unknown> {
  const scope = requireRecord(value, 'requested approval scope');
  const allowed = new Set(['capabilities', 'paths', 'maxUses']);
  if (Object.keys(scope).some((key) => !allowed.has(key))) {
    throw new DesktopRelayError(502, 'invalid_response', 'Relay approval scope contains an unknown field');
  }
  const capabilities = requireStringArray(scope.capabilities, 'requested capabilities', true);
  const paths = scope.paths === undefined ? undefined : requireStringArray(scope.paths, 'requested paths', false);
  const maxUses = scope.maxUses;
  if (maxUses !== undefined && (!Number.isInteger(maxUses) || Number(maxUses) < 1 || Number(maxUses) > 10_000)) {
    throw new DesktopRelayError(502, 'invalid_response', 'Relay approval maxUses is invalid');
  }
  return {
    capabilities,
    ...(paths ? { paths } : {}),
    ...(maxUses === undefined ? {} : { maxUses }),
    expiresAt,
  };
}

function validateRelayUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Desktop Relay URL is invalid'); }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Desktop Relay URL must not contain credentials, query, or fragment');
  }
  const loopbackHttp = url.protocol === 'http:'
    && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]');
  if (url.protocol !== 'https:' && !loopbackHttp) {
    throw new Error('Desktop Relay URL must use HTTPS; HTTP is allowed only for loopback development');
  }
  return url.toString().replace(/\/$/, '');
}

function validateTenantId(value: string): void {
  requireIdentifier(value, 'Desktop Relay tenant');
}

function validateActorRef(value: string): void {
  requireActorRef(value, 'Desktop Relay actor');
}

function requireActorRef(value: unknown, label: string): string {
  const actorRef = requireString(value, label);
  if (!/^(?:human|account):[A-Za-z0-9_-]+$/.test(actorRef) || actorRef.length > 160) {
    throw new DesktopRelayError(400, 'invalid_identity', `${label} is invalid`);
  }
  return actorRef;
}

function requireIdentifier(value: unknown, label: string): string {
  const identifier = requireString(value, label);
  if (identifier.length > 128 || /[\u0000-\u001f]/.test(identifier)) {
    throw new DesktopRelayError(400, 'invalid_request', `${label} is invalid`);
  }
  return identifier;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new DesktopRelayError(400, 'invalid_request', `${label} is required`);
  }
  return value;
}

function requireIsoTimestamp(value: unknown, label: string): string {
  const timestamp = requireString(value, label);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(timestamp)
    || !Number.isFinite(Date.parse(timestamp))) {
    throw new DesktopRelayError(502, 'invalid_response', `${label} is invalid`);
  }
  return timestamp;
}

function requireStringArray(value: unknown, label: string, nonEmpty: boolean): string[] {
  if (!Array.isArray(value) || (nonEmpty && value.length === 0)
    || value.length > 128 || value.some((entry) => typeof entry !== 'string' || !entry.trim())
    || new Set(value).size !== value.length) {
    throw new DesktopRelayError(502, 'invalid_response', `${label} is invalid`);
  }
  return [...value] as string[];
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DesktopRelayError(502, 'invalid_response', `${label} is invalid`);
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, key: string): unknown[] {
  const record = requireRecord(value, 'Relay response');
  if (!Array.isArray(record[key])) throw new DesktopRelayError(502, 'invalid_response', `Relay ${key} response is invalid`);
  return record[key] as unknown[];
}

function requireNode(value: unknown): RelayNodeProjection {
  const node = requireRecord(value, 'Relay node');
  return {
    ...node,
    nodeId: requireIdentifier(node.nodeId, 'Relay node id'),
    tenantId: requireIdentifier(node.tenantId, 'Relay node tenant'),
    status: node.status === 'online' || node.status === 'offline'
      ? node.status : failResponse('Relay node status is invalid'),
    lastSeenAt: requireIsoTimestamp(node.lastSeenAt, 'Relay node lastSeenAt'),
    manifest: requireRecord(node.manifest, 'Relay node manifest'),
  };
}

function requireTask(value: unknown): RelayTaskProjection {
  const task = requireRecord(value, 'Relay task');
  return {
    ...task,
    taskId: requireIdentifier(task.taskId, 'Relay task id'),
    tenantId: requireIdentifier(task.tenantId, 'Relay task tenant'),
    status: requireString(task.status, 'Relay task status'),
    envelope: requireRecord(task.envelope, 'Relay task envelope'),
  };
}

function requireApproval(value: unknown): RelayApprovalProjection {
  const approval = requireRecord(value, 'Relay approval request');
  return {
    ...approval,
    requestId: requireIdentifier(approval.requestId, 'Relay approval request id'),
    taskId: requireIdentifier(approval.taskId, 'Relay approval task id'),
    tenantId: requireIdentifier(approval.tenantId, 'Relay approval tenant'),
    request: requireRecord(approval.request, 'Relay approval request body'),
  };
}

function assertTenant(value: Record<string, unknown>, tenantId: string, label: string): void {
  if (value.tenantId !== tenantId) {
    throw new DesktopRelayError(403, 'tenant_mismatch', `${label} does not belong to the authenticated tenant`);
  }
}

function property(value: unknown, key: string): unknown {
  return requireRecord(value, 'Relay response')[key];
}

function segment(value: string): string { return encodeURIComponent(value); }

function failResponse(message: string): never {
  throw new DesktopRelayError(502, 'invalid_response', message);
}

async function parseResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try { return JSON.parse(text) as unknown; } catch {
    throw new DesktopRelayError(response.status, 'invalid_response', 'Relay returned invalid JSON');
  }
}

function relayError(value: unknown): { code: string; message: string } {
  const error = value && typeof value === 'object' && 'error' in value
    ? (value as { error?: unknown }).error : undefined;
  if (!error || typeof error !== 'object') return { code: 'relay_error', message: 'Relay request was rejected' };
  const candidate = error as { code?: unknown; message?: unknown };
  return {
    code: typeof candidate.code === 'string' ? candidate.code.slice(0, 128) : 'relay_error',
    message: typeof candidate.message === 'string' ? candidate.message.slice(0, 1024) : 'Relay request was rejected',
  };
}

function redact(value: string, secret: string): string {
  return secret ? value.split(secret).join('[redacted]') : value;
}

function containsSecret(value: unknown, secret: string): boolean {
  return Boolean(secret) && JSON.stringify(value).includes(secret);
}

function requireTrustedMainFrame(event: IpcMainInvokeEvent): void {
  if (!event.senderFrame || event.senderFrame.parent !== null) {
    throw new DesktopRelayError(403, 'untrusted_frame', 'Desktop Relay is restricted to the trusted top-level renderer');
  }
}
