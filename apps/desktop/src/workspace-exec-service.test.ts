import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceExecService, type ContainerRunRequest } from './workspace-exec-service.js';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

describe('WorkspaceExecService', () => {
  it('fails closed when the startup network-isolation self-check does not pass all five probes', async () => {
    const root = temporaryDirectory();
    const runContainer = vi.fn(async () => ({
      exitCode: 0,
      stdout: JSON.stringify({ probes: [
        { name: 'inside-write', succeeded: true },
        { name: 'path-escape', succeeded: false },
        { name: 'network-egress', succeeded: true },
        { name: 'dns-resolution', succeeded: false },
        { name: 'raw-socket', succeeded: false },
      ] }),
      stderr: '',
      durationMs: 12,
    }));
    const service = new WorkspaceExecService({ workspaceRoot: root, runContainer });

    await expect(service.selfCheck()).resolves.toMatchObject({ available: false, passed: 4, total: 5 });
    await expect(service.execute({ orderId: 'order_1', argv: ['python', '-c', 'print(1)'], files: [] }))
      .rejects.toThrow('执行能力不可用：本机网络隔离未生效');
    expect(runContainer).toHaveBeenCalledTimes(1);
  });

  it('executes only after a passing self-check and returns content-addressed artifacts', async () => {
    const root = temporaryDirectory();
    const runContainer = vi.fn(async (request: ContainerRunRequest) => {
      if (request.purpose === 'self-check') return passingProbeResult();
      writeFileSync(join(request.workspaceDirectory, 'result.txt'), 'real output', 'utf8');
      return { exitCode: 0, stdout: 'done', stderr: '', durationMs: 22 };
    });
    const service = new WorkspaceExecService({ workspaceRoot: root, runContainer });

    await service.selfCheck();
    const result = await service.execute({
      orderId: 'order_1',
      argv: ['python', 'build.py'],
      files: [{ path: 'build.py', content: "print('done')" }],
    });

    expect(result.exitCode).toBe(0);
    expect(result.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'result.txt', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }),
    ]));
    expect(readFileSync(join(root, 'order_1', 'result.txt'), 'utf8')).toBe('real output');

    await service.execute({
      orderId: 'order_1',
      argv: ['python', 'build.py'],
      files: [{ path: 'build.py', content: "print('revised')" }],
    });
    expect(readFileSync(join(root, 'order_1', 'build.py'), 'utf8')).toBe("print('revised')");
  });

  it('rejects duplicate probe names instead of miscounting them as a passing startup check', async () => {
    const root = temporaryDirectory();
    const runContainer = vi.fn(async () => ({
      exitCode: 0,
      stdout: JSON.stringify({ probes: Array.from({ length: 5 }, () => ({ name: 'inside-write', succeeded: true })) }),
      stderr: '',
      durationMs: 10,
    }));
    const service = new WorkspaceExecService({ workspaceRoot: root, runContainer });

    await expect(service.selfCheck()).resolves.toMatchObject({ available: false, passed: 0, total: 5 });
    await expect(service.execute({ orderId: 'order_1', argv: ['python', '-c', 'print(1)'], files: [] }))
      .rejects.toThrow('执行能力不可用：本机网络隔离未生效');
  });

  it('rejects traversal before writing any staged input', async () => {
    const root = temporaryDirectory();
    const service = new WorkspaceExecService({ workspaceRoot: root, runContainer: vi.fn(async () => passingProbeResult()) });
    await service.selfCheck();

    await expect(service.execute({
      orderId: 'order_1', argv: ['python', 'build.py'], files: [{ path: '../outside.py', content: 'bad' }],
    })).rejects.toThrow(/workspace/i);
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
    durationMs: 10,
  };
}

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'hummer-workspace-exec-'));
  directories.push(directory);
  return directory;
}
