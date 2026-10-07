import { describe, expect, it, vi } from 'vitest';
import type { DemoSourceBoundary } from './persistence/index.js';
import {
  WindowsUiaCaptureAdapter,
  type WindowsUiaProbe,
  type WindowsUiaProbeResult,
} from './windows-uia-capture.js';

const boundary: DemoSourceBoundary = {
  apps: ['HummerUiaFixture'],
  windows: ['HUMMER UIA Fixture'],
  excluded: ['Password'],
};

const snapshot: WindowsUiaProbeResult = {
  processId: 4242,
  app: 'HummerUiaFixture',
  window: 'HUMMER UIA Fixture',
  nodes: [
    { role: 'Window', automationId: 'FixtureWindow' },
    { role: 'Button', automationId: 'RunButton' },
  ],
};

describe('[WINDOWS-UIA-ADAPTER] strict local metadata capture boundary', () => {
  it('requires an explicit process id, exact title, and the DemoSession source boundary', async () => {
    const probe = vi.fn<WindowsUiaProbe>().mockResolvedValue(snapshot);
    const adapter = new WindowsUiaCaptureAdapter({ platform: 'win32', probe });

    await expect(adapter.capture({ processId: 4242, windowTitle: 'HUMMER UIA Fixture', sourceBoundary: boundary }))
      .resolves.toEqual(snapshot);
    expect(probe).toHaveBeenCalledWith({ processId: 4242, windowTitle: 'HUMMER UIA Fixture' });
  });

  it.each([
    ['invalid pid', { processId: 0, windowTitle: 'HUMMER UIA Fixture', sourceBoundary: boundary }],
    ['non-exact title', { processId: 4242, windowTitle: 'HUMMER UIA', sourceBoundary: boundary }],
    ['excluded title', { processId: 4242, windowTitle: 'Password', sourceBoundary: { ...boundary, windows: ['Password'] } }],
  ])('fails closed before probing for %s', async (_label, request) => {
    const probe = vi.fn<WindowsUiaProbe>().mockResolvedValue(snapshot);
    const adapter = new WindowsUiaCaptureAdapter({ platform: 'win32', probe });
    await expect(adapter.capture(request)).rejects.toThrow();
    expect(probe).not.toHaveBeenCalled();
  });

  it.each([
    ['process mismatch', { ...snapshot, processId: 4243 }],
    ['window mismatch', { ...snapshot, window: 'Another Window' }],
    ['application outside allowlist', { ...snapshot, app: 'OtherApp' }],
    ['empty metadata', { ...snapshot, nodes: [] }],
  ])('rejects untrusted probe output for %s', async (_label, result) => {
    const adapter = new WindowsUiaCaptureAdapter({
      platform: 'win32',
      probe: vi.fn<WindowsUiaProbe>().mockResolvedValue(result),
    });
    await expect(adapter.capture({ processId: 4242, windowTitle: 'HUMMER UIA Fixture', sourceBoundary: boundary }))
      .rejects.toThrow();
  });

  it('rejects non-Windows hosts without invoking a probe', async () => {
    const probe = vi.fn<WindowsUiaProbe>();
    const adapter = new WindowsUiaCaptureAdapter({ platform: 'linux', probe });
    await expect(adapter.capture({ processId: 4242, windowTitle: 'HUMMER UIA Fixture', sourceBoundary: boundary }))
      .rejects.toThrow(/Windows/);
    expect(probe).not.toHaveBeenCalled();
  });
});
