import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openPersistence, type DesktopPersistence } from './index.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

describe('DemoSession local privacy kernel', () => {
  it('PRIVACY-01 starts only for the tenant human and persists a valid local-only contract', () => {
    const fixture = setup();
    expect(() => fixture.persistence.demoSessions.start({
      ...fixture.startInput,
      sessionId: 'demo-non-human',
      expertActorRef: 'expert:alice',
    })).toThrow(/human actor/i);

    const session = fixture.persistence.demoSessions.start(fixture.startInput);
    expect(session).toMatchObject({
      tenantId: fixture.tenantId,
      expertActorRef: fixture.actorRef,
      status: 'capturing',
      localOnly: true,
      redactionApplied: false,
    });
    fixture.persistence.close();
  });

  it('PRIVACY-02 writes zero records outside the app/window allowlist or while paused', () => {
    const fixture = setup();
    const session = fixture.persistence.demoSessions.start(fixture.startInput);
    const segmentId = session.segments[0]!.segId;

    expect(fixture.persistence.demoSessions.ingest({
      tenantId: fixture.tenantId,
      sessionId: session.sessionId,
      app: 'PasswordManager',
      window: 'Vault',
      metadata: { kind: 'ax-node', role: 'button', name: 'Copy secret' },
    })).toEqual({ accepted: false, reason: 'outside_source_boundary' });
    expect(fixture.persistence.demoSessions.ingest({
      tenantId: fixture.tenantId,
      sessionId: session.sessionId,
      app: 'ResearchApp',
      window: 'Password dialog',
      metadata: { kind: 'input-event', action: 'click', target: 'Reveal' },
    })).toEqual({ accepted: false, reason: 'outside_source_boundary' });
    expect(fixture.persistence.demoSessions.captureRecordCount(fixture.tenantId, session.sessionId)).toBe(0);

    fixture.advance();
    fixture.persistence.demoSessions.pause(fixture.tenantId, session.sessionId, fixture.actorRef);
    expect(fixture.persistence.demoSessions.ingest({
      tenantId: fixture.tenantId,
      sessionId: session.sessionId,
      app: 'ResearchApp',
      window: 'Approved workspace',
      metadata: { kind: 'ax-node', role: 'document' },
    })).toEqual({ accepted: false, reason: 'paused' });
    expect(fixture.persistence.demoSessions.captureRecordCount(fixture.tenantId, session.sessionId, segmentId)).toBe(0);
    fixture.persistence.close();
  });

  it('PRIVACY-03 accepts metadata only and rejects raw keyframe payload fields', () => {
    const fixture = setup();
    const session = fixture.persistence.demoSessions.start(fixture.startInput);
    const accepted = fixture.persistence.demoSessions.ingest({
      tenantId: fixture.tenantId,
      sessionId: session.sessionId,
      app: 'ResearchApp',
      window: 'Approved workspace',
      metadata: {
        kind: 'keyframe-metadata',
        frameId: 'frame-1',
        width: 1280,
        height: 720,
        changedRegions: 2,
        sha256: 'a'.repeat(64),
      },
    });
    expect(accepted.accepted).toBe(true);
    expect(() => fixture.persistence.demoSessions.ingest({
      tenantId: fixture.tenantId,
      sessionId: session.sessionId,
      app: 'ResearchApp',
      window: 'Approved workspace',
      metadata: {
        kind: 'keyframe-metadata', frameId: 'frame-raw', width: 1, height: 1,
        changedRegions: 1, sha256: 'b'.repeat(64), rawBytes: 'data:image/png;base64,AAAA',
      } as never,
    })).toThrow(/unsupported fields/i);
    expect(fixture.persistence.demoSessions.captureRecordCount(fixture.tenantId, session.sessionId)).toBe(1);
    fixture.persistence.close();
  });

  it('PRIVACY-04 tombstones a closed segment, physically purges records and rechains later digests', () => {
    const fixture = setup();
    const started = fixture.persistence.demoSessions.start(fixture.startInput);
    const firstSegmentId = started.segments[0]!.segId;
    fixture.persistence.demoSessions.ingest({
      tenantId: fixture.tenantId,
      sessionId: started.sessionId,
      app: 'ResearchApp',
      window: 'Approved workspace',
      metadata: { kind: 'ax-node', role: 'document', name: 'Synthetic record' },
    });
    fixture.advance();
    fixture.persistence.demoSessions.pause(fixture.tenantId, started.sessionId, fixture.actorRef);
    fixture.advance();
    fixture.persistence.demoSessions.resume(fixture.tenantId, started.sessionId, fixture.actorRef);
    fixture.persistence.demoSessions.ingest({
      tenantId: fixture.tenantId,
      sessionId: started.sessionId,
      app: 'ResearchApp',
      window: 'Approved workspace',
      metadata: { kind: 'input-event', action: 'scroll', target: 'Synthetic list' },
    });
    fixture.advance();
    const paused = fixture.persistence.demoSessions.pause(fixture.tenantId, started.sessionId, fixture.actorRef);
    const oldHead = paused.chainHead;
    const oldSecondDigest = paused.segments[1]!.digest;

    fixture.advance();
    const deleted = fixture.persistence.demoSessions.deleteSegment(
      fixture.tenantId, started.sessionId, firstSegmentId, fixture.actorRef,
    );
    expect(fixture.persistence.demoSessions.captureRecordCount(fixture.tenantId, started.sessionId, firstSegmentId)).toBe(0);
    expect(fixture.persistence.demoSessions.captureRecordCount(fixture.tenantId, started.sessionId)).toBe(1);
    expect(deleted.segments[0]).toMatchObject({ segId: firstSegmentId, recordCount: 0, deletedAt: expect.any(String) });
    expect(deleted.segments[1]!.previousDigest).toBe(deleted.segments[0]!.digest);
    expect(deleted.segments[1]!.digest).not.toBe(oldSecondDigest);
    expect(deleted.chainHead).not.toBe(oldHead);
    expect(deleted.deletionAudit).toEqual([
      expect.objectContaining({ segId: firstSegmentId, by: fixture.actorRef }),
    ]);
    expect(fixture.persistence.verifyTenantDomainEventIntegrity(fixture.tenantId)).toEqual({ valid: true, checked: 6 });
    fixture.persistence.close();
  });

  it('PRIVACY-05 rejects unredacted egress and exports only the redacted session projection', () => {
    const fixture = setup();
    const session = fixture.persistence.demoSessions.start(fixture.startInput);
    fixture.advance();
    fixture.persistence.demoSessions.end(fixture.tenantId, session.sessionId, fixture.actorRef);
    expect(() => fixture.persistence.demoSessions.exportForEgress(fixture.tenantId, session.sessionId))
      .toThrow(/Unredacted.*cannot leave/i);

    fixture.advance();
    const redacted = fixture.persistence.demoSessions.markRedactionApplied(
      fixture.tenantId, session.sessionId, fixture.actorRef, 'redaction-policy-v1',
    );
    const exported = fixture.persistence.demoSessions.exportForEgress(fixture.tenantId, session.sessionId);
    expect(exported).toEqual(redacted);
    expect(exported).not.toHaveProperty('records');
    expect(exported).toMatchObject({ redactionApplied: true, redactionPolicyRef: 'redaction-policy-v1' });
    fixture.persistence.close();
  });

  it('PRIVACY-06 rejects cross-tenant reads, mutation and record counts with one opaque error', () => {
    const fixture = setup();
    const foreign = fixture.persistence.identity.createCompany({
      companyName: 'Foreign synthetic tenant',
      displayName: 'Foreign owner',
      email: 'foreign-privacy@example.test',
    });
    const session = fixture.persistence.demoSessions.start(fixture.startInput);
    const foreignTenantId = foreign.tenant.id;
    const foreignActor = `human:${foreign.membership.humanUserId}`;
    expect(() => fixture.persistence.demoSessions.get(foreignTenantId, session.sessionId)).toThrow(opaqueUnavailable());
    expect(() => fixture.persistence.demoSessions.pause(foreignTenantId, session.sessionId, foreignActor)).toThrow(opaqueUnavailable());
    expect(() => fixture.persistence.demoSessions.captureRecordCount(foreignTenantId, session.sessionId)).toThrow(opaqueUnavailable());
    fixture.persistence.close();
  });
});

function setup(): {
  persistence: DesktopPersistence;
  tenantId: string;
  actorRef: string;
  startInput: Parameters<DesktopPersistence['demoSessions']['start']>[0];
  advance: () => void;
} {
  const directory = mkdtempSync(join(tmpdir(), 'hummer-privacy-'));
  temporaryDirectories.push(directory);
  let epoch = Date.parse('2026-10-07T00:00:00.000Z');
  const persistence = openPersistence({ dataDirectory: directory, now: () => new Date(epoch) });
  const owner = persistence.identity.createCompany({
    companyName: 'Synthetic privacy tenant',
    displayName: 'Synthetic expert',
    email: 'privacy-owner@example.test',
  });
  const tenantId = owner.tenant.id;
  const actorRef = `human:${owner.membership.humanUserId}`;
  return {
    persistence,
    tenantId,
    actorRef,
    startInput: {
      sessionId: 'demo-synthetic-1',
      tenantId,
      expertActorRef: actorRef,
      nodeId: 'node-local-synthetic',
      sourceBoundary: {
        apps: ['ResearchApp'],
        windows: ['Approved workspace'],
        excluded: ['PasswordManager', 'Password dialog'],
      },
      captureMode: 'ax-tree+keyframes',
    },
    advance: () => { epoch += 1_000; },
  };
}

function opaqueUnavailable(): RegExp {
  return /Demo session is unavailable in the current tenant/;
}
