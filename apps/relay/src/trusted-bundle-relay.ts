import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import {
  validateCapabilityContract,
  validateTrustedBundleContract,
  createCapabilityInstallGateDecision,
  type CapabilityInstallGateInput,
  type TrustedBundleEnvelopeV1,
} from '@hummer/contracts';
import type { BadgeScope, BadgeTokenAuthenticator, BadgeTokenClaims } from './badge-auth.js';

export interface TrustedBundlePublishResult {
  readonly inserted: boolean;
  readonly envelopeDigest: string;
  readonly bundleId: string;
}

export interface ApprovedBundleAuthorization {
  readonly decision: unknown;
  readonly gateInput: unknown;
}
export type ApprovedInstallDecisionLookup = (tenantId: string, gateId: string) => Promise<ApprovedBundleAuthorization | null> | ApprovedBundleAuthorization | null;

export class TrustedBundleRelayError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) {
    super(message);
    this.name = 'TrustedBundleRelayError';
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((item) => `${JSON.stringify(item)}:${canonicalJson(record[item])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function storageKey(tenantId: string, bundleId: string): string { return `${tenantId}\0${bundleId}`; }

export interface TrustedBundleRelayStore {
  publish(claims: BadgeTokenClaims, input: unknown, authorization: ApprovedBundleAuthorization): TrustedBundlePublishResult;
  consume(claims: BadgeTokenClaims, nodeId: string, bundleId: string): TrustedBundleEnvelopeV1;
}

export function validateTrustedBundleAuthorization(
  envelope: TrustedBundleEnvelopeV1,
  authorization: ApprovedBundleAuthorization,
): void {
  const gateValidation = validateCapabilityContract('CapabilityInstallGateInput', authorization.gateInput);
  if (gateValidation.issues) throw new TrustedBundleRelayError(403, 'decision_mismatch', 'persisted install gate evidence is invalid');
  const gateInput: CapabilityInstallGateInput = gateValidation.value;
  const derivedDecision = createCapabilityInstallGateDecision(gateInput);
  if (derivedDecision.decision !== 'approved' || canonicalJson(authorization.decision) !== canonicalJson(derivedDecision) ||
      canonicalJson(authorization.decision) !== canonicalJson(envelope.decision) || gateInput.gateId !== envelope.gateId ||
      gateInput.requestDigest !== envelope.requestDigest || gateInput.shareDigest !== envelope.shareDigest ||
      gateInput.targetTenantId !== envelope.tenantId || canonicalJson(gateInput.share) !== canonicalJson(envelope.share)) {
    throw new TrustedBundleRelayError(403, 'decision_mismatch', 'bundle is not bound to the Relay approved install decision');
  }
  const transportedDigests = Object.fromEntries(envelope.descriptor.files.map((file) => [file.path, file.sha256]));
  if (gateInput.exportDescriptor.format !== 'agent-skills' || gateInput.exportDescriptor.installEntry !== 'manifest.json' ||
      canonicalJson(gateInput.exportDescriptor.fileDigests) !== canonicalJson(transportedDigests)) {
    throw new TrustedBundleRelayError(403, 'descriptor_mismatch', 'transported bytes do not match the approved install gate descriptor');
  }
}

export function validateTrustedBundlePublication(
  claims: BadgeTokenClaims,
  input: unknown,
  authorization: ApprovedBundleAuthorization,
): TrustedBundleEnvelopeV1 {
  if (claims.nodeId || !/^(?:human|account):[A-Za-z0-9_-]+$/.test(claims.actorRef)) {
    throw new TrustedBundleRelayError(403, 'control_badge_required', 'bundle publication requires a human/account control badge');
  }
  const validation = validateTrustedBundleContract('TrustedBundleEnvelopeV1', input);
  if (validation.issues) throw new TrustedBundleRelayError(400, 'invalid_bundle', validation.issues[0]?.message ?? 'invalid trusted bundle');
  const envelope = validation.value;
  if (claims.tenantId !== envelope.tenantId) throw new TrustedBundleRelayError(403, 'tenant_mismatch', 'bundle tenant does not match the authenticated badge');
  validateTrustedBundleAuthorization(envelope, authorization);
  return envelope;
}

/** Reference store. Persistent stores must retain these immutable/idempotent semantics. */
export class MemoryTrustedBundleRelayStore implements TrustedBundleRelayStore {
  readonly #bundles = new Map<string, TrustedBundleEnvelopeV1>();

  publish(claims: BadgeTokenClaims, input: unknown, authorization: ApprovedBundleAuthorization): TrustedBundlePublishResult {
    const envelope = validateTrustedBundlePublication(claims, input, authorization);
    const key = storageKey(envelope.tenantId, envelope.bundleId);
    const existing = this.#bundles.get(key);
    if (existing) {
      if (existing.envelopeDigest !== envelope.envelopeDigest) throw new TrustedBundleRelayError(409, 'bundle_conflict', 'bundle id is already bound to different immutable bytes');
      return { inserted: false, envelopeDigest: existing.envelopeDigest, bundleId: existing.bundleId };
    }
    this.#bundles.set(key, clone(envelope));
    return { inserted: true, envelopeDigest: envelope.envelopeDigest, bundleId: envelope.bundleId };
  }

  consume(claims: BadgeTokenClaims, nodeId: string, bundleId: string): TrustedBundleEnvelopeV1 {
    if (!claims.nodeId || claims.nodeId !== nodeId) throw new TrustedBundleRelayError(403, 'node_mismatch', 'bundle consumption requires the target node badge');
    const envelope = this.#bundles.get(storageKey(claims.tenantId, bundleId));
    if (!envelope) throw new TrustedBundleRelayError(404, 'bundle_not_found', 'trusted bundle was not found');
    if (envelope.targetNodeId !== nodeId) throw new TrustedBundleRelayError(403, 'node_mismatch', 'bundle is bound to a different target node');
    return clone(envelope);
  }
}

export interface TrustedBundleRelayServerOptions {
  readonly authenticator: BadgeTokenAuthenticator;
  readonly approvedDecisionLookup: ApprovedInstallDecisionLookup;
  readonly store?: TrustedBundleRelayStore;
  readonly now?: () => Date;
}

function bearer(header: string | undefined): string {
  const match = header && /^Bearer ([^\s]+)$/.exec(header);
  if (!match) throw new TrustedBundleRelayError(401, 'invalid_token', 'Bearer badge token is required');
  return match[1]!;
}

function pathParam(request: FastifyRequest, name: string): string {
  const value = (request.params as Record<string, unknown>)[name];
  if (typeof value !== 'string' || !value.trim()) throw new TrustedBundleRelayError(400, 'invalid_request', `${name} is required`);
  return value;
}

export function createTrustedBundleRelayServer(options: TrustedBundleRelayServerOptions): { readonly app: FastifyInstance; readonly store: TrustedBundleRelayStore } {
  const app = Fastify({ logger: false, bodyLimit: 524_288 });
  const store = options.store ?? new MemoryTrustedBundleRelayStore();
  const now = options.now ?? (() => new Date());
  const authorize = async (request: FastifyRequest, scope: BadgeScope, expectedNodeId?: string): Promise<BadgeTokenClaims> => {
    const result = await options.authenticator.authorize({ token: bearer(request.headers.authorization), scope, now: now().toISOString() });
    if (!result.ok && result.reason === 'scope_denied') throw new TrustedBundleRelayError(403, 'scope_denied', `badge does not grant ${scope}`);
    if (!result.ok) throw new TrustedBundleRelayError(401, 'invalid_token', 'Bearer badge token is invalid or expired');
    if (expectedNodeId && result.claims.nodeId !== expectedNodeId) throw new TrustedBundleRelayError(403, 'node_mismatch', 'badge is not bound to this node');
    return result.claims;
  };
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof TrustedBundleRelayError) return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message } });
    const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
    return reply.status(statusCode >= 400 && statusCode < 500 ? statusCode : 500).send({ error: { code: statusCode < 500 ? 'invalid_request' : 'internal_error', message: statusCode < 500 ? 'request was rejected' : 'relay request failed' } });
  });
  app.post('/v1/trusted-bundles', async (request) => {
    const claims = await authorize(request, 'capability.bundle.publish');
    const candidate = request.body as { gateId?: unknown } | undefined;
    const gateId = candidate && typeof candidate.gateId === 'string' ? candidate.gateId : '';
    if (!gateId) throw new TrustedBundleRelayError(400, 'invalid_bundle', 'gateId is required');
    const authorization = await options.approvedDecisionLookup(claims.tenantId, gateId);
    if (!authorization) throw new TrustedBundleRelayError(403, 'decision_not_found', 'approved install decision was not found');
    return store.publish(claims, request.body, authorization);
  });
  app.get('/v1/nodes/:nodeId/trusted-bundles/:bundleId', async (request) => {
    const nodeId = pathParam(request, 'nodeId');
    const claims = await authorize(request, 'capability.bundle.consume', nodeId);
    return { bundle: store.consume(claims, nodeId, pathParam(request, 'bundleId')) };
  });
  return { app, store };
}
