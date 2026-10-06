import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDiagnosticPack, writeDiagnosticPack, type DiagnosticPackInput } from './diagnostic-pack.js';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixture(): DiagnosticPackInput {
  return {
    generatedAt: '2026-10-07T08:00:00Z',
    appVersion: '0.2.0',
    platform: 'win32',
    nodeVersion: '22.22.2',
    tenantRef: 'tenant-customer-name',
    nodeRef: 'node-personal-laptop',
    runtimeStatus: [{ runtime: 'codex', status: 'available', version: '0.153.4' }],
    recentEvents: [{ occurredAt: '2026-10-07T07:59:00Z', component: 'relay', code: 'probe_failed', message: 'Bearer opaque-badge-12345678 was refused; api_key=key-value-12345678' }],
    files: [{ path: 'logs/runtime.jsonl', bytes: 12, sha256: 'a'.repeat(64), category: 'log' }],
    explicitSecrets: ['opaque-badge-12345678'],
  };
}

describe('redacted diagnostic pack', () => {
  it('exports only hashed identity references and redacted diagnostics', () => {
    const input = fixture();
    const pack = createDiagnosticPack(input);
    const serialized = JSON.stringify(pack);

    expect(pack.tenantRefHash).toMatch(/^[a-f0-9]{64}$/);
    expect(pack.nodeRefHash).toMatch(/^[a-f0-9]{64}$/);
    expect(serialized).not.toContain(input.tenantRef);
    expect(serialized).not.toContain(input.nodeRef);
    expect(serialized).not.toContain(input.explicitSecrets?.[0]);
    expect(serialized).not.toContain('key-value-12345678');
    expect(serialized).toContain('[REDACTED');
  });

  it.each([
    'state/hummer.sqlite3',
    'credentials/runtime.json',
    'recordings/session-1.jsonl',
    'raw-capture/frame.png',
    '../outside/log.jsonl',
    'C:/Users/admin/log.jsonl',
  ])('rejects forbidden or non-relative diagnostic file %s', (path) => {
    const input = fixture();
    input.files = [{ ...input.files[0], path }];
    expect(() => createDiagnosticPack(input)).toThrow();
  });

  it('writes UTF-8 once and refuses to overwrite an existing pack', () => {
    const directory = mkdtempSync(join(tmpdir(), 'hummer-diagnostic-'));
    directories.push(directory);
    const path = join(directory, 'diagnostic.json');
    const receipt = writeDiagnosticPack(path, fixture());

    expect(receipt.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(receipt.bytes).toBe(Buffer.byteLength(readFileSync(path, 'utf8'), 'utf8'));
    expect(() => writeDiagnosticPack(path, fixture())).toThrow();
  });
});
