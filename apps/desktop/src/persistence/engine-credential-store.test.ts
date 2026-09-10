import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openPersistence } from './database.js';

const directories: string[] = [];

afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

describe('EngineCredentialStore', () => {
  it('persists only ciphertext and keeps credentials tenant scoped across restart', () => {
    const directory = temporaryDirectory();
    const secret = 'sk-fake-plaintext-must-not-reach-sqlite';
    const first = openPersistence({ dataDirectory: directory });
    first.engineCredentials.upsert({
      tenantId: 'tenant_a', engineProfileId: 'deepseek-standard', envKey: 'DEEPSEEK_API_KEY',
      encryptedValue: Buffer.from(`protected:${secret}`).toString('base64'),
    });

    expect(first.engineCredentials.listStatus('tenant_a')).toEqual([
      expect.objectContaining({ engineProfileId: 'deepseek-standard', envKey: 'DEEPSEEK_API_KEY', configured: true }),
    ]);
    expect(first.engineCredentials.getEncrypted('tenant_b', 'deepseek-standard')).toBeUndefined();
    const databasePath = first.databasePath;
    first.close();

    expect(readDatabaseBytes(databasePath)).not.toContain(secret);
    expect(readDomainEventCount(databasePath)).toBe(0);
    const reopened = openPersistence({ dataDirectory: directory });
    expect(reopened.engineCredentials.getEncrypted('tenant_a', 'deepseek-standard')).toMatchObject({
      envKey: 'DEEPSEEK_API_KEY',
      encryptedValue: Buffer.from(`protected:${secret}`).toString('base64'),
    });
    reopened.close();
  });
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'hummer-credentials-'));
  directories.push(directory);
  return directory;
}

function readDatabaseBytes(databasePath: string): string {
  const require = createRequire(import.meta.url);
  const Database = require('better-sqlite3') as new (path: string, options: { readonly: boolean }) => {
    prepare(sql: string): { get(): { value: string } | undefined };
    close(): void;
  };
  const database = new Database(databasePath, { readonly: true });
  const row = database.prepare("SELECT hex(CAST(group_concat(encrypted_value, '') AS BLOB)) AS value FROM engine_credentials").get();
  database.close();
  return row?.value ?? '';
}

function readDomainEventCount(databasePath: string): number {
  const require = createRequire(import.meta.url);
  const Database = require('better-sqlite3') as new (path: string, options: { readonly: boolean }) => {
    prepare(sql: string): { get(): { count: number } | undefined };
    close(): void;
  };
  const database = new Database(databasePath, { readonly: true });
  const count = database.prepare('SELECT COUNT(*) AS count FROM domain_events').get()?.count ?? -1;
  database.close();
  return count;
}
