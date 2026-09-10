import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CredentialVault } from './credential-vault.js';
import { openPersistence } from './persistence/database.js';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

describe('CredentialVault', () => {
  it('protects, restores and removes a tenant engine credential without exposing plaintext', () => {
    const persistence = openPersistence({ dataDirectory: temporaryDirectory() });
    const protector = {
      available: () => true,
      protect: (value: string) => Buffer.from(`dpapi:${value}`, 'utf8'),
      unprotect: (value: Buffer) => value.toString('utf8').replace(/^dpapi:/, ''),
    };
    const vault = new CredentialVault(persistence.engineCredentials, protector);
    const secret = 'sk-fake-vault-secret';

    vault.configure('tenant_a', 'deepseek-standard', 'DEEPSEEK_API_KEY', secret);
    expect(vault.statuses('tenant_a')).toEqual([
      expect.objectContaining({ engineProfileId: 'deepseek-standard', configured: true }),
    ]);
    expect(vault.resolve('tenant_a', 'deepseek-standard', 'DEEPSEEK_API_KEY')).toBe(secret);
    expect(JSON.stringify(persistence.engineCredentials.getEncrypted('tenant_a', 'deepseek-standard'))).not.toContain(secret);

    vault.remove('tenant_a', 'deepseek-standard');
    expect(vault.resolve('tenant_a', 'deepseek-standard', 'DEEPSEEK_API_KEY')).toBeUndefined();
    persistence.close();
  });

  it('fails closed when OS encryption is unavailable', () => {
    const persistence = openPersistence({ dataDirectory: temporaryDirectory() });
    const vault = new CredentialVault(persistence.engineCredentials, {
      available: () => false,
      protect: () => Buffer.alloc(0),
      unprotect: () => '',
    });

    expect(() => vault.configure('tenant_a', 'deepseek-standard', 'DEEPSEEK_API_KEY', 'secret')).toThrow(/安全存储/);
    persistence.close();
  });
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'hummer-vault-'));
  directories.push(directory);
  return directory;
}
