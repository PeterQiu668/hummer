import { createHash } from 'node:crypto';

export const BADGE_SCOPES = [
  'node.register',
  'node.heartbeat',
  'task.enqueue',
  'task.claim',
  'task.event',
  'task.stop',
  'stream.connect',
] as const;

export type BadgeScope = (typeof BADGE_SCOPES)[number];

export interface BadgeTokenClaims {
  tokenId: string;
  tenantId: string;
  actorRef: string;
  nodeId?: string;
  scopes: readonly BadgeScope[];
  expiresAt: string;
}

export interface BadgeTokenAuthenticator {
  authenticate(token: string): Promise<BadgeTokenClaims | null>;
}

export interface StaticBadgeToken extends BadgeTokenClaims {
  token: string;
}

const allowedScopes = new Set<string>(BADGE_SCOPES);

function fingerprint(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function cloneClaims(claims: BadgeTokenClaims): BadgeTokenClaims {
  return { ...claims, scopes: [...claims.scopes] };
}

function validateStaticBadge(input: StaticBadgeToken): void {
  if (!input.token || !input.tokenId || !input.tenantId || !input.actorRef) {
    throw new Error('badge token, tokenId, tenantId and actorRef are required');
  }
  if (!Number.isFinite(Date.parse(input.expiresAt))) throw new Error('badge expiry must be an ISO timestamp');
  if (input.scopes.length === 0 || input.scopes.some((scope) => !allowedScopes.has(scope))) {
    throw new Error('badge contains an unsupported or empty scope set');
  }
  if (input.nodeId !== undefined && !input.nodeId.trim()) throw new Error('badge nodeId cannot be empty');
}

/**
 * Minimal opaque-token registry for Phase 0. Only SHA-256 fingerprints are
 * retained; plaintext badge tokens stay with the caller that provisions them.
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
    async authenticate(token) {
      const claims = entries.get(fingerprint(token));
      return claims ? cloneClaims(claims) : null;
    },
  };
}
