import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createDiagnosticBundle,
  verifyDiagnosticBundle,
  writeDiagnosticBundle,
  type DiagnosticBundleInput,
} from './diagnostic-bundle.js';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixture(): DiagnosticBundleInput {
  return {
    generatedAt: '2026-10-07T09:00:00Z',
    appVersion: '0.6.0-internal.1',
    platform: 'win32',
    nodeVersion: '22.22.2',
    tenantRef: 'tenant-private-reference',
    nodeRef: 'node-private-reference',
    runtimeStatus: [{ runtime: 'codex', status: 'available', version: '0.153.4' }],
    recentEvents: [{ occurredAt: '2026-10-07T08:59:00Z', component: 'relay', code: 'offline', message: 'bounded reconnect failed' }],
    files: [
      { path: 'logs/runtime.jsonl', category: 'log', contents: '{"level":"warn","code":"offline"}\n' },
      { path: 'receipts/last.json', category: 'receipt', contents: '{"status":"verified"}\n' },
    ],
    explicitSecrets: ['never-export-this-secret'],
  };
}

describe('W6 independently verifiable diagnostic bundle', () => {
  it('DIAGNOSTIC-01 emits a manifest, human summary, allowlisted files, and independently verified digests', async () => {
    const archive = await createDiagnosticBundle(fixture());
    const verified = await verifyDiagnosticBundle(archive, ['never-export-this-secret']);

    expect(verified.fileCount).toBe(2);
    expect(verified.totalFileBytes).toBeGreaterThan(0);
    expect(verified.archiveSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(verified.manifest.inventory.map((file) => file.path)).toEqual(['logs/runtime.jsonl', 'receipts/last.json']);
    expect(JSON.stringify(verified.manifest)).not.toContain('tenant-private-reference');
    expect(JSON.stringify(verified.manifest)).not.toContain('node-private-reference');
  });

  it.each([
    ['token', 'logs/runtime.log', 'Authorization: Bearer opaque-token-12345678'],
    ['credential', 'logs/runtime.log', 'api_key=credential-value-1234'],
    ['credential path', 'credentials/runtime.json', '{"status":"redacted"}'],
    ['database path', 'state/hummer.sqlite3', 'not-even-a-database'],
    ['database bytes', 'logs/runtime.log', Buffer.from('SQLite format 3\u0000remaining bytes', 'binary')],
    ['DemoSession', 'logs/session.json', '{"schema":"hummer.demo-session","redactionApplied":false}'],
    ['recording path', 'recordings/segment.jsonl', '{"status":"paused"}'],
    ['explicit secret', 'logs/runtime.log', 'never-export-this-secret'],
    ['Windows alternate stream', 'logs/runtime.log:secret', 'safe-looking content'],
  ])('DIAGNOSTIC-02 rejects %s before archive creation', async (_case, path, contents) => {
    const input = fixture();
    input.files = [{ path: String(path), category: 'log', contents: contents as string | Buffer }];
    await expect(createDiagnosticBundle(input)).rejects.toThrow();
  });

  it('DIAGNOSTIC-03 rejects an archive entry that is absent from the auditable inventory', async () => {
    const archive = await createDiagnosticBundle(fixture());
    const zip = await JSZip.loadAsync(archive);
    zip.file('files/logs/unlisted.log', 'safe-looking but unlisted');
    const tampered = await zip.generateAsync({ type: 'nodebuffer' });

    await expect(verifyDiagnosticBundle(tampered)).rejects.toThrow('unlisted or missing');
  });

  it('DIAGNOSTIC-04 writes a verified bundle once and refuses to overwrite it', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'hummer-diagnostic-bundle-'));
    directories.push(directory);
    const path = join(directory, 'diagnostic.zip');
    const receipt = await writeDiagnosticBundle(path, fixture());

    expect(receipt.path).toBe(path);
    await expect(writeDiagnosticBundle(path, fixture())).rejects.toThrow();
  });
});
