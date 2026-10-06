import { afterEach, describe, expect, it, vi } from 'vitest';
import { configureRemoteRelayExecutionNodes, desktopExecutionNodePort } from './executionNodeClient';

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.unstubAllGlobals();
});

describe('executionNodeClient browser Relay branch', () => {
  it('stays unavailable until an explicit remote Relay client is configured', () => {
    expect(desktopExecutionNodePort()).toBeUndefined();
  });

  it('maps explicitly configured Relay nodes and remains read-only', async () => {
    dispose = configureRemoteRelayExecutionNodes({
      listNodes: async () => [{
        nodeId: 'node-a',
        tenantId: 'tenant-a',
        status: 'online',
        lastSeenAt: '2026-10-07T00:00:00.000Z',
        manifest: {
          runtimes: [{ kind: 'codex', available: true }],
          capabilities: ['workspace.exec', 'artifact.write'],
        },
      }],
    });

    const port = desktopExecutionNodePort();
    expect(await port?.list()).toEqual([{
      id: 'node-a',
      tenantId: 'tenant-a',
      displayName: 'node-a',
      runtimeId: 'codex',
      status: 'online',
      cwd: 'remote',
      permissionScope: 'workspace.exec, artifact.write',
      currentSessionId: null,
      lastSeenAt: '2026-10-07T00:00:00.000Z',
    }]);
    await expect(port?.killAll()).rejects.toThrow('read-only');
  });

  it('keeps Electron IPC precedence when a remote browser client was configured', async () => {
    const remoteList = vi.fn().mockResolvedValue([]);
    const desktopList = vi.fn().mockResolvedValue([]);
    dispose = configureRemoteRelayExecutionNodes({ listNodes: remoteList });
    vi.stubGlobal('localStorage', { getItem: () => 'desktop-session-token' });
    vi.stubGlobal('window', {
      hummerExecutionNodes: { list: desktopList, killAll: vi.fn().mockResolvedValue({ killed: 0 }) },
    });

    await desktopExecutionNodePort()?.list();

    expect(desktopList).toHaveBeenCalledWith('desktop-session-token');
    expect(remoteList).not.toHaveBeenCalled();
  });
});
