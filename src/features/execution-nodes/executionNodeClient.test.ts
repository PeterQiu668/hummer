import { afterEach, describe, expect, it } from 'vitest';
import { configureRemoteRelayExecutionNodes, desktopExecutionNodePort } from './executionNodeClient';

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
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
});
