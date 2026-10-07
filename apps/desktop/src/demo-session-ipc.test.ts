import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DemoSessionV1 } from './persistence/index.js';

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
}));

vi.mock('electron', () => ({
  app: { getPath: () => process.cwd(), getVersion: () => 'test' },
  dialog: { showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })) },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => electron.handlers.set(channel, handler),
    removeHandler: (channel: string) => electron.handlers.delete(channel),
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
}));

import { registerPersistenceHost, type PersistenceHostRegistration } from './persistence-host.js';
import type { IdentityContext } from './persistence/index.js';
import { WindowsUiaCaptureAdapter, type WindowsUiaProbe } from './windows-uia-capture.js';

let directory = '';
let registration: PersistenceHostRegistration;
let originalDataDirectory: string | undefined;

beforeEach(() => {
  originalDataDirectory = process.env.HUMMER_DATA_DIR;
  directory = mkdtempSync(join(tmpdir(), 'hummer-demo-session-ipc-'));
  process.env.HUMMER_DATA_DIR = directory;
  registration = registerPersistenceHost({ enableDemoSessionSyntheticInjector: true });
});

afterEach(() => {
  registration.close();
  electron.handlers.clear();
  if (originalDataDirectory === undefined) delete process.env.HUMMER_DATA_DIR;
  else process.env.HUMMER_DATA_DIR = originalDataDirectory;
  rmSync(directory, { recursive: true, force: true });
});

describe('[DEMO-SESSION-IPC] trusted local DemoSession bridge', () => {
  it('keeps the synthetic metadata injector absent from the production registration', () => {
    registration.close();
    electron.handlers.clear();
    registration = registerPersistenceHost();
    expect(electron.handlers.has('hummer:demo-session:test-inject-synthetic')).toBe(false);
    expect(electron.handlers.has('hummer:demo-session:start')).toBe(true);
  });

  it('derives tenant and human ownership from auth and enforces the local privacy state machine', async () => {
    const ownerA = await createCompany('Alpha');
    const ownerB = await createCompany('Beta');
    const started = await invoke<DemoSessionV1>('hummer:demo-session:start', {
      token: ownerA.session.token,
      input: {
        tenantId: ownerB.tenant.id,
        expertActorRef: `human:${ownerB.membership.humanUserId}`,
        sourceBoundary: { apps: ['Microsoft Excel'], windows: ['销售周报'], excluded: ['密码'] },
        captureMode: 'events-only',
      },
    });
    expect(started).toMatchObject({
      tenantId: ownerA.tenant.id,
      expertActorRef: `human:${ownerA.membership.humanUserId}`,
      localOnly: true,
      status: 'capturing',
    });
    const firstSegmentId = started.segments[0]!.segId;

    await expect(inject(ownerA, started.sessionId, { kind: 'input-event', action: 'click', target: 'A1' }))
      .resolves.toMatchObject({ accepted: true, sequence: 1 });
    const paused = await action(ownerA, 'pause', started.sessionId);
    expect(paused.segments[0]).toMatchObject({ segId: firstSegmentId, recordCount: 1 });
    await expect(inject(ownerA, started.sessionId, { kind: 'input-event', action: 'scroll' }))
      .resolves.toEqual({ accepted: false, reason: 'paused' });

    const resumed = await action(ownerA, 'resume', started.sessionId);
    expect(resumed.segments).toHaveLength(2);
    await expect(inject(ownerA, started.sessionId, { kind: 'ax-node', role: 'table', name: 'Pipeline' }))
      .resolves.toMatchObject({ accepted: true, sequence: 1 });
    const ended = await action(ownerA, 'end', started.sessionId);
    const secondDigestBeforeDelete = ended.segments[1]!.digest;
    await expect(inject(ownerA, started.sessionId, { kind: 'input-event', action: 'click' }))
      .resolves.toEqual({ accepted: false, reason: 'ended' });
    await expect(invoke('hummer:demo-session:export-review', auth(ownerA, { sessionId: started.sessionId })))
      .rejects.toThrow(/Unredacted demo session bytes cannot leave this device/);
    await expect(invoke('hummer:demo-session:pause', auth(ownerB, { sessionId: started.sessionId })))
      .rejects.toThrow(/unavailable in the current tenant/);

    const deleted = await invoke<DemoSessionV1>('hummer:demo-session:delete-segment', auth(ownerA, {
      sessionId: started.sessionId,
      segmentId: firstSegmentId,
    }));
    expect(deleted.segments[0]).toMatchObject({ segId: firstSegmentId, recordCount: 0 });
    expect(deleted.segments[0]!.deletedAt).toBeTruthy();
    expect(deleted.segments[1]!.previousDigest).toBe(deleted.segments[0]!.digest);
    expect(deleted.segments[1]!.digest).not.toBe(secondDigestBeforeDelete);
    expect(deleted.deletionAudit).toHaveLength(1);

    const redacted = await invoke<DemoSessionV1>('hummer:demo-session:mark-redacted', auth(ownerA, {
      sessionId: started.sessionId,
      policyRef: 'local-human-review-v1',
    }));
    expect(redacted).toMatchObject({ redactionApplied: true, redactionPolicyRef: 'local-human-review-v1' });
    const review = await invoke<DemoSessionV1>('hummer:demo-session:export-review', auth(ownerA, { sessionId: started.sessionId }));
    expect(review).toEqual(redacted);
    expect(JSON.stringify(review)).not.toContain('Pipeline');
  });

  it('rejects unauthenticated mutation and capture outside the explicit application/window allowlist', async () => {
    const owner = await createCompany('Gamma');
    const started = await invoke<DemoSessionV1>('hummer:demo-session:start', auth(owner, {
      sourceBoundary: { apps: ['Microsoft Excel'], windows: ['销售周报'], excluded: ['支付'] },
      captureMode: 'events-only',
    }));
    await expect(invoke('hummer:demo-session:end', { token: 'not-a-session', input: { sessionId: started.sessionId } }))
      .rejects.toThrow();
    await expect(invoke('hummer:demo-session:test-inject-synthetic', auth(owner, {
      sessionId: started.sessionId,
      app: 'Browser',
      window: '支付',
      metadata: { kind: 'input-event', action: 'click' },
    }))).resolves.toEqual({ accepted: false, reason: 'outside_source_boundary' });
  });

  it('binds the real UIAutomation IPC to the authenticated owner and writes zero records for paused, wrong-window, and cross-session requests', async () => {
    registration.close();
    electron.handlers.clear();
    const probe = vi.fn<WindowsUiaProbe>().mockResolvedValue({
      processId: 4242, app: 'HummerUiaFixture', window: 'HUMMER UIA Fixture',
      nodes: [{ role: 'Window', automationId: 'FixtureWindow' }],
    });
    registration = registerPersistenceHost({
      enableDemoSessionSyntheticInjector: true,
      demoSessionUiaAdapter: new WindowsUiaCaptureAdapter({ platform: 'win32', probe }),
    });
    const owner = await createCompany('UiaOwner');
    const foreign = await createCompany('UiaForeign');
    const started = await invoke<DemoSessionV1>('hummer:demo-session:start', auth(owner, {
      sourceBoundary: { apps: ['HummerUiaFixture'], windows: ['HUMMER UIA Fixture'], excluded: ['Password'] },
      captureMode: 'events-only',
    }));

    await expect(invoke('hummer:demo-session:capture-uia', auth(foreign, {
      sessionId: started.sessionId, processId: 4242, windowTitle: 'HUMMER UIA Fixture',
    }))).rejects.toThrow(/unavailable in the current tenant/);
    expect(probe).not.toHaveBeenCalled();

    await expect(invoke('hummer:demo-session:capture-uia', auth(owner, {
      sessionId: started.sessionId, processId: 4242, windowTitle: 'Wrong Window',
    }))).rejects.toThrow(/boundary/);
    expect(probe).not.toHaveBeenCalled();

    await expect(invoke('hummer:demo-session:capture-uia', auth(owner, {
      tenantId: foreign.tenant.id,
      sessionId: started.sessionId, processId: 4242, windowTitle: 'HUMMER UIA Fixture',
    }))).resolves.toMatchObject({ accepted: true, capturedRecords: 1, session: { tenantId: owner.tenant.id } });
    expect(probe).toHaveBeenCalledOnce();

    const pausedSession = await invoke<DemoSessionV1>('hummer:demo-session:start', auth(owner, {
      sourceBoundary: { apps: ['HummerUiaFixture'], windows: ['HUMMER UIA Fixture'], excluded: ['Password'] },
      captureMode: 'events-only',
    }));
    await action(owner, 'pause', pausedSession.sessionId);
    await expect(invoke('hummer:demo-session:capture-uia', auth(owner, {
      sessionId: pausedSession.sessionId, processId: 4242, windowTitle: 'HUMMER UIA Fixture',
    }))).resolves.toMatchObject({ accepted: false, reason: 'paused', capturedRecords: 0 });
    expect(probe).toHaveBeenCalledOnce();
    const unchanged = await invoke<DemoSessionV1>('hummer:demo-session:get', auth(owner, { sessionId: pausedSession.sessionId }));
    expect(unchanged.segments[0]).toMatchObject({ recordCount: 0 });
  });
});

function auth<T>(identity: IdentityContext, input: T) { return { token: identity.session.token, input }; }
function action(identity: IdentityContext, name: 'pause' | 'resume' | 'end', sessionId: string): Promise<DemoSessionV1> {
  return invoke(`hummer:demo-session:${name}`, auth(identity, { sessionId }));
}
function inject(identity: IdentityContext, sessionId: string, metadata: Record<string, unknown>) {
  return invoke('hummer:demo-session:test-inject-synthetic', auth(identity, {
    sessionId,
    app: 'Microsoft Excel',
    window: '销售周报',
    metadata,
  }));
}
function createCompany(name: string): Promise<IdentityContext> {
  return invoke('hummer:identity:create-company', {
    companyName: `${name} Co`,
    displayName: `${name} Owner`,
    email: `${name.toLowerCase()}@example.test`,
  });
}
function invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = electron.handlers.get(channel);
  if (!handler) throw new Error(`Missing IPC handler ${channel}`);
  return Promise.resolve().then(() => handler({}, ...args) as T);
}
