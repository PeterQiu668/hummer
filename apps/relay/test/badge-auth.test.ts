import { describe, expect, it } from 'vitest';
import {
  CapabilityGrantError,
  CapabilityGrantRegistry,
  type BadgeScope,
  type CapabilityGrantAuthority,
  type IssueCapabilityGrantInput,
} from '../src/badge-auth.js';

const NOW = '2026-10-07T00:00:00.000Z';
const TOKEN_A = `hgr_${'a'.repeat(43)}`;
const TOKEN_B = `hgr_${'b'.repeat(43)}`;

const authority = (overrides: Partial<CapabilityGrantAuthority> = {}): CapabilityGrantAuthority => ({
  authorityRef: 'authority:human-operator',
  tenantId: 'tenant-a',
  capabilities: ['node.register', 'node.heartbeat', 'task.claim', 'task.event'],
  paths: ['outputs/report.md', 'outputs/summary.json'],
  expiresAt: '2026-10-07T02:00:00.000Z',
  maxUses: 8,
  nodeId: 'node-main',
  workOrderId: 'work-1',
  issuedToRunId: 'run-1',
  ...overrides,
});

const grant = (overrides: Partial<IssueCapabilityGrantInput> = {}): IssueCapabilityGrantInput => ({
  grantId: 'grant-1',
  tenantId: 'tenant-a',
  workOrderId: 'work-1',
  nodeId: 'node-main',
  capabilities: ['node.register', 'node.heartbeat'],
  paths: ['outputs/report.md'],
  expiresAt: '2026-10-07T01:00:00.000Z',
  maxUses: 3,
  issuedToRunId: 'run-1',
  ...overrides,
});

function sequenceTokens(...tokens: string[]): () => string {
  let offset = 0;
  return () => tokens[offset++] ?? `hgr_${String(offset).padStart(43, 'x')}`;
}

async function authorize(
  registry: CapabilityGrantRegistry,
  token: string,
  scope: BadgeScope,
  now = NOW,
) {
  return registry.authorize({ token, scope, now });
}

describe('CapabilityGrantRegistry', () => {
  it('issues a least-privilege grant and returns plaintext only in the one-time wrapper', async () => {
    const registry = new CapabilityGrantRegistry({ now: () => new Date(NOW), tokenFactory: () => TOKEN_A });
    const issued = registry.issue(authority(), grant());

    expect(issued.token).toBe(TOKEN_A);
    expect(JSON.stringify(issued)).not.toContain(TOKEN_A);
    expect(Object.keys(issued)).toEqual(['grant']);
    expect(issued.grant).toMatchObject({
      grantId: 'grant-1', tokenRef: 'grant:grant-1', tenantId: 'tenant-a',
      capabilities: ['node.register', 'node.heartbeat'], paths: ['outputs/report.md'],
      maxUses: 3, usedCount: 0, status: 'active',
    });
    const persistedView = JSON.stringify(registry.list('tenant-a'));
    expect(persistedView).not.toContain(TOKEN_A);
    expect(persistedView).not.toContain('tokenDigest');

    const result = await authorize(registry, TOKEN_A, 'node.register');
    expect(result).toMatchObject({
      ok: true,
      claims: {
        tokenId: 'grant:grant-1', grantRef: 'grant:grant-1', tenantId: 'tenant-a',
        nodeId: 'node-main', workOrderId: 'work-1', issuedToRunId: 'run-1',
        maxUses: 3, usedCount: 1,
      },
    });
    expect(registry.get('tenant-a', 'grant-1')).toMatchObject({ usedCount: 1, status: 'active' });
  });

  it('does not spend a use when the requested capability is outside the grant', async () => {
    const registry = new CapabilityGrantRegistry({ now: () => new Date(NOW), tokenFactory: () => TOKEN_A });
    registry.issue(authority(), grant({ maxUses: 1 }));

    expect(await authorize(registry, TOKEN_A, 'task.claim')).toEqual({ ok: false, reason: 'scope_denied' });
    expect(registry.get('tenant-a', 'grant-1')).toMatchObject({ usedCount: 0, status: 'active' });
    expect((await authorize(registry, TOKEN_A, 'node.register')).ok).toBe(true);
    expect(registry.get('tenant-a', 'grant-1')).toMatchObject({ usedCount: 1, status: 'exhausted' });
  });

  it('enforces maxUses exactly and fails closed after exhaustion', async () => {
    const registry = new CapabilityGrantRegistry({ now: () => new Date(NOW), tokenFactory: () => TOKEN_A });
    registry.issue(authority(), grant({ capabilities: ['task.claim'], maxUses: 2 }));

    expect((await authorize(registry, TOKEN_A, 'task.claim')).ok).toBe(true);
    expect((await authorize(registry, TOKEN_A, 'task.claim')).ok).toBe(true);
    expect(await authorize(registry, TOKEN_A, 'task.claim')).toEqual({ ok: false, reason: 'uses_exhausted' });
    expect(registry.get('tenant-a', 'grant-1')).toMatchObject({ usedCount: 2, maxUses: 2, status: 'exhausted' });
  });

  it('expires at the exact boundary without spending another use', async () => {
    const registry = new CapabilityGrantRegistry({ now: () => new Date(NOW), tokenFactory: () => TOKEN_A });
    registry.issue(authority(), grant({ expiresAt: '2026-10-07T00:00:01.000Z' }));

    expect(await authorize(registry, TOKEN_A, 'node.register', '2026-10-07T00:00:01.000Z'))
      .toEqual({ ok: false, reason: 'expired' });
    expect(registry.get('tenant-a', 'grant-1')).toMatchObject({ usedCount: 0, status: 'expired' });
  });

  it('revokes immediately and never returns the plaintext in the revocation record', async () => {
    const registry = new CapabilityGrantRegistry({ now: () => new Date(NOW), tokenFactory: () => TOKEN_A });
    registry.issue(authority(), grant());

    const revoked = registry.revoke('tenant-a', 'grant-1');
    expect(revoked).toMatchObject({ status: 'revoked', revokedAt: NOW, tokenRef: 'grant:grant-1' });
    expect(JSON.stringify(revoked)).not.toContain(TOKEN_A);
    expect(await authorize(registry, TOKEN_A, 'node.register')).toEqual({ ok: false, reason: 'revoked' });
  });

  it('rotates to a narrower replacement, revokes the old token, and preserves remaining-use budget', async () => {
    const registry = new CapabilityGrantRegistry({
      now: () => new Date(NOW), tokenFactory: sequenceTokens(TOKEN_A, TOKEN_B),
    });
    registry.issue(authority(), grant({ maxUses: 3 }));
    expect((await authorize(registry, TOKEN_A, 'node.register')).ok).toBe(true);

    const rotated = registry.rotate('tenant-a', 'grant-1', grant({
      grantId: 'grant-2', capabilities: ['node.heartbeat'], expiresAt: '2026-10-07T00:30:00.000Z', maxUses: 2,
    }));
    expect(rotated.token).toBe(TOKEN_B);
    expect(rotated.grant).toMatchObject({
      tokenRef: 'grant:grant-2', rotatedFromGrantRef: 'grant:grant-1', usedCount: 0, maxUses: 2,
    });
    expect(registry.get('tenant-a', 'grant-1')).toMatchObject({
      status: 'rotated', revokedAt: NOW, rotatedToGrantRef: 'grant:grant-2', usedCount: 1,
    });
    expect(await authorize(registry, TOKEN_A, 'node.register')).toEqual({ ok: false, reason: 'revoked' });
    expect((await authorize(registry, TOKEN_B, 'node.heartbeat')).ok).toBe(true);
    expect(await authorize(registry, TOKEN_B, 'node.register')).toEqual({ ok: false, reason: 'scope_denied' });
  });

  it.each([
    ['tenant', grant({ tenantId: 'tenant-b' })],
    ['node', grant({ nodeId: 'node-b' })],
    ['work order', grant({ workOrderId: 'work-2' })],
    ['run', grant({ issuedToRunId: 'run-2' })],
    ['capability', grant({ capabilities: ['task.stop'] })],
    ['path', grant({ paths: ['secrets.txt'] })],
    ['expiry', grant({ expiresAt: '2026-10-07T03:00:00.000Z' })],
    ['use budget', grant({ maxUses: 9 })],
  ])('rejects a grant that widens the authority %s boundary', (_label, input) => {
    const registry = new CapabilityGrantRegistry({ now: () => new Date(NOW), tokenFactory: () => TOKEN_A });
    expect(() => registry.issue(authority(), input)).toThrowError(
      expect.objectContaining({ code: 'authority_scope_exceeded' }),
    );
    expect(registry.list('tenant-a')).toEqual([]);
  });

  it('rejects expired authorities, expired grants, invalid maxUses, and unknown capabilities', () => {
    const registry = new CapabilityGrantRegistry({ now: () => new Date(NOW), tokenFactory: () => TOKEN_A });
    expect(() => registry.issue(authority({ expiresAt: NOW }), grant()))
      .toThrowError(expect.objectContaining({ code: 'authority_expired' }));
    expect(() => registry.issue(authority(), grant({ expiresAt: NOW })))
      .toThrowError(expect.objectContaining({ code: 'grant_expired' }));
    expect(() => registry.issue(authority(), grant({ maxUses: 0 })))
      .toThrowError(expect.objectContaining({ code: 'invalid_grant' }));
    expect(() => registry.issue(authority(), grant({ capabilities: ['workspace.admin' as BadgeScope] })))
      .toThrowError(expect.objectContaining({ code: 'invalid_grant' }));
  });

  it.each(['../secret.txt', 'C:/secret.txt', '/etc/passwd', 'outputs\\secret.txt'])(
    'rejects unsafe workspace path %s through the shared CapabilityGrant contract',
    (path) => {
      const registry = new CapabilityGrantRegistry({ now: () => new Date(NOW), tokenFactory: () => TOKEN_A });
      expect(() => registry.issue(authority({ paths: [path] }), grant({ paths: [path] })))
        .toThrowError(expect.objectContaining({ code: 'invalid_grant' }));
      expect(registry.list('tenant-a')).toEqual([]);
    },
  );

  it('fails closed for unknown tokens and never reflects token material in errors', async () => {
    const registry = new CapabilityGrantRegistry({ now: () => new Date(NOW), tokenFactory: () => TOKEN_A });
    const unknown = `hgr_${'z'.repeat(43)}`;
    expect(await authorize(registry, unknown, 'task.claim')).toEqual({ ok: false, reason: 'unknown' });
    try {
      registry.revoke('tenant-a', 'missing-grant');
      throw new Error('expected revoke to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(CapabilityGrantError);
      expect(String(error)).not.toContain(unknown);
      expect(String(error)).not.toContain(TOKEN_A);
    }
  });

  it('rejects duplicate grant ids and duplicate opaque tokens without changing the first grant', () => {
    const registry = new CapabilityGrantRegistry({
      now: () => new Date(NOW), tokenFactory: () => TOKEN_A,
    });
    registry.issue(authority(), grant());
    expect(() => registry.issue(authority(), grant())).toThrowError(
      expect.objectContaining({ code: 'duplicate_grant' }),
    );
    expect(() => registry.issue(authority({ workOrderId: 'work-2', issuedToRunId: 'run-2' }), grant({
      grantId: 'grant-2', workOrderId: 'work-2', issuedToRunId: 'run-2',
    }))).toThrowError(expect.objectContaining({ code: 'duplicate_grant' }));
    expect(registry.list('tenant-a')).toHaveLength(1);
  });

  it('refuses rotation that exceeds the source remaining uses and leaves the source active', async () => {
    const registry = new CapabilityGrantRegistry({
      now: () => new Date(NOW), tokenFactory: sequenceTokens(TOKEN_A, TOKEN_B),
    });
    registry.issue(authority(), grant({ capabilities: ['task.claim'], maxUses: 2 }));
    expect((await authorize(registry, TOKEN_A, 'task.claim')).ok).toBe(true);

    expect(() => registry.rotate('tenant-a', 'grant-1', grant({
      grantId: 'grant-2', capabilities: ['task.claim'], maxUses: 2,
    }))).toThrowError(expect.objectContaining({ code: 'authority_scope_exceeded' }));
    expect(registry.get('tenant-a', 'grant-1')).toMatchObject({ status: 'active', usedCount: 1 });
    expect(registry.get('tenant-a', 'grant-2')).toBeNull();
  });

  it('restores usedCount and revocation from a digest-only persistence snapshot', async () => {
    const first = new CapabilityGrantRegistry({ now: () => new Date(NOW), tokenFactory: () => TOKEN_A });
    first.issue(authority(), grant({ capabilities: ['task.claim'], maxUses: 2 }));
    expect((await authorize(first, TOKEN_A, 'task.claim')).ok).toBe(true);
    const snapshot = first.snapshot('tenant-a');
    expect(JSON.stringify(snapshot)).not.toContain(TOKEN_A);
    expect(snapshot[0]?.tokenDigest).toMatch(/^[a-f0-9]{64}$/);

    const resumed = new CapabilityGrantRegistry({
      now: () => new Date(NOW), initialTenantId: 'tenant-a', initialRecords: snapshot,
    });
    expect(resumed.get('tenant-a', 'grant-1')).toMatchObject({ usedCount: 1, status: 'active' });
    expect((await authorize(resumed, TOKEN_A, 'task.claim')).ok).toBe(true);
    expect(await authorize(resumed, TOKEN_A, 'task.claim')).toEqual({ ok: false, reason: 'uses_exhausted' });

    const revokedSnapshot = resumed.snapshot('tenant-a');
    const exhausted = new CapabilityGrantRegistry({
      now: () => new Date(NOW), initialTenantId: 'tenant-a', initialRecords: revokedSnapshot,
    });
    expect(await authorize(exhausted, TOKEN_A, 'task.claim')).toEqual({ ok: false, reason: 'uses_exhausted' });
  });

  it('fails closed on unknown or inconsistent persisted grant state', () => {
    const registry = new CapabilityGrantRegistry({ now: () => new Date(NOW), tokenFactory: () => TOKEN_A });
    registry.issue(authority(), grant());
    const [snapshot] = registry.snapshot('tenant-a');
    expect(snapshot).toBeDefined();

    expect(() => new CapabilityGrantRegistry({
      initialTenantId: 'tenant-a',
      initialRecords: [{ ...snapshot!, autoApprove: true } as typeof snapshot & { autoApprove: boolean }],
    })).toThrowError(expect.objectContaining({ code: 'invalid_grant' }));
    expect(() => new CapabilityGrantRegistry({
      initialTenantId: 'tenant-a',
      initialRecords: [{ ...snapshot!, usedCount: snapshot!.maxUses, status: 'active' }],
    })).toThrowError(expect.objectContaining({ code: 'invalid_grant' }));
    expect(() => new CapabilityGrantRegistry({
      initialTenantId: 'tenant-a',
      initialRecords: [{ ...snapshot!, tokenDigest: TOKEN_A }],
    })).toThrowError(expect.objectContaining({ code: 'invalid_grant' }));
  });
});
