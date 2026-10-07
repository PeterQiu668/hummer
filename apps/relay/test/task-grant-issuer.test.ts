import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteTaskGrantAuthority } from '../src/sqlite-task-grant-authority.js';
import { DeterministicTaskGrantIssuer } from '../src/task-grant-issuer.js';

const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

const input = {
  grantRef: 'grant:task-1',
  tenantId: 'tenant-a',
  workOrderId: 'work-1',
  nodeId: 'node-a',
  issuedToRunId: 'run-1',
  capabilities: ['task.execute', 'fs.read'],
  paths: ['inputs/report.txt'],
  issuedAt: '2026-10-07T00:00:00.000Z',
  expiresAt: '2099-10-07T01:00:00.000Z',
} as const;

describe('deterministic task grant issuer', () => {
  it('re-derives one token across restarts without resetting durable exhaustion or storing plaintext', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hummer-task-grant-issuer-'));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const databasePath = join(root, 'task-grants.sqlite');
    const secret = 'issuer-secret-that-is-long-enough-0001';

    const firstAuthority = new SqliteTaskGrantAuthority(databasePath);
    cleanup.push(() => firstAuthority.close());
    const firstIssuer = new DeterministicTaskGrantIssuer(secret, firstAuthority);
    const first = firstIssuer.issue(input);
    expect(first).toMatchObject({ grantRef: input.grantRef, expiresAt: input.expiresAt });
    expect(first.token).toMatch(/^hgr_[A-Za-z0-9_-]{43}$/u);
    expect(firstAuthority.snapshot(input.tenantId)).toEqual([
      expect.objectContaining({
        tokenRef: input.grantRef,
        tokenDigest: createHash('sha256').update(first.token, 'utf8').digest('hex'),
        usedCount: 0,
        status: 'active',
      }),
    ]);
    await expect(firstAuthority.consume({
      token: first.token,
      grantRef: input.grantRef,
      tenantId: input.tenantId,
      workOrderId: input.workOrderId,
      nodeId: input.nodeId,
      issuedToRunId: input.issuedToRunId,
      capabilities: [...input.capabilities],
      paths: [...input.paths],
      maxUses: 1,
      now: '2026-10-07T00:01:00.000Z',
    })).resolves.toMatchObject({ ok: true, claims: { usedCount: 1 } });
    firstAuthority.close();

    const secondAuthority = new SqliteTaskGrantAuthority(databasePath);
    cleanup.push(() => secondAuthority.close());
    const second = new DeterministicTaskGrantIssuer(secret, secondAuthority).issue(input);
    expect(second).toEqual(first);
    expect(secondAuthority.snapshot(input.tenantId)[0]).toMatchObject({ usedCount: 1, status: 'exhausted' });
    await expect(secondAuthority.consume({
      token: second.token,
      grantRef: input.grantRef,
      tenantId: input.tenantId,
      workOrderId: input.workOrderId,
      nodeId: input.nodeId,
      issuedToRunId: input.issuedToRunId,
      capabilities: [...input.capabilities],
      paths: [...input.paths],
      maxUses: 1,
      now: '2026-10-07T00:02:00.000Z',
    })).resolves.toEqual({ ok: false, reason: 'uses_exhausted' });

    const databaseBytes = await readFile(databasePath);
    expect(databaseBytes.includes(Buffer.from(first.token))).toBe(false);
    expect(databaseBytes.includes(Buffer.from(secret))).toBe(false);
  });

  it('fails closed when the same grant reference is rebound to different immutable scope', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hummer-task-grant-conflict-'));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const authority = new SqliteTaskGrantAuthority(join(root, 'task-grants.sqlite'));
    cleanup.push(() => authority.close());
    const issuer = new DeterministicTaskGrantIssuer('issuer-secret-that-is-long-enough-0002', authority);
    issuer.issue(input);
    expect(() => issuer.issue({ ...input, paths: ['inputs/other.txt'] })).toThrow(/conflicts with durable state/);
  });
});
