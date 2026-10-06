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
} from './badge-auth.js';
import {
  FleetRejectedError,
  type AuthenticatedFleetSession,
  type FleetIngress,
  type FleetTaskRecord,
  type FleetTransport,
} from './ports.js';

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
  #sequence = 0;

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

  publish(tenantId: string, nodeId: string, event: 'task.available' | 'task.stop', data: unknown): void {
    const subscribers = this.#subscribers.get(streamKey(tenantId, nodeId));
    if (!subscribers) return;
    const now = Date.now();
    const id = String(++this.#sequence);
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
  }

  private remove(key: string, subscriber: StreamSubscriber): void {
    clearTimeout(subscriber.timer);
    const subscribers = this.#subscribers.get(key);
    if (!subscribers) return;
    subscribers.delete(subscriber);
    if (subscribers.size === 0) this.#subscribers.delete(key);
  }
}

export interface FleetRelayServerOptions {
  authenticator: BadgeTokenAuthenticator;
  now?: () => Date;
  events?: FleetSseBroker;
}

function parseBearer(header: string | undefined): string {
  if (!header) throw new TransportHttpError(401, 'missing_token', 'Bearer badge token is required');
  const match = /^Bearer ([^\s]+)$/.exec(header);
  if (!match) throw new TransportHttpError(401, 'invalid_token', 'Bearer badge token is invalid');
  return match[1]!;
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

function fleetStatus(error: FleetRejectedError): number {
  if (error.code === 'invalid_contract') return 400;
  if (error.code === 'tenant_mismatch' || error.code === 'lease_owner_mismatch' || error.code === 'actor_mismatch') return 403;
  if (error.code === 'node_unknown' || error.code === 'approval_not_found') return 404;
  return 409;
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
      session: { tenantId: claims.tenantId, actorRef: claims.actorRef, nodeId: claims.nodeId },
    };
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

  app.post('/v1/tasks/:taskId/stop', async (request) => {
    const { session } = await authorize(request, 'task.stop');
    assertNoFields(request.body);
    const task = await ingress.stop(session, pathParam(request, 'taskId'));
    events.publish(task.tenantId, task.targetNodeId, 'task.stop', { taskId: task.taskId });
    return { task };
  });

  app.get('/v1/nodes/:nodeId/events', async (request, reply: FastifyReply) => {
    const nodeId = pathParam(request, 'nodeId');
    const { claims } = await authorize(request, 'stream.connect', nodeId);
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
