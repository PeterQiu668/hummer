import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DemoSessionUiaCaptureService } from './demo-session-uia-capture.js';
import { openPersistence, type DesktopPersistence } from './persistence/index.js';
import { WindowsUiaCaptureAdapter, type WindowsUiaProbe } from './windows-uia-capture.js';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));

describe('[WINDOWS-UIA-PERSISTENCE] fail-closed DemoSession integration', () => {
  it('persists a bounded UIAutomation snapshot atomically through DemoSessionStore', async () => {
    const fixture = setup();
    const service = fixture.service();
    const result = await service.capture(fixture.captureInput);
    expect(result).toMatchObject({ accepted: true, capturedRecords: 2, app: 'HummerUiaFixture' });
    expect(fixture.persistence.demoSessions.captureRecordCount(fixture.tenantId, fixture.sessionId)).toBe(2);
    fixture.persistence.close();
  });

  it('writes zero records when paused and does not touch the operating-system probe', async () => {
    const fixture = setup();
    fixture.persistence.demoSessions.pause(fixture.tenantId, fixture.sessionId, fixture.actorRef);
    const probe = vi.fn<WindowsUiaProbe>();
    const result = await fixture.service(probe).capture(fixture.captureInput);
    expect(result).toMatchObject({ accepted: false, reason: 'paused', capturedRecords: 0 });
    expect(probe).not.toHaveBeenCalled();
    expect(fixture.persistence.demoSessions.captureRecordCount(fixture.tenantId, fixture.sessionId)).toBe(0);
    fixture.persistence.close();
  });

  it('writes zero records for a wrong or outside-boundary window', async () => {
    const fixture = setup();
    await expect(fixture.service().capture({ ...fixture.captureInput, windowTitle: 'Wrong Window' })).rejects.toThrow(/boundary/);
    expect(fixture.persistence.demoSessions.captureRecordCount(fixture.tenantId, fixture.sessionId)).toBe(0);
    fixture.persistence.close();
  });

  it('rolls back the complete batch if any returned UIAutomation node is invalid', async () => {
    const fixture = setup();
    const probe = vi.fn<WindowsUiaProbe>().mockResolvedValue({
      processId: 4242, app: 'HummerUiaFixture', window: 'HUMMER UIA Fixture',
      nodes: [
        { role: 'Window', automationId: 'FixtureWindow' },
        { role: 'Button', name: 'forbidden accessible name' } as never,
      ],
    });
    await expect(fixture.service(probe).capture(fixture.captureInput)).rejects.toThrow();
    expect(fixture.persistence.demoSessions.captureRecordCount(fixture.tenantId, fixture.sessionId)).toBe(0);
    fixture.persistence.close();
  });

  it('rolls back DesktopPersistence batch writes when a later metadata record fails validation', () => {
    const fixture = setup();
    expect(() => fixture.persistence.demoSessions.ingestBatch({
      tenantId: fixture.tenantId,
      sessionId: fixture.sessionId,
      app: 'HummerUiaFixture',
      window: 'HUMMER UIA Fixture',
      metadata: [
        { kind: 'ax-node', role: 'Window', name: 'Safe synthetic fixture' },
        { kind: 'ax-node', role: 'Button', rawValue: 'unsupported' } as never,
      ],
    })).toThrow(/unsupported fields/i);
    expect(fixture.persistence.demoSessions.captureRecordCount(fixture.tenantId, fixture.sessionId)).toBe(0);
    fixture.persistence.close();
  });
});

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'hummer-uia-service-'));
  directories.push(directory);
  const persistence: DesktopPersistence = openPersistence({ dataDirectory: directory });
  const owner = persistence.identity.createCompany({
    companyName: 'UIA fixture tenant', displayName: 'UIA fixture owner', email: 'uia-fixture@example.test',
  });
  const tenantId = owner.tenant.id;
  const actorRef = `human:${owner.membership.humanUserId}`;
  const sessionId = 'demo_uia_service';
  persistence.demoSessions.start({
    tenantId, sessionId, expertActorRef: actorRef, nodeId: 'node_local_uia', captureMode: 'events-only',
    sourceBoundary: { apps: ['HummerUiaFixture'], windows: ['HUMMER UIA Fixture'], excluded: ['Password'] },
  });
  const defaultProbe = vi.fn<WindowsUiaProbe>().mockResolvedValue({
    processId: 4242, app: 'HummerUiaFixture', window: 'HUMMER UIA Fixture',
    nodes: [
      { role: 'Window', automationId: 'FixtureWindow' },
      { role: 'Button', automationId: 'RunButton' },
    ],
  });
  return {
    persistence, tenantId, actorRef, sessionId,
    captureInput: { tenantId, sessionId, processId: 4242, windowTitle: 'HUMMER UIA Fixture' },
    service: (probe: WindowsUiaProbe = defaultProbe) => new DemoSessionUiaCaptureService(
      persistence,
      new WindowsUiaCaptureAdapter({ platform: 'win32', probe }),
    ),
  };
}
