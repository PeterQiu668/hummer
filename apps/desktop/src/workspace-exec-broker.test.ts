import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceExecBroker, requestWorkspaceExecFromBroker } from './workspace-exec-broker.js';
import { WorkspaceExecService, type ContainerRunRequest } from './workspace-exec-service.js';

const directories: string[] = [];
const brokers: WorkspaceExecBroker[] = [];

afterEach(async () => {
  await Promise.all(brokers.splice(0).map((broker) => broker.close()));
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

describe('WorkspaceExecBroker', () => {
  it('binds execution to an active random lease and rejects invalid or revoked tokens', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hummer-workspace-broker-'));
    directories.push(root);
    const runContainer = vi.fn(async (request: ContainerRunRequest) => {
      if (request.purpose === 'self-check') return passingProbeResult();
      writeFileSync(join(request.workspaceDirectory, 'receipt.txt'), 'broker-bound', 'utf8');
      return { exitCode: 0, stdout: '', stderr: '', durationMs: 5 };
    });
    const service = new WorkspaceExecService({ workspaceRoot: root, runContainer });
    await service.selfCheck();
    const broker = new WorkspaceExecBroker({ service });
    brokers.push(broker);
    await broker.start();
    const lease = broker.createLease({ authToken: 'account-session', sessionId: 'session-1', workOrderId: 'order-1' });
    const input = { argv: ['python', 'build.py'], files: [{ path: 'build.py', content: "print('ok')" }] };

    await expect(requestWorkspaceExecFromBroker(input, {
      HUMMER_EXEC_BROKER_PIPE: lease.pipe,
      HUMMER_EXEC_BROKER_TOKEN: 'not-the-lease',
    })).rejects.toThrow('invalid or expired');

    const result = await requestWorkspaceExecFromBroker(input, {
      HUMMER_EXEC_BROKER_PIPE: lease.pipe,
      HUMMER_EXEC_BROKER_TOKEN: lease.token,
    });
    expect(result.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'receipt.txt', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }),
    ]));
    expect(runContainer).toHaveBeenCalledTimes(2);

    broker.revoke(lease.token);
    await expect(requestWorkspaceExecFromBroker(input, {
      HUMMER_EXEC_BROKER_PIPE: lease.pipe,
      HUMMER_EXEC_BROKER_TOKEN: lease.token,
    })).rejects.toThrow('invalid or expired');
    expect(runContainer).toHaveBeenCalledTimes(2);
  });
});

function passingProbeResult() {
  return {
    exitCode: 0,
    stdout: JSON.stringify({ probes: [
      { name: 'inside-write', succeeded: true },
      { name: 'path-escape', succeeded: false },
      { name: 'network-egress', succeeded: false },
      { name: 'dns-resolution', succeeded: false },
      { name: 'raw-socket', succeeded: false },
    ] }),
    stderr: '',
    durationMs: 1,
  };
}
