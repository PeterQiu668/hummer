import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CapabilityGrantRegistry, type PersistedCapabilityGrant } from '../src/badge-auth.js';
import {
  loadTaskGrantSnapshot,
  SqliteTaskGrantAuthority,
  SqliteTaskGrantAuthorityError,
  type TaskGrantSnapshotV1,
} from '../src/sqlite-task-grant-authority.js';

const NOW = '2026-10-07T00:00:00.000Z';
const TOKEN = `hgr_${'d'.repeat(43)}`;
const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

function makeSnapshot(overrides: Partial<PersistedCapabilityGrant> = {}): TaskGrantSnapshotV1 {
  const registry = new CapabilityGrantRegistry({ now: () => new Date(NOW), tokenFactory: () => TOKEN });
  registry.issue({
    authorityRef: 'authority:operator', tenantId: 'tenant-a', nodeId: 'node-a',
    workOrderId: 'work-1', issuedToRunId: 'run-1', capabilities: ['task.execute', 'fs.read'],
    paths: ['inputs/report.txt'], expiresAt: '2026-10-07T02:00:00.000Z', maxUses: 1,
  }, {
    grantId: 'task-1', tenantId: 'tenant-a', nodeId: 'node-a',
    workOrderId: 'work-1', issuedToRunId: 'run-1', capabilities: ['task.execute', 'fs.read'],
    paths: ['inputs/report.txt'], expiresAt: '2026-10-07T01:00:00.000Z', maxUses: 1,
  });
  const grant = { ...registry.snapshot('tenant-a')[0]!, ...overrides };
  return { schema: 'hummer.task-grant-snapshot', version: 1, tenantId: 'tenant-a', grants: [grant] };
}

function input(token = TOKEN) {
  return {
    token,
    grantRef: 'grant:task-1',
    tenantId: 'tenant-a',
    workOrderId: 'work-1',
    nodeId: 'node-a',
    issuedToRunId: 'run-1',
    capabilities: ['task.execute', 'fs.read'],
    paths: ['inputs/report.txt'],
    maxUses: 1 as const,
    now: NOW,
  };
}

async function databasePath(): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), 'hummer-task-grant-store-'));
  directories.push(directory);
  return resolve(directory, 'task-grants.sqlite');
}

describe('SQLite task grant authority', () => {
  it('persists one-use consumption and revocation across real process-equivalent reopen', async () => {
    const path = await databasePath();
    let authority = new SqliteTaskGrantAuthority(path, { now: () => new Date(NOW) });
    expect(authority.importSnapshot(makeSnapshot())).toEqual({ tenantId: 'tenant-a', inserted: 1, unchanged: 0 });
    await expect(authority.checkpoint(input())).resolves.toEqual({ ok: false, reason: 'not_consumed' });
    await expect(authority.consume(input())).resolves.toMatchObject({ ok: true, claims: { usedCount: 1, maxUses: 1 } });
    authority.close();

    authority = new SqliteTaskGrantAuthority(path, { now: () => new Date(NOW) });
    await expect(authority.consume(input())).resolves.toEqual({ ok: false, reason: 'uses_exhausted' });
    await expect(authority.checkpoint(input())).resolves.toMatchObject({ ok: true, claims: { usedCount: 1 } });
    expect(authority.importSnapshot(makeSnapshot())).toEqual({ tenantId: 'tenant-a', inserted: 0, unchanged: 1 });
    expect(authority.snapshot('tenant-a')[0]).toMatchObject({ usedCount: 1, status: 'exhausted' });
    authority.revoke('tenant-a', 'task-1', '2026-10-07T00:10:00.000Z');
    authority.close();

    authority = new SqliteTaskGrantAuthority(path, { now: () => new Date(NOW) });
    await expect(authority.checkpoint(input())).resolves.toEqual({ ok: false, reason: 'revoked' });
    expect(authority.snapshot('tenant-a')[0]).toMatchObject({ status: 'revoked', revokedAt: '2026-10-07T00:10:00.000Z' });
    authority.close();
    expect(readFileSync(path).toString('latin1')).not.toContain(TOKEN);
  });

  it('commits exactly one winner under concurrent consume attempts', async () => {
    const path = await databasePath();
    const authority = new SqliteTaskGrantAuthority(path, { now: () => new Date(NOW) });
    authority.importSnapshot(makeSnapshot());
    const results = await Promise.all([authority.consume(input()), authority.consume(input())]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, reason: 'uses_exhausted' }]);
    expect(authority.snapshot('tenant-a')[0]).toMatchObject({ usedCount: 1, status: 'exhausted' });
    authority.close();
  });

  it('rejects conflicting or non-single-use snapshots without rolling durable state backward', async () => {
    const path = await databasePath();
    const authority = new SqliteTaskGrantAuthority(path, { now: () => new Date(NOW) });
    authority.importSnapshot(makeSnapshot());
    await authority.consume(input());
    expect(() => authority.importSnapshot(makeSnapshot({ tokenDigest: 'e'.repeat(64) })))
      .toThrow(SqliteTaskGrantAuthorityError);
    expect(() => authority.importSnapshot(makeSnapshot({ maxUses: 2, usedCount: 0 })))
      .toThrow(SqliteTaskGrantAuthorityError);
    expect(authority.snapshot('tenant-a')[0]).toMatchObject({ usedCount: 1, status: 'exhausted' });
    authority.close();
  });

  it('loads only strict absolute digest-only snapshot files', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'hummer-task-grant-snapshot-'));
    directories.push(directory);
    const path = resolve(directory, 'snapshot.json');
    await writeFile(path, `${JSON.stringify(makeSnapshot())}\n`, 'utf8');
    await expect(loadTaskGrantSnapshot(path)).resolves.toMatchObject({
      schema: 'hummer.task-grant-snapshot', version: 1, tenantId: 'tenant-a',
    });
    await writeFile(path, `${JSON.stringify({ ...makeSnapshot(), token: TOKEN })}\n`, 'utf8');
    await expect(loadTaskGrantSnapshot(path)).rejects.toThrow(SqliteTaskGrantAuthorityError);
    await expect(loadTaskGrantSnapshot('relative.json')).rejects.toThrow(SqliteTaskGrantAuthorityError);
  });
});
