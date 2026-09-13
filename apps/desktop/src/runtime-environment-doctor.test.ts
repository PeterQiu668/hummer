import { describe, expect, it, vi } from 'vitest';
import { inspectRuntimeEnvironment } from './runtime-environment-doctor.js';

describe('inspectRuntimeEnvironment', () => {
  it('reports the embedded Node runtime and a compatible Codex CLI', () => {
    const result = inspectRuntimeEnvironment({ PATH: 'C:\\tools' }, {
      platform: 'win32',
      nodeVersion: '22.22.3',
      exists: (path) => path === 'C:\\tools\\codex.cmd',
      runVersion: vi.fn().mockReturnValue({ status: 0, stdout: 'codex-cli 0.153.4\n', stderr: '' }),
    }, { available: true, checkedAt: '2026-09-13T13:00:00.000Z', runtime: 'docker', passed: 5, total: 5, issue: null, probes: [] });

    expect(result).toMatchObject({
      ready: true,
      node: { available: true, version: '22.22.3', source: 'embedded' },
      codex: { available: true, compatible: true, version: '0.153.4' },
      workspaceExec: { available: true, runtime: 'docker', passed: 5, total: 5 },
    });
  });

  it('reports a failed isolation self-check without claiming workspace execution is available', () => {
    const result = inspectRuntimeEnvironment({ PATH: 'C:\\tools' }, {
      platform: 'win32', nodeVersion: '22.22.3', exists: () => true,
      runVersion: vi.fn().mockReturnValue({ status: 0, stdout: 'codex-cli 0.153.4\n', stderr: '' }),
    }, { available: false, checkedAt: '2026-09-13T13:00:00.000Z', runtime: 'docker', passed: 4, total: 5, issue: '执行能力不可用：本机网络隔离未生效', probes: [] });

    expect(result.ready).toBe(true);
    expect(result.workspaceExec).toMatchObject({ available: false, passed: 4, total: 5 });
    expect(result.workspaceExec?.issue).toBe('执行能力不可用：本机网络隔离未生效');
  });

  it('returns a repairable missing status instead of throwing', () => {
    const result = inspectRuntimeEnvironment({ PATH: '' }, {
      platform: 'win32', nodeVersion: '22.22.3', exists: () => false,
      runVersion: vi.fn(),
    });

    expect(result.ready).toBe(false);
    expect(result.codex).toMatchObject({ available: false, compatible: false, expectedVersion: '0.153.4' });
    expect(result.codex.issue).toMatch(/Codex CLI/);
  });

  it('reports an incompatible version without exposing an exception stack', () => {
    const result = inspectRuntimeEnvironment({ HUMMER_CODEX_PATH: 'C:\\codex.cmd' }, {
      platform: 'win32', nodeVersion: '22.22.3', exists: () => true,
      runVersion: vi.fn().mockReturnValue({ status: 0, stdout: 'codex-cli 0.150.1\n', stderr: '' }),
    });

    expect(result.ready).toBe(false);
    expect(result.codex).toMatchObject({ available: true, compatible: false, version: '0.150.1' });
    expect(result.codex.issue).not.toContain('at ');
  });
});
