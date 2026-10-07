import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  desktopRelayExecutionNodePort,
  desktopRelayPort,
  desktopRelayStartWorkDispatchPort,
  isDesktopRelayConfigured,
  type DesktopRelayRendererHost,
} from './desktopRelayPort';

const TOKEN = 'desktop-session-token';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Desktop Relay renderer production ports', () => {
  it('stays unavailable outside the trusted preload bridge', async () => {
    expect(desktopRelayPort()).toBeUndefined();
    expect(desktopRelayExecutionNodePort()).toBeUndefined();
    expect(desktopRelayStartWorkDispatchPort()).toBeUndefined();
    await expect(isDesktopRelayConfigured()).resolves.toBe(false);
  });

  it('hides the session token while exposing nodes, task control, approval and StartWork dispatch', async () => {
    const host = bridge();
    vi.stubGlobal('localStorage', { getItem: vi.fn(() => TOKEN) });
    vi.stubGlobal('window', { hummerDesktopRelay: host });

    await expect(isDesktopRelayConfigured()).resolves.toBe(true);
    await expect(desktopRelayExecutionNodePort()!.list()).resolves.toEqual([{
      id: 'node-a', tenantId: 'tenant-a', displayName: 'node-a', runtimeId: 'codex', status: 'online',
      cwd: 'remote', permissionScope: 'task.execute', currentSessionId: null,
      lastSeenAt: '2026-10-07T08:00:00.000Z',
    }]);
    await desktopRelayStartWorkDispatchPort()!.record({
      schema: 'hummer.start-work-dispatch-intent', version: 1, status: 'pending', planId: 'plan-1',
      confirmedBy: 'human:operator', confirmedAt: '2026-10-07T08:00:00.000Z',
      envelope: { tenantId: 'tenant-a' } as never,
    });
    const port = desktopRelayPort()!;
    await port.listTasks();
    await port.listApprovalRequests();
    await port.decideApproval({ requestId: 'request-1', decision: 'approved', rationale: 'reviewed' });
    await port.revokeApproval('request-1');
    await port.stopTask('task-1');

    expect(host.listNodes).toHaveBeenCalledWith(TOKEN);
    expect(host.enqueueTask).toHaveBeenCalledWith(TOKEN, { tenantId: 'tenant-a' });
    expect(host.listTasks).toHaveBeenCalledWith(TOKEN);
    expect(host.listApprovalRequests).toHaveBeenCalledWith(TOKEN);
    expect(host.decideApproval).toHaveBeenCalledWith({
      token: TOKEN, requestId: 'request-1', decision: 'approved', rationale: 'reviewed',
    });
    expect(host.revokeApproval).toHaveBeenCalledWith(TOKEN, 'request-1');
    expect(host.stopTask).toHaveBeenCalledWith(TOKEN, 'task-1');
    expect(Object.keys(port)).not.toContain('badge');
    expect(JSON.stringify(port)).not.toContain(TOKEN);
  });

  it('fails closed before preload invocation when there is no authenticated renderer session', async () => {
    const host = bridge();
    vi.stubGlobal('localStorage', { getItem: vi.fn(() => null) });
    vi.stubGlobal('window', { hummerDesktopRelay: host });

    expect(() => desktopRelayPort()!.listTasks()).toThrow('authenticated session');
    expect(host.listTasks).not.toHaveBeenCalled();
  });
});

function bridge(): DesktopRelayRendererHost {
  return {
    status: vi.fn(async () => ({ configured: true })),
    listNodes: vi.fn(async () => [{
      nodeId: 'node-a', tenantId: 'tenant-a', status: 'online' as const, lastSeenAt: '2026-10-07T08:00:00.000Z',
      manifest: { runtimes: [{ kind: 'codex', available: true }], capabilities: ['task.execute'] },
    }]),
    enqueueTask: vi.fn(async () => ({ inserted: true })),
    listTasks: vi.fn(async () => []),
    listApprovalRequests: vi.fn(async () => []),
    decideApproval: vi.fn(async () => ({ decision: 'approved' })),
    revokeApproval: vi.fn(async () => ({ revocation: { requestId: 'request-1' } })),
    stopTask: vi.fn(async () => ({ task: { status: 'blocked' } })),
  };
}
