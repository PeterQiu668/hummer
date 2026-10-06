import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteFleetStore } from '../src/index.js';

interface Database {
  close(): void;
  exec(sql: string): void;
}

interface DatabaseConstructor {
  new(path: string): Database;
}

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('Relay SQLite chaos gates', () => {
  it('fails explicitly on a sustained SQLite write lock without partially registering a node', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'hummer-relay-db-lock-'));
    directories.push(directory);
    const databasePath = join(directory, 'relay.sqlite3');
    const store = new SqliteFleetStore(databasePath);
    const require = createRequire(import.meta.url);
    const loaded = require('better-sqlite3') as DatabaseConstructor | { default: DatabaseConstructor };
    const Constructor = typeof loaded === 'function' ? loaded : loaded.default;
    const lockHolder = new Constructor(databasePath);
    lockHolder.exec('BEGIN IMMEDIATE');

    try {
      await expect(store.registerNode(
        'tenant-a',
        { schema: 'test.node', nodeId: 'node-a', tenantIds: ['tenant-a'], agentVersion: '1.0.0' },
        { nodeId: 'node-a', tenantIds: ['tenant-a'], agentVersion: '1.0.0' },
        ['tenant-a'],
        undefined,
        '2026-10-07T00:00:00.000Z',
        60_000,
      )).rejects.toMatchObject({ code: 'SQLITE_BUSY' });
    } finally {
      lockHolder.exec('ROLLBACK');
      lockHolder.close();
    }

    expect(await store.getNode('tenant-a', 'node-a', '2026-10-07T00:00:00.000Z')).toBeNull();
    await expect(store.registerNode(
      'tenant-a',
      { schema: 'test.node', nodeId: 'node-a', tenantIds: ['tenant-a'], agentVersion: '1.0.0' },
      { nodeId: 'node-a', tenantIds: ['tenant-a'], agentVersion: '1.0.0' },
      ['tenant-a'],
      undefined,
      '2026-10-07T00:00:00.001Z',
      60_000,
    )).resolves.toMatchObject({ nodeId: 'node-a', status: 'online' });
    store.close();
  }, 15_000);
});
