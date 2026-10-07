import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import { FLEET_CONTRACT_MAX_BYTES } from '@hummer/contracts';
import type { ServerResponse } from 'node:http';
import type {
  BadgeScope,
  BadgeTokenAuthenticator,
  BadgeTokenClaims,
  TaskGrantAuthenticator,
  TaskGrantAuthorizationInput,
} from './badge-auth.js';
import {
  FleetRejectedError,
  type AuthenticatedFleetSession,
  type FleetIngress,
  type FleetTaskRecord,
  type FleetTransport,
} from './ports.js';
import type { TaskGrantIssuer } from './task-grant-issuer.js';

interface AuthorizedRequest {
  claims: BadgeTokenClaims;
  session: AuthenticatedFleetSession;
}

class TransportHttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'TransportHttpError';
  }
}

interface StreamSubscriber {
  response: ServerResponse;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout>;
}

const streamKey = (tenantId: string, nodeId: string) => `${tenantId}\u0000${nodeId}`;

export class FleetSseBroker {
  readonly #subscribers = new Map<string, Set<StreamSubscriber>>();
  /** Stream-local IDs prevent another tenant or node's activity from creating observable gaps. */
  readonly #sequences = new Map<string, number>();

  subscribe(tenantId: string, nodeId: string, response: ServerResponse, expiresAt: string): void {
    const expiry = Date.parse(expiresAt);
    const remaining = Math.max(0, expiry - Date.now());
    const subscriber: StreamSubscriber = {
      response,
      expiresAt: expiry,
      timer: setTimeout(() => response.end(), Math.min(remaining, 2_147_483_647)),
    };
    const key = streamKey(tenantId, nodeId);
    const subscribers = this.#subscribers.get(key) ?? new Set<StreamSubscriber>();
    subscribers.add(subscriber);
    this.#subscribers.set(key, subscribers);
    response.once('close', () => this.remove(key, subscriber));
    response.write(': connected\n\n');
  }

  publish(tenantId: string, nodeId: string, event: 'task.available' | 'task.stop' | 'approval.revoked', data: unknown): void {
    const key = streamKey(tenantId, nodeId);
    const subscribers = this.#subscribers.get(key);
    if (!subscribers) return;
    const now = Date.now();
    const sequence = (this.#sequences.get(key) ?? 0) + 1;
    this.#sequences.set(key, sequence);
    const id = String(sequence);
    const frame = `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const subscriber of [...subscribers]) {
      if (subscriber.expiresAt <= now || subscriber.response.destroyed || subscriber.response.writableEnded) {
        subscriber.response.end();
        continue;
      }
      subscriber.response.write(frame);
    }
  }

  close(): void {
    for (const subscribers of this.#subscribers.values()) {
      for (const subscriber of subscribers) {
        clearTimeout(subscriber.timer);
        subscriber.response.end();
      }
    }
    this.#subscribers.clear();
    this.#sequences.clear();
  }

  private remove(key: string, subscriber: StreamSubscriber): void {
    clearTimeout(subscriber.timer);
    const subscribers = this.#subscribers.get(key);
    if (!subscribers) return;
    subscribers.delete(subscriber);
    if (subscribers.size === 0) {
      this.#subscribers.delete(key);
      this.#sequences.delete(key);
    }
  }
}

export interface FleetRelayServerOptions {
  authenticator: BadgeTokenAuthenticator;
  /** Optional task-scoped authority. Missing wiring fails closed at the task-grant routes. */
  taskGrantAuthenticator?: TaskGrantAuthenticator;
  /** Optional post-approval issuer. It persists only a token digest before returning the token to the bound node. */
  taskGrantIssuer?: TaskGrantIssuer;
  now?: () => Date;
  events?: FleetSseBroker;
  /** Optional W10 public marketplace adapter. Absence is an explicit 503, never sample data. */
  publicMarket?: PublicMarketplaceHttpPort;
}

export interface PublicMarketplaceHttpPort {
  browse(): readonly Readonly<Record<string, unknown>>[];
  report(input: {
    reportId: string;
    listingId: string;
    reporterTenantId: string;
    reporterActorRef: string;
    reason: string;
  }): Readonly<Record<string, unknown>>;
  listOpenReports(requestTenantId: string, actorRef: string): readonly Readonly<Record<string, unknown>>[];
  takeDown(input: {
    actionId: string;
    reportId: string;
    listingId: string;
    requestTenantId: string;
    moderatorActorRef: string;
    reason: string;
  }): void;
  authorizeInstall(input: {
    attemptId: string;
    listingId: string;
    targetTenantId: string;
    gate: unknown;
  }): Readonly<Record<string, unknown>>;
}

function parseBearer(header: string | undefined): string {
  if (!header) throw new TransportHttpError(401, 'missing_token', 'Bearer badge token is required');
  const match = /^Bearer ([^\s]+)$/.exec(header);
  if (!match) throw new TransportHttpError(401, 'invalid_token', 'Bearer badge token is invalid');
  return match[1]!;
}

function parseTaskGrant(header: string | string[] | undefined): string {
  if (typeof header !== 'string' || !header || /\s/.test(header)) {
    throw new TransportHttpError(401, 'invalid_task_grant', 'Task grant is invalid or expired');
  }
  return header;
}

function pathParam(request: FastifyRequest, name: string): string {
  const params = request.params as Record<string, unknown>;
  const value = params[name];
  if (typeof value !== 'string' || !value.trim()) {
    throw new TransportHttpError(400, 'invalid_contract', `${name} is required`);
  }
  return value;
}

function assertNoFields(body: unknown): void {
  if (body === undefined || (typeof body === 'object' && body !== null && !Array.isArray(body) && Object.keys(body).length === 0)) return;
  throw new TransportHttpError(400, 'invalid_contract', 'request body must not contain fields');
}

function assertNoQueryFields(request: FastifyRequest): void {
  const query = (request.query ?? {}) as Record<string, unknown>;
  if (Object.keys(query).length > 0) {
    throw new TransportHttpError(400, 'invalid_contract', 'control-plane query must not contain fields');
  }
}

function controlResourceNotFound(): TransportHttpError {
  return new TransportHttpError(404, 'control_resource_not_found', 'control-plane resource was not found');
}

function exactBody(input: unknown, allowed: readonly string[], subject: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TransportHttpError(400, 'invalid_contract', `${subject} must be an object`);
  }
  const body = input as Record<string, unknown>;
  if (Object.keys(body).some((key) => !allowed.includes(key))) {
    throw new TransportHttpError(400, 'invalid_contract', `${subject} contains an unknown field`);
  }
  return body;
}

function requiredText(value: unknown, field: string, maxLength = 2_000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new TransportHttpError(400, 'invalid_contract', `${field} is required`);
  }
  return value.trim();
}

function publicMarket(options: FleetRelayServerOptions): PublicMarketplaceHttpPort {
  if (!options.publicMarket) {
    throw new TransportHttpError(503, 'public_market_unavailable', 'public marketplace is not configured');
  }
  return options.publicMarket;
}

function marketFailure(error: unknown): never {
  const message = error instanceof Error ? error.message : 'Marketplace request failed';
  if (/authorization denied/i.test(message)) {
    throw new TransportHttpError(403, 'marketplace_forbidden', 'marketplace authorization denied');
  }
  if (/unavailable|not found/i.test(message)) {
    throw new TransportHttpError(404, 'public_listing_not_found', 'public capability listing was not found');
  }
  if (/required|invalid|does not match|not bound/i.test(message)) {
    throw new TransportHttpError(400, 'invalid_contract', message);
  }
  throw error;
}

function fleetStatus(error: FleetRejectedError): number {
  if (error.code === 'invalid_contract') return 400;
  if (error.code === 'tenant_mismatch' || error.code === 'lease_owner_mismatch' || error.code === 'actor_mismatch') return 403;
  if (error.code === 'node_unknown' || error.code === 'approval_not_found' || error.code === 'audit_export_not_found'
    || error.code === 'capability_not_found') return 404;
  if (error.code === 'capability_trust_denied') return 403;
  if (error.code === 'quota_exceeded') return 429;
  return 409;
}

function auditRange(request: FastifyRequest): { rangeFrom?: number; rangeTo?: number } {
  const query = (request.query ?? {}) as Record<string, unknown>;
  if (Object.keys(query).some((key) => key !== 'rangeFrom' && key !== 'rangeTo')) {
    throw new TransportHttpError(400, 'invalid_contract', 'audit query contains an unknown field');
  }
  const result: { rangeFrom?: number; rangeTo?: number } = {};
  for (const [key, value] of Object.entries(query)) {
    if (typeof value !== 'string' || !/^\d+$/.test(value) || Number(value) < 1) {
      throw new TransportHttpError(400, 'invalid_contract', `${key} must be a positive integer`);
    }
    result[key as 'rangeFrom' | 'rangeTo'] = Number(value);
  }
  if (result.rangeFrom !== undefined && result.rangeTo !== undefined && result.rangeTo < result.rangeFrom) {
    throw new TransportHttpError(400, 'invalid_contract', 'audit range is invalid');
  }
  return result;
}

export function createFleetRelayServer(
  ingress: FleetIngress,
  options: FleetRelayServerOptions,
): { app: FastifyInstance; events: FleetSseBroker } {
  const app = Fastify({ logger: false, bodyLimit: FLEET_CONTRACT_MAX_BYTES });
  const events = options.events ?? new FleetSseBroker();
  const now = options.now ?? (() => new Date());

  async function authorize(
    request: FastifyRequest,
    scope: BadgeScope,
    expectedNodeId?: string,
  ): Promise<AuthorizedRequest> {
    const token = parseBearer(request.headers.authorization);
    const authorization = await options.authenticator.authorize({
      token,
      scope,
      now: now().toISOString(),
    });
    if (!authorization.ok && authorization.reason === 'scope_denied') {
      throw new TransportHttpError(403, 'scope_denied', `badge does not grant ${scope}`);
    }
    if (!authorization.ok) {
      throw new TransportHttpError(401, 'invalid_token', 'Bearer badge token is invalid or expired');
    }
    const { claims } = authorization;
    if (expectedNodeId !== undefined && claims.nodeId !== expectedNodeId) {
      throw new TransportHttpError(403, 'node_mismatch', 'badge is not bound to this node');
    }
    return {
      claims,
      session: {
        tenantId: claims.tenantId,
        actorRef: claims.actorRef,
        nodeId: claims.nodeId,
        ...(claims.authorizedTenantIds ? { authorizedTenantIds: claims.authorizedTenantIds } : {}),
        ...(claims.grantRef ? { tenantGrantRef: claims.grantRef } : {}),
        authExpiresAt: claims.expiresAt,
      },
    };
  }

  async function taskGrantContext(
    request: FastifyRequest,
    nodeId: string,
    taskId: string,
    requestId: string,
  ) {
    const { session } = await authorize(request, 'approval.consume', nodeId);
    const task = await ingress.getTask(session, taskId);
    if (!task || task.targetNodeId !== nodeId || task.leaseOwnerNodeId !== nodeId || task.status !== 'leased') {
      throw new TransportHttpError(404, 'task_grant_context_not_found', 'Task grant context was not found');
    }
    const grantRef = typeof task.envelope.grantRef === 'string' ? task.envelope.grantRef : '';
    const approval = await ingress.getApprovalRequest(session, requestId);
    if (!grantRef || !approval || approval.taskId !== taskId || approval.nodeId !== nodeId
      || approval.workOrderId !== task.workOrderId || approval.authorization?.state !== 'approved'
      || approval.decision?.decision !== 'approved' || !approval.decision.grantedScope
      || approval.decision.grantedScope.maxUses !== 1) {
      throw new TransportHttpError(409, 'task_grant_context_invalid', 'Task grant context is not authorized');
    }
    return { session, task, approval, grantRef, grantedScope: approval.decision.grantedScope };
  }

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof TransportHttpError) {
      return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message } });
    }
    if (error instanceof FleetRejectedError) {
      return reply.status(fleetStatus(error)).send({ error: { code: error.code, message: error.message } });
    }
    const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error && typeof error.statusCode === 'number'
      ? error.statusCode
      : 500;
    if (statusCode >= 400 && statusCode < 500) {
      return reply.status(statusCode).send({ error: { code: 'invalid_request', message: 'request was rejected' } });
    }
    return reply.status(500).send({ error: { code: 'internal_error', message: 'relay request failed' } });
  });

  app.get('/v1/public/capabilities', async (request) => {
    assertNoQueryFields(request);
    return { listings: publicMarket(options).browse() };
  });

  app.get('/v1/public/capabilities/:listingId', async (request) => {
    assertNoQueryFields(request);
    const listingId = pathParam(request, 'listingId');
    const listing = publicMarket(options).browse().find((item) => item.listingId === listingId);
    if (!listing) throw new TransportHttpError(404, 'public_listing_not_found', 'public capability listing was not found');
    return { listing };
  });

  app.post('/v1/public/capabilities/:listingId/reports', async (request) => {
    const { claims } = await authorize(request, 'marketplace.report');
    if (claims.nodeId || !claims.actorRef.startsWith('human:')) {
      throw new TransportHttpError(403, 'human_badge_required', 'marketplace reports require a human badge');
    }
    const body = exactBody(request.body, ['reportId', 'reason'], 'marketplace report');
    try {
      const report = publicMarket(options).report({
        reportId: requiredText(body.reportId, 'reportId', 128),
        listingId: pathParam(request, 'listingId'),
        reporterTenantId: claims.tenantId,
        reporterActorRef: claims.actorRef,
        reason: requiredText(body.reason, 'reason'),
      });
      return {
        report: {
          reportId: report.reportId,
          listingId: report.listingId,
          status: report.status,
          createdAt: report.createdAt,
        },
      };
    } catch (error) {
      marketFailure(error);
    }
  });

  app.post('/v1/public/capabilities/:listingId/install-authorizations', async (request) => {
    const { claims } = await authorize(request, 'capability.install.evaluate');
    if (claims.nodeId || !/^(?:human|account):/.test(claims.actorRef)) {
      throw new TransportHttpError(403, 'control_badge_required', 'install authorization requires a human/account badge');
    }
    const body = exactBody(request.body, ['attemptId', 'targetTenantId', 'gate'], 'public install authorization');
    const targetTenantId = requiredText(body.targetTenantId, 'targetTenantId', 128);
    if (targetTenantId !== claims.tenantId) {
      throw new TransportHttpError(403, 'tenant_mismatch', 'install authorization is bound to the badge tenant');
    }
    const gate = body.gate as Record<string, unknown> | undefined;
    if (!gate || gate.requestedByActorRef !== claims.actorRef) {
      throw new TransportHttpError(403, 'actor_mismatch', 'install authorization is bound to the badge actor');
    }
    try {
      return {
        decision: publicMarket(options).authorizeInstall({
          attemptId: requiredText(body.attemptId, 'attemptId', 128),
          listingId: pathParam(request, 'listingId'),
          targetTenantId,
          gate,
        }),
      };
    } catch (error) {
      marketFailure(error);
    }
  });

  app.get('/v1/marketplace/moderation/reports', async (request) => {
    const { claims } = await authorize(request, 'marketplace.moderate');
    if (claims.nodeId || !claims.actorRef.startsWith('human:')) {
      throw new TransportHttpError(403, 'human_badge_required', 'marketplace moderation requires a human badge');
    }
    assertNoQueryFields(request);
    try {
      return { reports: publicMarket(options).listOpenReports(claims.tenantId, claims.actorRef) };
    } catch (error) {
      marketFailure(error);
    }
  });

  app.post('/v1/marketplace/moderation/listings/:listingId/takedown', async (request) => {
    const { claims } = await authorize(request, 'marketplace.moderate');
    if (claims.nodeId || !claims.actorRef.startsWith('human:')) {
      throw new TransportHttpError(403, 'human_badge_required', 'marketplace moderation requires a human badge');
    }
    const body = exactBody(request.body, ['actionId', 'reportId', 'reason'], 'marketplace takedown');
    try {
      publicMarket(options).takeDown({
        actionId: requiredText(body.actionId, 'actionId', 128),
        reportId: requiredText(body.reportId, 'reportId', 128),
        listingId: pathParam(request, 'listingId'),
        requestTenantId: claims.tenantId,
        moderatorActorRef: claims.actorRef,
        reason: requiredText(body.reason, 'reason'),
      });
      return { status: 'taken_down' };
    } catch (error) {
      marketFailure(error);
    }
  });

  app.post('/v1/nodes/register', async (request) => {
    const body = request.body as Record<string, unknown> | undefined;
    const nodeId = body && typeof body.nodeId === 'string' ? body.nodeId : '';
    const { session } = await authorize(request, 'node.register', nodeId);
    return { node: await ingress.register(session, request.body) };
  });

  app.post('/v1/nodes/:nodeId/heartbeat', async (request) => {
    const nodeId = pathParam(request, 'nodeId');
    const { session } = await authorize(request, 'node.heartbeat', nodeId);
    return { node: await ingress.heartbeat(session, request.body) };
  });

  app.post('/v1/tasks/enqueue', async (request) => {
    const { session } = await authorize(request, 'task.enqueue');
    const result = await ingress.enqueue(session, request.body);
    if (result.inserted) events.publish(result.task.tenantId, result.task.targetNodeId, 'task.available', result.task);
    return result;
  });

  app.post('/v1/nodes/:nodeId/tasks/claim', async (request, reply) => {
    const nodeId = pathParam(request, 'nodeId');
    const { session } = await authorize(request, 'task.claim', nodeId);
    assertNoFields(request.body);
    const task = await ingress.claim(session, nodeId);
    if (!task) return reply.status(204).send();
    return { task };
  });

  const eventRoute = (
    path: '/v1/tasks/ack' | '/v1/tasks/complete' | '/v1/tasks/fail',
    operation: 'ack' | 'complete' | 'fail',
  ) => {
    app.post(path, async (request) => {
      const body = request.body as Record<string, unknown> | undefined;
      const nodeId = body && typeof body.nodeId === 'string' ? body.nodeId : '';
      const { session } = await authorize(request, 'task.event', nodeId);
      return ingress[operation](session, request.body);
    });
  };
  eventRoute('/v1/tasks/ack', 'ack');
  eventRoute('/v1/tasks/complete', 'complete');
  eventRoute('/v1/tasks/fail', 'fail');

  app.post('/v1/tasks/events', async (request) => {
    const body = request.body as Record<string, unknown> | undefined;
    const nodeId = body && typeof body.nodeId === 'string' ? body.nodeId : '';
    const { session } = await authorize(request, 'task.event', nodeId);
    return ingress.event(session, request.body);
  });

  app.post('/v1/nodes/:nodeId/tasks/:taskId/approval-requests', async (request) => {
    const nodeId = pathParam(request, 'nodeId');
    const { session } = await authorize(request, 'approval.request', nodeId);
    return {
      request: await ingress.requestApproval(session, pathParam(request, 'taskId'), request.body),
    };
  });

  app.post('/v1/approval-requests/:requestId/decision', async (request) => {
    const { claims, session } = await authorize(request, 'approval.decide');
    if (claims.nodeId || !/^(?:human|account):[A-Za-z0-9_-]+$/.test(claims.actorRef)) {
      throw new TransportHttpError(403, 'control_badge_required', 'approval decisions require a human/account control badge');
    }
    return {
      decision: await ingress.decideApproval(session, pathParam(request, 'requestId'), request.body),
    };
  });

  app.post('/v1/nodes/:nodeId/tasks/:taskId/approval-requests/:requestId/consume', async (request) => {
    const nodeId = pathParam(request, 'nodeId');
    const { session } = await authorize(request, 'approval.consume', nodeId);
    assertNoFields(request.body);
    return ingress.consumeApproval(
      session,
      nodeId,
      pathParam(request, 'taskId'),
      pathParam(request, 'requestId'),
    );
  });

  app.get('/v1/nodes/:nodeId/tasks/:taskId/approval-requests/:requestId/authorization', async (request) => {
    const nodeId = pathParam(request, 'nodeId');
    const { session } = await authorize(request, 'approval.consume', nodeId);
    assertNoQueryFields(request);
    return {
      authorization: await ingress.getApprovalAuthorization(
        session,
        nodeId,
        pathParam(request, 'taskId'),
        pathParam(request, 'requestId'),
      ),
    };
  });

  app.post('/v1/nodes/:nodeId/tasks/:taskId/task-grant/token', async (request) => {
    const nodeId = pathParam(request, 'nodeId');
    const taskId = pathParam(request, 'taskId');
    if (!options.taskGrantIssuer) {
      throw new TransportHttpError(503, 'task_grant_issuer_unavailable', 'Task grant issuer is unavailable');
    }
    const body = exactBody(request.body, ['requestId'], 'task grant issuance');
    const requestId = requiredText(body.requestId, 'requestId', 128);
    const context = await taskGrantContext(request, nodeId, taskId, requestId);
    const taskExpiry = typeof context.task.envelope.expiresAt === 'string'
      ? context.task.envelope.expiresAt
      : context.grantedScope.expiresAt;
    const expiresAt = Date.parse(taskExpiry) < Date.parse(context.grantedScope.expiresAt)
      ? taskExpiry
      : context.grantedScope.expiresAt;
    return {
      taskGrant: options.taskGrantIssuer.issue({
        grantRef: context.grantRef,
        tenantId: context.session.tenantId,
        workOrderId: context.task.workOrderId,
        nodeId,
        issuedToRunId: context.approval.runId,
        capabilities: [...context.grantedScope.capabilities],
        paths: [...(context.grantedScope.paths ?? [])],
        expiresAt,
        issuedAt: context.approval.decision!.decidedAt,
      }),
    };
  });

  const taskGrantRoute = (
    path: '/v1/nodes/:nodeId/tasks/:taskId/task-grant/consume' | '/v1/nodes/:nodeId/tasks/:taskId/task-grant/checkpoint',
    operation: 'consume' | 'checkpoint',
  ) => {
    app.post(path, async (request) => {
      const nodeId = pathParam(request, 'nodeId');
      const taskId = pathParam(request, 'taskId');
      if (!options.taskGrantAuthenticator) {
        throw new TransportHttpError(503, 'task_grant_unavailable', 'Task grant authority is unavailable');
      }
      const body = exactBody(request.body, ['requestId'], 'task grant authorization');
      const requestId = requiredText(body.requestId, 'requestId', 128);
      const context = await taskGrantContext(request, nodeId, taskId, requestId);
      const input: TaskGrantAuthorizationInput = {
        token: parseTaskGrant(request.headers['x-hummer-task-grant']),
        grantRef: context.grantRef,
        tenantId: context.session.tenantId,
        workOrderId: context.task.workOrderId,
        nodeId,
        issuedToRunId: context.approval.runId,
        capabilities: [...context.grantedScope.capabilities],
        paths: [...(context.grantedScope.paths ?? [])],
        maxUses: 1,
        now: now().toISOString(),
      };
      const result = await options.taskGrantAuthenticator[operation](input);
      if (!result.ok) {
        throw new TransportHttpError(401, 'invalid_task_grant', 'Task grant is invalid or expired');
      }
      return { authorization: result.claims };
    });
  };

  taskGrantRoute('/v1/nodes/:nodeId/tasks/:taskId/task-grant/consume', 'consume');
  taskGrantRoute('/v1/nodes/:nodeId/tasks/:taskId/task-grant/checkpoint', 'checkpoint');

  app.post('/v1/approval-requests/:requestId/revoke', async (request) => {
    const { claims, session } = await authorize(request, 'approval.decide');
    if (claims.nodeId || !/^(?:human|account):[A-Za-z0-9_-]+$/.test(claims.actorRef)) {
      throw new TransportHttpError(403, 'control_badge_required', 'approval revocation requires a human/account control badge');
    }
    assertNoFields(request.body);
    const requestId = pathParam(request, 'requestId');
    const approvalRequest = await ingress.getApprovalRequest(session, requestId);
    if (!approvalRequest) throw controlResourceNotFound();
    const revocation = await ingress.revokeApproval(session, requestId);
    events.publish(session.tenantId, approvalRequest.nodeId, 'approval.revoked', {
      taskId: approvalRequest.taskId,
      requestId,
    });
    return { revocation };
  });

  app.post('/v1/tasks/:taskId/stop', async (request) => {
    const { session } = await authorize(request, 'task.stop');
    assertNoFields(request.body);
    const task = await ingress.stop(session, pathParam(request, 'taskId'));
    events.publish(task.tenantId, task.targetNodeId, 'task.stop', { taskId: task.taskId });
    return { task };
  });

  app.get('/v1/control/session', async (request) => {
    const { claims } = await authorize(request, 'node.read');
    assertNoQueryFields(request);
    if (claims.nodeId || !/^(?:human|account):[A-Za-z0-9_-]+$/.test(claims.actorRef)) {
      throw new TransportHttpError(403, 'control_badge_required', 'Desktop control requires a human/account badge');
    }
    return { session: { tenantId: claims.tenantId, actorRef: claims.actorRef } };
  });

  app.get('/v1/control/nodes', async (request) => {
    const { session } = await authorize(request, 'node.read');
    assertNoQueryFields(request);
    return { nodes: await ingress.listNodes(session) };
  });

  app.get('/v1/control/nodes/:nodeId', async (request) => {
    const { session } = await authorize(request, 'node.read');
    assertNoQueryFields(request);
    const node = await ingress.getNode(session, pathParam(request, 'nodeId'));
    if (!node) throw controlResourceNotFound();
    return { node };
  });

  app.get('/v1/control/tasks', async (request) => {
    const { session } = await authorize(request, 'task.read');
    assertNoQueryFields(request);
    return { tasks: await ingress.listTasks(session) };
  });

  app.get('/v1/control/tasks/:taskId', async (request) => {
    const { session } = await authorize(request, 'task.read');
    assertNoQueryFields(request);
    const task = await ingress.getTask(session, pathParam(request, 'taskId'));
    if (!task) throw controlResourceNotFound();
    return { task };
  });

  app.get('/v1/control/approval-requests', async (request) => {
    const { session } = await authorize(request, 'approval.read');
    assertNoQueryFields(request);
    return { approvalRequests: await ingress.listApprovalRequests(session) };
  });

  app.get('/v1/control/approval-requests/:requestId', async (request) => {
    const { session } = await authorize(request, 'approval.read');
    assertNoQueryFields(request);
    const approvalRequest = await ingress.getApprovalRequest(session, pathParam(request, 'requestId'));
    if (!approvalRequest) throw controlResourceNotFound();
    return { approvalRequest };
  });

  app.put('/v1/governance/nodes/:nodeId/quotas/:day', async (request) => {
    const nodeId = pathParam(request, 'nodeId');
    const { session } = await authorize(request, 'quota.manage');
    return {
      counters: await ingress.configureQuota(session, nodeId, pathParam(request, 'day'), request.body),
    };
  });

  app.post('/v1/governance/nodes/:nodeId/usage', async (request) => {
    const nodeId = pathParam(request, 'nodeId');
    const { session } = await authorize(request, 'quota.record', nodeId);
    return { counters: await ingress.recordQuotaUsage(session, nodeId, request.body) };
  });

  app.get('/v1/governance/nodes/:nodeId/quotas/:day', async (request) => {
    const nodeId = pathParam(request, 'nodeId');
    const { session } = await authorize(request, 'quota.read');
    return { counters: await ingress.listQuotaCounters(session, nodeId, pathParam(request, 'day')) };
  });

  app.get('/v1/governance/chain-head', async (request) => {
    const { session } = await authorize(request, 'audit.read');
    return { chainHead: await ingress.getTenantChainHead(session) };
  });

  app.get('/v1/governance/audit', async (request) => {
    const { session } = await authorize(request, 'audit.read');
    const range = auditRange(request);
    return { events: await ingress.listTenantAudit(session, range.rangeFrom, range.rangeTo) };
  });

  app.post('/v1/governance/audit-exports', async (request) => {
    const { session } = await authorize(request, 'audit.export');
    return { auditExport: await ingress.createAuditExport(session, request.body ?? {}) };
  });

  app.get('/v1/governance/audit-exports/:exportId', async (request) => {
    const { session } = await authorize(request, 'audit.read');
    const auditExport = await ingress.getAuditExport(session, pathParam(request, 'exportId'));
    if (!auditExport) throw new TransportHttpError(404, 'audit_export_not_found', 'audit export was not found');
    return { auditExport };
  });

  app.post('/v1/capabilities/versions', async (request) => {
    const { session } = await authorize(request, 'capability.write');
    return { capability: await ingress.createCapabilityVersion(session, request.body) };
  });

  app.post('/v1/capabilities/trials', async (request) => {
    const { session } = await authorize(request, 'capability.trial.record');
    return { capability: await ingress.recordCapabilityTrial(session, request.body) };
  });

  app.post('/v1/capabilities/shares', async (request) => {
    const { session } = await authorize(request, 'capability.share');
    return { share: await ingress.createCapabilityShare(session, request.body) };
  });

  app.get('/v1/capabilities', async (request) => {
    const { session } = await authorize(request, 'capability.read');
    assertNoQueryFields(request);
    return { capabilities: await ingress.listCapabilities(session) };
  });

  app.get('/v1/capabilities/:packageId', async (request) => {
    const { session } = await authorize(request, 'capability.read');
    const query = (request.query ?? {}) as Record<string, unknown>;
    if (Object.keys(query).some((key) => key !== 'version')) {
      throw new TransportHttpError(400, 'invalid_contract', 'capability query contains an unknown field');
    }
    const rawVersion = query.version;
    const version = rawVersion === undefined ? undefined
      : typeof rawVersion === 'string' && /^\d+$/.test(rawVersion) && Number(rawVersion) > 0 ? Number(rawVersion)
        : NaN;
    if (Number.isNaN(version)) throw new TransportHttpError(400, 'invalid_contract', 'version must be a positive integer');
    const capability = await ingress.getCapability(session, pathParam(request, 'packageId'), version);
    if (!capability) throw new TransportHttpError(404, 'capability_not_found', 'capability was not found');
    return { capability };
  });

  app.post('/v1/capabilities/install-gate', async (request) => {
    const { session } = await authorize(request, 'capability.install.evaluate');
    return { decision: await ingress.evaluateCapabilityInstall(session, request.body) };
  });

  app.get('/v1/nodes/:nodeId/events', async (request, reply: FastifyReply) => {
    const nodeId = pathParam(request, 'nodeId');
    const { claims } = await authorize(request, 'stream.connect', nodeId);
    // Last-Event-ID is intentionally not a replay cursor or authority input.
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    events.subscribe(claims.tenantId, nodeId, reply.raw, claims.expiresAt);
    return reply;
  });

  return { app, events };
}

export interface FastifyFleetTransportOptions extends FleetRelayServerOptions {
  host?: string;
  port?: number;
}

export class FastifyFleetTransport implements FleetTransport {
  readonly #events: FleetSseBroker;
  #app: FastifyInstance | null = null;

  constructor(private readonly options: FastifyFleetTransportOptions) {
    this.#events = options.events ?? new FleetSseBroker();
  }

  async start(ingress: FleetIngress): Promise<void> {
    if (this.#app) throw new Error('relay transport is already started');
    const { app } = createFleetRelayServer(ingress, { ...this.options, events: this.#events });
    await app.listen({ host: this.options.host ?? '127.0.0.1', port: this.options.port ?? 0 });
    this.#app = app;
  }

  async publishTask(nodeId: string, task: FleetTaskRecord): Promise<void> {
    this.#events.publish(task.tenantId, nodeId, 'task.available', task);
  }

  async publishControl(tenantId: string, nodeId: string, command: 'stop', taskId: string): Promise<void> {
    this.#events.publish(tenantId, nodeId, 'task.stop', { command, taskId });
  }

  async close(): Promise<void> {
    this.#events.close();
    const app = this.#app;
    this.#app = null;
    if (app) await app.close();
  }

  get address(): string | null {
    const address = this.#app?.server.address();
    return address && typeof address === 'object'
      ? `http://${this.options.host ?? '127.0.0.1'}:${address.port}`
      : null;
  }
}
