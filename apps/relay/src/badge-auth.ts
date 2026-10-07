import { createHash, randomBytes } from 'node:crypto';
import { validateFleetContract, type CapabilityGrant } from '@hummer/contracts';

export const BADGE_SCOPES = [
  'node.register',
  'node.heartbeat',
  'node.read',
  'task.enqueue',
  'task.claim',
  'task.event',
  'task.stop',
  'task.read',
  'stream.connect',
  'approval.request',
  'approval.decide',
  'approval.consume',
  'approval.read',
  'audit.read',
  'audit.export',
  'quota.manage',
  'quota.read',
  'quota.record',
  'capability.read',
  'capability.write',
  'capability.trial.record',
  'capability.share',
  'capability.install.evaluate',
  'marketplace.report',
  'marketplace.moderate',
  'marketplace.claim',
  'marketplace.offer',
  'marketplace.order',
  'marketplace.settle',
  'capability.bundle.publish',
  'capability.bundle.consume',
] as const;

export type BadgeScope = (typeof BADGE_SCOPES)[number];

export const TASK_GRANT_CAPABILITIES = [
  'task.execute',
  'fs.read',
  'doc.extract',
  'workspace.exec',
] as const;

export type TaskGrantCapability = (typeof TASK_GRANT_CAPABILITIES)[number];

export interface BadgeTokenClaims {
  tokenId: string;
  tenantId: string;
  actorRef: string;
  nodeId?: string;
  scopes: readonly BadgeScope[];
  expiresAt: string;
  grantRef?: string;
  workOrderId?: string;
  issuedToRunId?: string;
  maxUses?: number;
  usedCount?: number;
  /** Explicit registration grant. Omitted means the badge's primary tenant only. */
  authorizedTenantIds?: readonly string[];
}

export type BadgeAuthorizationFailureReason =
  | 'unknown'
  | 'expired'
  | 'revoked'
  | 'scope_denied'
  | 'uses_exhausted';

export type BadgeAuthorizationResult =
  | { ok: true; claims: BadgeTokenClaims }
  | { ok: false; reason: BadgeAuthorizationFailureReason };

export interface BadgeAuthorizationInput {
  token: string;
  scope: BadgeScope;
  now: string;
}

/**
 * Authentication and use accounting are one operation so concurrent requests
 * cannot both pass the final maxUses check. Implementations must not log or
 * persist `input.token`.
 */
export interface BadgeTokenAuthenticator {
  authorize(input: BadgeAuthorizationInput): Promise<BadgeAuthorizationResult>;
}

export interface StaticBadgeToken extends BadgeTokenClaims {
  token: string;
}

export interface CapabilityGrantAuthority {
  authorityRef: string;
  tenantId: string;
  capabilities: readonly string[];
  paths: readonly string[];
  expiresAt: string;
  maxUses: number;
  nodeId?: string;
  workOrderId?: string;
  issuedToRunId?: string;
}

export type IssueCapabilityGrantInput = Omit<
  CapabilityGrant,
  'schema' | 'version' | 'capabilities' | 'paths' | 'usedCount' | 'revokedAt'
> & {
  capabilities: readonly string[];
  paths: readonly string[];
};

export interface RotateCapabilityGrantInput extends IssueCapabilityGrantInput {}

export type CapabilityGrantStatus = 'active' | 'expired' | 'revoked' | 'rotated' | 'exhausted';

/** Safe to persist, log, export, and place in evidence. It never contains the bearer token. */
export interface CapabilityGrantRecord extends IssueCapabilityGrantInput {
  tokenRef: string;
  issuedAt: string;
  issuedByAuthorityRef: string;
  usedCount: number;
  status: CapabilityGrantStatus;
  revokedAt?: string;
  rotatedFromGrantRef?: string;
  rotatedToGrantRef?: string;
}

export interface IssuedCapabilityGrant {
  /** Returned once to the provisioning caller. Never persist, log, or serialize this wrapper. */
  token: string;
  grant: CapabilityGrantRecord;
}

export type CapabilityGrantErrorCode =
  | 'invalid_grant'
  | 'duplicate_grant'
  | 'grant_not_found'
  | 'authority_expired'
  | 'authority_scope_exceeded'
  | 'grant_expired'
  | 'grant_revoked'
  | 'grant_exhausted';

export class CapabilityGrantError extends Error {
  constructor(
    readonly code: CapabilityGrantErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CapabilityGrantError';
  }
}

export interface PersistedCapabilityGrant extends CapabilityGrantRecord {
  /** SHA-256 of a high-entropy opaque token. The plaintext token is never retained. */
  tokenDigest: string;
}

type StoredCapabilityGrant = PersistedCapabilityGrant;

export interface CapabilityGrantRegistryOptions {
  now?: () => Date;
  tokenFactory?: () => string;
  /** Required when restoring records; every record must belong to this tenant. */
  initialTenantId?: string;
  initialRecords?: readonly PersistedCapabilityGrant[];
}

export interface TaskGrantAuthorizationInput {
  token: string;
  grantRef: string;
  tenantId: string;
  workOrderId: string;
  nodeId: string;
  issuedToRunId: string;
  capabilities: readonly string[];
  paths: readonly string[];
  maxUses: 1;
  now: string;
}

export interface TaskGrantAuthorizationClaims {
  grantRef: string;
  tenantId: string;
  workOrderId: string;
  nodeId: string;
  issuedToRunId: string;
  capabilities: readonly string[];
  paths: readonly string[];
  expiresAt: string;
  maxUses: number;
  usedCount: number;
}

export type TaskGrantAuthorizationResult =
  | { ok: true; claims: TaskGrantAuthorizationClaims }
  | { ok: false; reason: 'unknown' | 'expired' | 'revoked' | 'uses_exhausted' | 'scope_denied' | 'binding_mismatch' | 'not_consumed' };

export interface TaskGrantAuthenticator {
  consume(input: TaskGrantAuthorizationInput): Promise<TaskGrantAuthorizationResult>;
  checkpoint(input: TaskGrantAuthorizationInput): Promise<TaskGrantAuthorizationResult>;
}

const allowedBadgeScopes = new Set<string>(BADGE_SCOPES);
const allowedGrantCapabilities = new Set<string>([...BADGE_SCOPES, ...TASK_GRANT_CAPABILITIES]);
function isBadgeScope(value: string): value is BadgeScope { return allowedBadgeScopes.has(value); }
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const persistedGrantFields = new Set([
  'grantId', 'tenantId', 'workOrderId', 'nodeId', 'capabilities', 'paths', 'expiresAt',
  'maxUses', 'usedCount', 'issuedToRunId', 'tokenRef', 'issuedAt', 'issuedByAuthorityRef',
  'status', 'revokedAt', 'rotatedFromGrantRef', 'rotatedToGrantRef', 'tokenDigest',
]);

function fingerprint(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function tenantGrantKey(tenantId: string, grantId: string): string {
  return `${tenantId}\0${grantId}`;
}

function canonicalTimestamp(value: string, field: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new CapabilityGrantError('invalid_grant', `${field} must be an ISO timestamp`);
  return new Date(timestamp).toISOString();
}

function cloneClaims(claims: BadgeTokenClaims): BadgeTokenClaims {
  return {
    ...claims,
    scopes: [...claims.scopes],
    ...(claims.authorizedTenantIds ? { authorizedTenantIds: [...claims.authorizedTenantIds] } : {}),
  };
}

function cloneGrant(grant: CapabilityGrantRecord): CapabilityGrantRecord {
  return { ...grant, capabilities: [...grant.capabilities], paths: [...grant.paths] };
}

function publicGrant(grant: StoredCapabilityGrant, now: string): CapabilityGrantRecord {
  const { tokenDigest: _tokenDigest, ...record } = grant;
  if (record.status === 'active' && Date.parse(record.expiresAt) <= Date.parse(now)) {
    return cloneGrant({ ...record, status: 'expired' });
  }
  return cloneGrant(record);
}

function validateScopes(scopes: readonly string[], field: string): void {
  if (scopes.length === 0 || scopes.some((scope) => !allowedGrantCapabilities.has(scope))) {
    throw new CapabilityGrantError('invalid_grant', `${field} contains an unsupported or empty capability set`);
  }
  if (new Set(scopes).size !== scopes.length) {
    throw new CapabilityGrantError('invalid_grant', `${field} contains duplicate capabilities`);
  }
}

function validatePaths(paths: readonly string[]): void {
  if (new Set(paths).size !== paths.length || paths.some((path) => !path.trim() || path.includes('\0'))) {
    throw new CapabilityGrantError('invalid_grant', 'grant paths must be unique non-empty strings');
  }
}

function validateSharedGrant(input: IssueCapabilityGrantInput, usedCount: number, revokedAt?: string): void {
  const result = validateFleetContract('CapabilityGrant', {
    schema: 'hummer.capability-grant',
    version: 1,
    grantId: input.grantId,
    tenantId: input.tenantId,
    workOrderId: input.workOrderId,
    nodeId: input.nodeId,
    capabilities: [...input.capabilities],
    paths: [...input.paths],
    expiresAt: input.expiresAt,
    maxUses: input.maxUses,
    usedCount,
    ...(revokedAt ? { revokedAt } : {}),
    issuedToRunId: input.issuedToRunId,
  });
  if (result.issues) {
    throw new CapabilityGrantError('invalid_grant', `capability grant violates the shared contract: ${result.issues[0]?.message ?? 'invalid'}`);
  }
}

function assertSubset(child: readonly string[], parent: readonly string[], message: string): void {
  const allowed = new Set(parent);
  if (child.some((value) => !allowed.has(value))) {
    throw new CapabilityGrantError('authority_scope_exceeded', message);
  }
}

function validateStaticBadge(input: StaticBadgeToken): void {
  if (!input.token || !input.tokenId || !input.tenantId || !input.actorRef) {
    throw new Error('badge token, tokenId, tenantId and actorRef are required');
  }
  if (!Number.isFinite(Date.parse(input.expiresAt))) throw new Error('badge expiry must be an ISO timestamp');
  if (input.scopes.length === 0 || input.scopes.some((scope) => !allowedBadgeScopes.has(scope))) {
    throw new Error('badge contains an unsupported or empty scope set');
  }
  if (input.nodeId !== undefined && !input.nodeId.trim()) throw new Error('badge nodeId cannot be empty');
  if (input.authorizedTenantIds !== undefined
    && (input.authorizedTenantIds.length === 0
      || input.authorizedTenantIds.some((tenantId) => !tenantId.trim())
      || new Set(input.authorizedTenantIds).size !== input.authorizedTenantIds.length
      || !input.authorizedTenantIds.includes(input.tenantId)
      || (input.authorizedTenantIds.length > 1 && !input.grantRef?.trim()))) {
    throw new Error('badge authorized tenant set is invalid');
  }
}

/**
 * Test/development-only opaque-token registry for Phase 0. This is a static
 * substitute for an identity issuer, not production authentication. Only
 * SHA-256 fingerprints are retained; plaintext badge tokens stay with the
 * caller that provisions them.
 */
export function createStaticBadgeTokenAuthenticator(tokens: readonly StaticBadgeToken[]): BadgeTokenAuthenticator {
  const entries = new Map<string, BadgeTokenClaims>();
  for (const { token, ...claims } of tokens) {
    validateStaticBadge({ token, ...claims });
    const key = fingerprint(token);
    if (entries.has(key)) throw new Error('duplicate badge token');
    entries.set(key, cloneClaims(claims));
  }

  return {
    async authorize(input) {
      const claims = entries.get(fingerprint(input.token));
      if (!claims) return { ok: false, reason: 'unknown' };
      if (Date.parse(claims.expiresAt) <= Date.parse(input.now)) return { ok: false, reason: 'expired' };
      if (!claims.scopes.includes(input.scope)) return { ok: false, reason: 'scope_denied' };
      return { ok: true, claims: cloneClaims(claims) };
    },
  };
}

/**
 * Relay-local issuer and revocation source for task-scoped capability grants.
 * The only token-derived value retained is a SHA-256 digest of a 256-bit
 * random opaque token. All mutation methods return redaction-safe records.
 */
export class CapabilityGrantRegistry implements BadgeTokenAuthenticator {
  readonly #byTenantGrant = new Map<string, StoredCapabilityGrant>();
  readonly #grantKeyByDigest = new Map<string, string>();
  readonly #now: () => Date;
  readonly #tokenFactory: () => string;

  constructor(options: CapabilityGrantRegistryOptions = {}) {
    this.#now = options.now ?? (() => new Date());
    this.#tokenFactory = options.tokenFactory ?? (() => `hgr_${randomBytes(32).toString('base64url')}`);
    const initialRecords = options.initialRecords ?? [];
    if (initialRecords.length > 0 && (!options.initialTenantId || !idPattern.test(options.initialTenantId))) {
      throw new CapabilityGrantError('invalid_grant', 'persisted capability grant tenant is required');
    }
    for (const record of initialRecords) this.restore(options.initialTenantId!, record);
  }

  issue(authority: CapabilityGrantAuthority, input: IssueCapabilityGrantInput): IssuedCapabilityGrant {
    const now = this.#now().toISOString();
    const prepared = this.prepareGrant(authority, input, now);
    return this.insertPrepared(prepared, this.#tokenFactory());
  }

  rotate(tenantId: string, grantId: string, input: RotateCapabilityGrantInput): IssuedCapabilityGrant {
    const now = this.#now().toISOString();
    const current = this.#byTenantGrant.get(tenantGrantKey(tenantId, grantId));
    if (!current) throw new CapabilityGrantError('grant_not_found', 'capability grant was not found');
    this.assertActive(current, now);
    const remainingUses = current.maxUses - current.usedCount;
    const authority: CapabilityGrantAuthority = {
      authorityRef: current.tokenRef,
      tenantId: current.tenantId,
      capabilities: current.capabilities,
      paths: current.paths,
      expiresAt: current.expiresAt,
      maxUses: remainingUses,
      nodeId: current.nodeId,
      workOrderId: current.workOrderId,
      issuedToRunId: current.issuedToRunId,
    };
    const prepared = this.prepareGrant(authority, input, now, current.tokenRef);
    const replacement = this.insertPrepared(prepared, this.#tokenFactory());
    current.status = 'rotated';
    current.revokedAt = now;
    current.rotatedToGrantRef = replacement.grant.tokenRef;
    return replacement;
  }

  revoke(tenantId: string, grantId: string): CapabilityGrantRecord {
    const now = this.#now().toISOString();
    const grant = this.#byTenantGrant.get(tenantGrantKey(tenantId, grantId));
    if (!grant) throw new CapabilityGrantError('grant_not_found', 'capability grant was not found');
    if (grant.status === 'rotated' || grant.status === 'revoked') return publicGrant(grant, now);
    if (Date.parse(grant.expiresAt) <= Date.parse(now)) {
      grant.status = 'expired';
      return publicGrant(grant, now);
    }
    grant.status = 'revoked';
    grant.revokedAt = now;
    return publicGrant(grant, now);
  }

  get(tenantId: string, grantId: string): CapabilityGrantRecord | null {
    const grant = this.#byTenantGrant.get(tenantGrantKey(tenantId, grantId));
    return grant ? publicGrant(grant, this.#now().toISOString()) : null;
  }

  list(tenantId: string): readonly CapabilityGrantRecord[] {
    const now = this.#now().toISOString();
    return [...this.#byTenantGrant.values()]
      .filter((grant) => grant.tenantId === tenantId)
      .map((grant) => publicGrant(grant, now));
  }

  /**
   * Durable-state boundary. Persist this snapshot, never an IssuedCapabilityGrant.
   * SHA-256 digests are safe here because issued bearer tokens carry 256 bits of entropy.
   */
  snapshot(tenantId: string): readonly PersistedCapabilityGrant[] {
    return [...this.#byTenantGrant.values()]
      .filter((grant) => grant.tenantId === tenantId)
      .map((grant) => ({
        ...publicGrant(grant, this.#now().toISOString()),
        tokenDigest: grant.tokenDigest,
      }));
  }

  async authorize(input: BadgeAuthorizationInput): Promise<BadgeAuthorizationResult> {
    const grantKey = this.#grantKeyByDigest.get(fingerprint(input.token));
    if (!grantKey) return { ok: false, reason: 'unknown' };
    const grant = this.#byTenantGrant.get(grantKey);
    if (!grant) return { ok: false, reason: 'unknown' };
    const now = canonicalTimestamp(input.now, 'authorization time');
    if (grant.status === 'revoked' || grant.status === 'rotated') return { ok: false, reason: 'revoked' };
    if (Date.parse(grant.expiresAt) <= Date.parse(now)) {
      grant.status = 'expired';
      return { ok: false, reason: 'expired' };
    }
    if (grant.usedCount >= grant.maxUses || grant.status === 'exhausted') {
      grant.status = 'exhausted';
      return { ok: false, reason: 'uses_exhausted' };
    }
    if (!grant.capabilities.includes(input.scope)) return { ok: false, reason: 'scope_denied' };

    grant.usedCount += 1;
    if (grant.usedCount >= grant.maxUses) grant.status = 'exhausted';
    return {
      ok: true,
      claims: {
        tokenId: grant.tokenRef,
        grantRef: grant.tokenRef,
        tenantId: grant.tenantId,
        authorizedTenantIds: [grant.tenantId],
        actorRef: `system:${grant.nodeId}`,
        nodeId: grant.nodeId,
        scopes: grant.capabilities.filter(isBadgeScope),
        expiresAt: grant.expiresAt,
        workOrderId: grant.workOrderId,
        issuedToRunId: grant.issuedToRunId,
        maxUses: grant.maxUses,
        usedCount: grant.usedCount,
      },
    };
  }

  async consume(input: TaskGrantAuthorizationInput): Promise<TaskGrantAuthorizationResult> {
    return this.authorizeTaskGrant(input, true);
  }

  async checkpoint(input: TaskGrantAuthorizationInput): Promise<TaskGrantAuthorizationResult> {
    return this.authorizeTaskGrant(input, false);
  }

  private authorizeTaskGrant(
    input: TaskGrantAuthorizationInput,
    consume: boolean,
  ): TaskGrantAuthorizationResult {
    const grantKey = this.#grantKeyByDigest.get(fingerprint(input.token));
    if (!grantKey) return { ok: false, reason: 'unknown' };
    const grant = this.#byTenantGrant.get(grantKey);
    if (!grant) return { ok: false, reason: 'unknown' };
    let now: string;
    try {
      now = canonicalTimestamp(input.now, 'authorization time');
    } catch {
      return { ok: false, reason: 'unknown' };
    }
    if (grant.status === 'revoked' || grant.status === 'rotated') return { ok: false, reason: 'revoked' };
    if (Date.parse(grant.expiresAt) <= Date.parse(now)) {
      grant.status = 'expired';
      return { ok: false, reason: 'expired' };
    }
    if (grant.tokenRef !== input.grantRef
      || grant.tenantId !== input.tenantId
      || grant.workOrderId !== input.workOrderId
      || grant.nodeId !== input.nodeId
      || grant.issuedToRunId !== input.issuedToRunId
      || grant.maxUses !== input.maxUses) {
      return { ok: false, reason: 'binding_mismatch' };
    }
    if (input.capabilities.length === 0
      || input.capabilities.some((capability) => !grant.capabilities.includes(capability))
      || input.paths.some((path) => !grant.paths.includes(path))) {
      return { ok: false, reason: 'scope_denied' };
    }
    if (consume) {
      if (grant.usedCount >= grant.maxUses || grant.status === 'exhausted') {
        grant.status = 'exhausted';
        return { ok: false, reason: 'uses_exhausted' };
      }
      grant.usedCount += 1;
      if (grant.usedCount >= grant.maxUses) grant.status = 'exhausted';
    } else if (grant.usedCount === 0) {
      return { ok: false, reason: 'not_consumed' };
    }
    return {
      ok: true,
      claims: {
        grantRef: grant.tokenRef,
        tenantId: grant.tenantId,
        workOrderId: grant.workOrderId,
        nodeId: grant.nodeId,
        issuedToRunId: grant.issuedToRunId,
        capabilities: [...input.capabilities],
        paths: [...input.paths],
        expiresAt: grant.expiresAt,
        maxUses: grant.maxUses,
        usedCount: grant.usedCount,
      },
    };
  }

  private prepareGrant(
    authority: CapabilityGrantAuthority,
    input: IssueCapabilityGrantInput,
    now: string,
    rotatedFromGrantRef?: string,
  ): Omit<StoredCapabilityGrant, 'tokenDigest'> {
    if (!idPattern.test(input.grantId) || !idPattern.test(input.tenantId)
      || !idPattern.test(input.workOrderId) || !idPattern.test(input.nodeId)
      || !idPattern.test(input.issuedToRunId) || !idPattern.test(authority.authorityRef)) {
      throw new CapabilityGrantError('invalid_grant', 'grant identifiers contain unsupported characters');
    }
    if (this.#byTenantGrant.has(tenantGrantKey(input.tenantId, input.grantId))) {
      throw new CapabilityGrantError('duplicate_grant', 'capability grant id already exists');
    }
    validateScopes(input.capabilities, 'grant');
    validateScopes(authority.capabilities, 'authority');
    validatePaths(input.paths);
    validatePaths(authority.paths);
    if (!Number.isInteger(input.maxUses) || input.maxUses <= 0) {
      throw new CapabilityGrantError('invalid_grant', 'maxUses must be a positive integer');
    }
    if (!Number.isInteger(authority.maxUses) || authority.maxUses <= 0) {
      throw new CapabilityGrantError('invalid_grant', 'authority maxUses must be a positive integer');
    }
    const expiresAt = canonicalTimestamp(input.expiresAt, 'grant expiresAt');
    const authorityExpiresAt = canonicalTimestamp(authority.expiresAt, 'authority expiresAt');
    if (Date.parse(authorityExpiresAt) <= Date.parse(now)) {
      throw new CapabilityGrantError('authority_expired', 'issuing authority has expired');
    }
    if (Date.parse(expiresAt) <= Date.parse(now)) {
      throw new CapabilityGrantError('grant_expired', 'cannot issue an expired capability grant');
    }
    if (input.tenantId !== authority.tenantId
      || (authority.nodeId !== undefined && input.nodeId !== authority.nodeId)
      || (authority.workOrderId !== undefined && input.workOrderId !== authority.workOrderId)
      || (authority.issuedToRunId !== undefined && input.issuedToRunId !== authority.issuedToRunId)
      || Date.parse(expiresAt) > Date.parse(authorityExpiresAt)
      || input.maxUses > authority.maxUses) {
      throw new CapabilityGrantError('authority_scope_exceeded', 'capability grant exceeds its issuing authority');
    }
    assertSubset(input.capabilities, authority.capabilities, 'capability grant widens authority capabilities');
    assertSubset(input.paths, authority.paths, 'capability grant widens authority paths');
    validateSharedGrant({ ...input, expiresAt }, 0);

    return {
      ...input,
      capabilities: [...input.capabilities],
      paths: [...input.paths],
      expiresAt,
      tokenRef: `grant:${input.grantId}`,
      issuedAt: now,
      issuedByAuthorityRef: authority.authorityRef,
      usedCount: 0,
      status: 'active',
      ...(rotatedFromGrantRef ? { rotatedFromGrantRef } : {}),
    };
  }

  private insertPrepared(
    prepared: Omit<StoredCapabilityGrant, 'tokenDigest'>,
    token: string,
  ): IssuedCapabilityGrant {
    if (typeof token !== 'string' || token.length < 32 || /\s/.test(token)) {
      throw new CapabilityGrantError('invalid_grant', 'token factory must return at least 32 non-whitespace characters');
    }
    const tokenDigest = fingerprint(token);
    if (this.#grantKeyByDigest.has(tokenDigest)) {
      throw new CapabilityGrantError('duplicate_grant', 'token factory returned a duplicate opaque token');
    }
    const stored: StoredCapabilityGrant = { ...prepared, tokenDigest };
    const grantKey = tenantGrantKey(stored.tenantId, stored.grantId);
    this.#byTenantGrant.set(grantKey, stored);
    this.#grantKeyByDigest.set(tokenDigest, grantKey);
    const issued = { grant: publicGrant(stored, this.#now().toISOString()) } as IssuedCapabilityGrant;
    Object.defineProperty(issued, 'token', {
      value: token,
      enumerable: false,
      configurable: false,
      writable: false,
    });
    return issued;
  }

  private assertActive(grant: StoredCapabilityGrant, now: string): void {
    if (grant.status === 'revoked' || grant.status === 'rotated') {
      throw new CapabilityGrantError('grant_revoked', 'capability grant is no longer active');
    }
    if (Date.parse(grant.expiresAt) <= Date.parse(now)) {
      grant.status = 'expired';
      throw new CapabilityGrantError('grant_expired', 'capability grant has expired');
    }
    if (grant.usedCount >= grant.maxUses || grant.status === 'exhausted') {
      grant.status = 'exhausted';
      throw new CapabilityGrantError('grant_exhausted', 'capability grant has no remaining uses');
    }
  }

  private restore(initialTenantId: string, input: PersistedCapabilityGrant): void {
    const keys = Object.keys(input as unknown as Record<string, unknown>);
    if (keys.some((key) => !persistedGrantFields.has(key))) {
      throw new CapabilityGrantError('invalid_grant', 'persisted capability grant contains unknown fields');
    }
    if (!idPattern.test(input.grantId) || !idPattern.test(input.tenantId)
      || input.tenantId !== initialTenantId
      || !idPattern.test(input.workOrderId) || !idPattern.test(input.nodeId)
      || !idPattern.test(input.issuedToRunId) || !idPattern.test(input.issuedByAuthorityRef)
      || input.tokenRef !== `grant:${input.grantId}`
      || !/^[a-f0-9]{64}$/.test(input.tokenDigest)) {
      throw new CapabilityGrantError('invalid_grant', 'persisted capability grant identifiers or digest are invalid');
    }
    validateScopes(input.capabilities, 'persisted grant');
    validatePaths(input.paths);
    canonicalTimestamp(input.issuedAt, 'persisted issuedAt');
    canonicalTimestamp(input.expiresAt, 'persisted expiresAt');
    if (!Number.isInteger(input.maxUses) || input.maxUses <= 0
      || !Number.isInteger(input.usedCount) || input.usedCount < 0 || input.usedCount > input.maxUses
      || !['active', 'expired', 'revoked', 'rotated', 'exhausted'].includes(input.status)
      || (input.status === 'active' && input.usedCount >= input.maxUses)
      || (input.status === 'exhausted' && input.usedCount !== input.maxUses)
      || ((input.status === 'revoked' || input.status === 'rotated') && !input.revokedAt)) {
      throw new CapabilityGrantError('invalid_grant', 'persisted capability grant state is inconsistent');
    }
    if (input.revokedAt) canonicalTimestamp(input.revokedAt, 'persisted revokedAt');
    validateSharedGrant(input, input.usedCount, input.revokedAt);
    const grantKey = tenantGrantKey(input.tenantId, input.grantId);
    if (this.#byTenantGrant.has(grantKey) || this.#grantKeyByDigest.has(input.tokenDigest)) {
      throw new CapabilityGrantError('duplicate_grant', 'persisted capability grant is duplicated');
    }
    const stored: StoredCapabilityGrant = {
      ...input,
      capabilities: [...input.capabilities],
      paths: [...input.paths],
    };
    this.#byTenantGrant.set(grantKey, stored);
    this.#grantKeyByDigest.set(stored.tokenDigest, grantKey);
  }
}
