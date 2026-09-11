import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openPersistence } from './persistence/database.js';
import { enrichRuntimeEventEvidence } from './persistence-runtime.js';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

describe('runtime artifact evidence', () => {
  it('replaces synthetic references with a content-addressed blob reference for a real file change', () => {
    const root = temporaryDirectory();
    const data = temporaryDirectory();
    writeFileSync(join(root, 'summary.md'), 'real artifact', 'utf8');
    const persistence = openPersistence({ dataDirectory: data });

    const event = enrichRuntimeEventEvidence(persistence, {
      sessionId: 'ses_1', sequence: 2, occurredAt: '2026-08-28T03:00:00.000Z', actorRef: 'employee:codex',
      type: 'tool', tool: 'workspace.patch', args: { changes: [{ path: 'summary.md' }] }, result: 'completed',
      status: 'completed', durationMs: null, costCny: null, evidenceRefs: ['evi://fake'], title: 'file change',
    }, root, 'tenant_demo');

    expect(event.evidenceRefs).toHaveLength(1);
    expect(event.evidenceRefs[0]).toMatch(/^evidence:\/\/sha256\/[a-f0-9]{64}$/);
    expect(persistence.evidence.read(event.evidenceRefs[0])).toEqual(Buffer.from('real artifact'));
    persistence.close();
  });

  it('stores the source office document as evidence for doc.extract', () => {
    const root = temporaryDirectory();
    const data = temporaryDirectory();
    writeFileSync(join(root, 'orders.xlsx'), 'fixture bytes', 'utf8');
    const persistence = openPersistence({ dataDirectory: data });

    const event = enrichRuntimeEventEvidence(persistence, {
      sessionId: 'ses_doc_1', sequence: 3, occurredAt: '2026-09-12T03:00:00.000Z', actorRef: 'employee:codex',
      type: 'tool', tool: 'doc.extract', args: { path: 'orders.xlsx' }, result: { format: 'xlsx' },
      status: 'completed', durationMs: 18, costCny: null, evidenceRefs: ['codex://items/mcp_doc_1'], title: 'extract document',
    }, root, 'tenant_demo');

    expect(event.evidenceRefs).toEqual(expect.arrayContaining([expect.stringMatching(/^evidence:\/\/sha256\/[a-f0-9]{64}$/)]));
    expect(persistence.evidence.read(event.evidenceRefs.find((ref) => ref.startsWith('evidence://'))!)).toEqual(Buffer.from('fixture bytes'));
    persistence.close();
  });

  it('does not follow a runtime-supplied symbolic link while enriching evidence', () => {
    const root = temporaryDirectory();
    const outside = temporaryDirectory();
    const data = temporaryDirectory();
    writeFileSync(join(outside, 'outside.xlsx'), 'must stay outside', 'utf8');
    symlinkSync(outside, join(root, 'linked'), 'junction');
    const persistence = openPersistence({ dataDirectory: data });

    const event = enrichRuntimeEventEvidence(persistence, {
      sessionId: 'ses_doc_link', sequence: 3, occurredAt: '2026-09-12T03:00:00.000Z', actorRef: 'employee:untrusted-runtime',
      type: 'tool', tool: 'doc.extract', args: { path: 'linked/outside.xlsx' }, result: { format: 'xlsx' },
      status: 'completed', durationMs: 18, costCny: null, evidenceRefs: ['codex://items/mcp_doc_link'], title: 'extract document',
    }, root, 'tenant_demo');

    expect(event.evidenceRefs).toEqual(['codex://items/mcp_doc_link']);
    expect(persistence.listEvidence('ses_doc_link')).toEqual([]);
    persistence.close();
  });
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'hummer-persistence-runtime-'));
  directories.push(directory);
  return directory;
}
