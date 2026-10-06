import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openPersistence } from './database.js';
import { openSqlite } from './sqlite.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

describe('content-addressed evidence blobs', () => {
  it('writes bytes under blobs/sha256, records their digest, and reads identical bytes back', () => {
    const persistence = openPersistence({ dataDirectory: temporaryDirectory() });
    const bytes = Buffer.from('HUMMER evidence bytes\n', 'utf8');
    persistence.runtimeEvents.saveSession({
      sessionId: 'ses_evidence', tenantId: 'tenant_demo', runtimeId: 'test',
      startedAt: '2026-08-28T05:00:00.000Z', plan: {}, handle: {},
    });

    const evidence = persistence.evidence.put(bytes, {
      tenantId: 'tenant_demo',
      sessionId: 'ses_evidence',
      mediaType: 'text/plain',
      name: 'summary.txt',
      createdAt: '2026-08-28T05:00:00.000Z',
    });

    expect(evidence.ref).toBe(`evidence://sha256/${evidence.sha256}`);
    expect(evidence.blobPath).toContain(join('blobs', 'sha256', evidence.sha256));
    expect(existsSync(evidence.blobPath)).toBe(true);
    expect(persistence.evidence.read('tenant_demo', evidence.ref)).toEqual(bytes);
    expect(readFileSync(evidence.blobPath)).toEqual(bytes);
    expect(persistence.evidence.verify('tenant_demo', evidence.ref)).toEqual({ valid: true, sha256: evidence.sha256, sizeBytes: bytes.length });
    persistence.close();
  });

  it('deduplicates equal content and detects bytes changed outside the store', () => {
    const persistence = openPersistence({ dataDirectory: temporaryDirectory() });
    const bytes = Buffer.from([0, 1, 2, 3, 255]);
    persistence.runtimeEvents.saveSession({
      sessionId: 'ses_evidence', tenantId: 'tenant_demo', runtimeId: 'test',
      startedAt: '2026-08-28T05:10:00.000Z', plan: {}, handle: {},
    });
    const metadata = {
      tenantId: 'tenant_demo', sessionId: 'ses_evidence', mediaType: 'application/octet-stream',
      name: 'artifact.bin', createdAt: '2026-08-28T05:10:00.000Z',
    };

    const first = persistence.evidence.put(bytes, metadata);
    const second = persistence.evidence.put(bytes, metadata);
    expect(second.ref).toBe(first.ref);
    expect(persistence.listEvidence('tenant_demo', 'ses_evidence')).toHaveLength(1);

    writeFileSync(first.blobPath, Buffer.from('tampered'));

    expect(persistence.evidence.verify('tenant_demo', first.ref)).toMatchObject({ valid: false, reason: 'digest_mismatch' });
    expect(() => persistence.evidence.read('tenant_demo', first.ref)).toThrow(/integrity check failed/i);
    persistence.close();
  });

  it('reuses a tenant-scoped legacy evidence row without rewriting its id', () => {
    const directory = temporaryDirectory();
    const persistence = openPersistence({ dataDirectory: directory });
    persistence.runtimeEvents.saveSession({
      sessionId: 'ses_legacy_evidence', tenantId: 'tenant_demo', runtimeId: 'test',
      startedAt: '2026-08-28T05:20:00.000Z', plan: {}, handle: {},
    });
    const metadata = {
      tenantId: 'tenant_demo', sessionId: 'ses_legacy_evidence', mediaType: 'text/plain',
      createdAt: '2026-08-28T05:20:00.000Z',
    };
    const bytes = Buffer.from('legacy evidence');
    const initial = persistence.evidence.put(bytes, metadata);
    const databasePath = persistence.databasePath;
    persistence.close();

    const database = openSqlite(databasePath);
    database.prepare('UPDATE evidence SET id = ? WHERE tenant_id = ? AND id = ?')
      .run('evi_legacy_pre_tenant_key', 'tenant_demo', initial.id);
    database.close();

    const reopened = openPersistence({ dataDirectory: directory });
    const reused = reopened.evidence.put(bytes, metadata);
    expect(reused.id).toBe('evi_legacy_pre_tenant_key');
    expect(reopened.evidence.read('tenant_demo', reused.ref)).toEqual(bytes);
    reopened.close();
  });
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'hummer-evidence-'));
  temporaryDirectories.push(directory);
  return directory;
}
