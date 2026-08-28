import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openPersistence } from './database.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

describe('content-addressed evidence blobs', () => {
  it('writes bytes under blobs/sha256, records their digest, and reads identical bytes back', () => {
    const persistence = openPersistence({ dataDirectory: temporaryDirectory() });
    const bytes = Buffer.from('HUMMER evidence bytes\n', 'utf8');

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
    expect(persistence.evidence.read(evidence.ref)).toEqual(bytes);
    expect(readFileSync(evidence.blobPath)).toEqual(bytes);
    expect(persistence.evidence.verify(evidence.ref)).toEqual({ valid: true, sha256: evidence.sha256, sizeBytes: bytes.length });
    persistence.close();
  });

  it('deduplicates equal content and detects bytes changed outside the store', () => {
    const persistence = openPersistence({ dataDirectory: temporaryDirectory() });
    const bytes = Buffer.from([0, 1, 2, 3, 255]);
    const metadata = {
      tenantId: 'tenant_demo', sessionId: 'ses_evidence', mediaType: 'application/octet-stream',
      name: 'artifact.bin', createdAt: '2026-08-28T05:10:00.000Z',
    };

    const first = persistence.evidence.put(bytes, metadata);
    const second = persistence.evidence.put(bytes, metadata);
    expect(second.ref).toBe(first.ref);
    expect(persistence.listEvidence('ses_evidence')).toHaveLength(1);

    writeFileSync(first.blobPath, Buffer.from('tampered'));

    expect(persistence.evidence.verify(first.ref)).toMatchObject({ valid: false, reason: 'digest_mismatch' });
    expect(() => persistence.evidence.read(first.ref)).toThrow(/integrity check failed/i);
    persistence.close();
  });
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'hummer-evidence-'));
  temporaryDirectories.push(directory);
  return directory;
}
