import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { platform } from 'node:process';
import { openPersistence } from './database.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

describe('controlled write channel', () => {
  it('refuses a file write without an approved HUMMER policy decision', () => {
    const fixture = createFixture('missing');
    const outputPath = join(fixture.workspace, 'blocked.md');

    expect(() => fixture.persistence.controlledWrites.write({
      tenantId: fixture.tenantId,
      sessionId: 'session_missing',
      approvalId: 'approval_missing',
      action: 'file.write.summary',
      requestedBy: 'employee:writer',
      relativePath: 'blocked.md',
      content: 'must not exist',
      workspaceDirectory: fixture.workspace,
      occurredAt: '2026-09-11T04:00:00.000Z',
    })).toThrow(/approved approval/i);
    expect(existsSync(outputPath)).toBe(false);

    fixture.persistence.close();
  });

  it('refuses a rejected write and leaves the rejection in the hash chain', () => {
    const fixture = createFixture('rejected');
    recordApproval(fixture.persistence, fixture.tenantId, fixture.approverActorRef, 'session_rejected', 'approval_rejected', false);

    expect(() => fixture.persistence.controlledWrites.write({
      tenantId: fixture.tenantId,
      sessionId: 'session_rejected',
      approvalId: 'approval_rejected',
      action: 'file.write.summary',
      requestedBy: 'employee:writer',
      relativePath: 'rejected.md',
      content: 'must not exist',
      workspaceDirectory: fixture.workspace,
      occurredAt: '2026-09-11T04:00:02.000Z',
    })).toThrow(/approved approval/i);

    expect(existsSync(join(fixture.workspace, 'rejected.md'))).toBe(false);
    expect(fixture.persistence.listDomainEvents(fixture.token)).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'approval.rejected', aggregateId: 'approval_rejected' }),
    ]));
    expect(fixture.persistence.verifyDomainEventIntegrity()).toMatchObject({ valid: true });

    fixture.persistence.close();
  });

  it('writes only inside the workspace after approval and stores content-addressed evidence', () => {
    const fixture = createFixture('approved');
    recordApproval(fixture.persistence, fixture.tenantId, fixture.approverActorRef, 'session_approved', 'approval_approved', true);

    expect(() => fixture.persistence.controlledWrites.write({
      tenantId: fixture.tenantId,
      sessionId: 'session_approved',
      approvalId: 'approval_approved',
      action: 'file.write.summary',
      requestedBy: 'employee:writer',
      relativePath: '../escaped.md',
      content: 'escape',
      workspaceDirectory: fixture.workspace,
      occurredAt: '2026-09-11T04:00:02.000Z',
    })).toThrow(/outside the workspace/i);

    const result = fixture.persistence.controlledWrites.write({
      tenantId: fixture.tenantId,
      sessionId: 'session_approved',
      approvalId: 'approval_approved',
      action: 'file.write.summary',
      requestedBy: 'employee:writer',
      relativePath: 'approved.md',
      content: 'approved content',
      workspaceDirectory: fixture.workspace,
      occurredAt: '2026-09-11T04:00:03.000Z',
    });

    expect(readFileSync(join(fixture.workspace, 'approved.md'), 'utf8')).toBe('approved content');
    expect(result.evidenceRef).toMatch(/^evidence:\/\/sha256\/[a-f0-9]{64}$/);
    expect(fixture.persistence.evidence.verify(result.evidenceRef)).toEqual({
      valid: true,
      sha256: result.sha256,
      sizeBytes: Buffer.byteLength('approved content'),
    });
    expect(fixture.persistence.listDomainEvents(fixture.token)).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'controlled_write.executed', aggregateId: result.id }),
    ]));
    expect(fixture.persistence.verifyDomainEventIntegrity()).toMatchObject({ valid: true });

    fixture.persistence.close();
  });

  it('rejects a nested symbolic-link path before creating directories outside the workspace', () => {
    const fixture = createFixture('symlink');
    recordApproval(fixture.persistence, fixture.tenantId, fixture.approverActorRef, 'session_symlink', 'approval_symlink', true);
    const external = join(fixture.root, 'external');
    mkdirSync(fixture.workspace, { recursive: true });
    mkdirSync(external);
    symlinkSync(external, join(fixture.workspace, 'linked'), platform === 'win32' ? 'junction' : 'dir');

    expect(() => fixture.persistence.controlledWrites.write({
      tenantId: fixture.tenantId,
      sessionId: 'session_symlink',
      approvalId: 'approval_symlink',
      action: 'file.write.summary',
      requestedBy: 'employee:writer',
      relativePath: 'linked/new-directory/blocked.md',
      content: 'must not escape',
      workspaceDirectory: fixture.workspace,
      occurredAt: '2026-09-11T04:00:02.000Z',
    })).toThrow(/symbolic-link/i);
    expect(existsSync(join(external, 'new-directory'))).toBe(false);

    fixture.persistence.close();
  });
});

function createFixture(label: string) {
  const root = mkdtempSync(join(tmpdir(), `hummer-write-gate-${label}-`));
  temporaryDirectories.push(root);
  const workspace = join(root, 'workspace');
  const persistence = openPersistence({ dataDirectory: join(root, 'facts') });
  const identity = persistence.identity.createCompany({
    companyName: 'Gate Test',
    displayName: 'Owner',
    email: `owner-${label}@example.com`,
  });
  persistence.approvalPolicies.ensureDefaults(identity.tenant.id, `account:${identity.account.id}`);
  return {
    root,
    persistence,
    workspace,
    tenantId: identity.tenant.id,
    token: identity.session.token,
    approverActorRef: `account:${identity.account.id}`,
  };
}

function recordApproval(
  persistence: ReturnType<typeof openPersistence>,
  tenantId: string,
  approverActorRef: string,
  sessionId: string,
  approvalId: string,
  approved: boolean,
): void {
  persistence.runtimeEvents.saveSession({
    sessionId,
    tenantId,
    runtimeId: 'codex-cli',
    startedAt: '2026-09-11T04:00:00.000Z',
    plan: { id: `plan_${sessionId}`, prompt: 'write a summary' },
    handle: { runtimeId: 'codex-cli', sessionId },
  });
  persistence.runtimeEvents.save({
    sessionId,
    sequence: 1,
    occurredAt: '2026-09-11T04:00:00.000Z',
    actorRef: 'employee:writer',
    type: 'approval_required',
    approvalId,
    tool: 'file.write.summary',
    evidenceRefs: [],
  }, { tenantId, runtimeId: 'codex-cli', correlationId: `corr_${sessionId}` });
  persistence.approvalPolicies.authorize({
    tenantId,
    sessionId,
    approvalId,
    action: 'file.write.summary',
    requestedBy: 'employee:writer',
    estimatedCostCny: null,
    approverActorRef,
    approved,
    occurredAt: '2026-09-11T04:00:01.000Z',
  });
}
