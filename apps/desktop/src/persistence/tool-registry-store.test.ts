import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openPersistence } from './database.js';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

describe('tenant tool registry', () => {
  it('seeds only implemented capabilities and rejects an unknown plan capability', () => {
    const persistence = openPersistence({ dataDirectory: tempDir() });
    const owner = persistence.identity.createCompany({ companyName: '工具企业', displayName: '负责人', email: 'tools@example.test' });

    persistence.tools.ensureDefaults(owner.tenant.id, `account:${owner.account.id}`);
    expect(persistence.tools.listDefinitions(owner.tenant.id).map((tool) => tool.capabilityId)).toEqual([
      'doc.extract',
      'external.send.draft',
      'fs.read',
    ]);
    expect(() => persistence.tools.assertCapabilities(owner.tenant.id, ['fs.read', 'desktop.excel.open'])).toThrow(/not registered.*desktop\.excel\.open/i);
    const connected = persistence.tools.recordConnectionStatus({
      tenantId: owner.tenant.id,
      capabilityId: 'fs.read',
      connected: true,
      actorRef: 'system:codex-host',
      occurredAt: '2026-09-11T05:00:00.000Z',
      error: null,
    });
    expect(connected).toMatchObject({ status: 'verified', verifiedAt: '2026-09-11T05:00:00.000Z' });
    expect(persistence.verifyDomainEventIntegrity()).toMatchObject({ valid: true });
    persistence.close();
  });

  it('records every invocation append-only with duration and content-addressed evidence', () => {
    const persistence = openPersistence({ dataDirectory: tempDir() });
    const owner = persistence.identity.createCompany({ companyName: '调用企业', displayName: '负责人', email: 'invoke@example.test' });
    persistence.tools.ensureDefaults(owner.tenant.id, `account:${owner.account.id}`);
    const evidence = persistence.evidence.put(Buffer.from('source facts'), {
      tenantId: owner.tenant.id,
      sessionId: 'session_tool_1',
      mediaType: 'text/plain',
      name: 'source.txt',
      createdAt: '2026-09-11T05:00:00.000Z',
    });

    const invocation = persistence.tools.recordInvocation({
      tenantId: owner.tenant.id,
      sessionId: 'session_tool_1',
      capabilityId: 'fs.read',
      actorRef: 'employee:reader',
      status: 'completed',
      args: { path: 'source.txt' },
      result: { bytes: 12 },
      durationMs: 14,
      evidenceRefs: [evidence.ref],
      occurredAt: '2026-09-11T05:00:01.000Z',
      idempotencyKey: 'tool-invocation-1',
    });

    expect(persistence.tools.listInvocations(owner.tenant.id, 'session_tool_1')).toEqual([invocation]);
    expect(invocation.evidenceRefs).toEqual([evidence.ref]);
    expect(persistence.listDomainEvents(owner.session.token)).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'tool.invoked', aggregateId: invocation.id }),
    ]));
    expect(persistence.verifyDomainEventIntegrity()).toMatchObject({ valid: true });
    persistence.close();
  });
});

function tempDir(): string {
  const directory = mkdtempSync(join(tmpdir(), 'hummer-tools-'));
  directories.push(directory);
  return directory;
}
