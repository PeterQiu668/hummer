import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { requiredCodexCliVersion } from './engine-profiles.js';

export interface RuntimeEnvironmentStatus {
  ready: boolean;
  node: { available: true; version: string; source: 'embedded' };
  codex: {
    available: boolean;
    compatible: boolean;
    expectedVersion: string;
    version?: string;
    executable?: string;
    issue?: string;
  };
}

interface DoctorDependencies {
  platform: NodeJS.Platform;
  nodeVersion: string;
  exists(path: string): boolean;
  runVersion(executable: string): { status: number | null; stdout: string; stderr: string };
}

const defaultDependencies: DoctorDependencies = {
  platform: process.platform,
  nodeVersion: process.versions.node,
  exists: existsSync,
  runVersion: (executable) => {
    const result = spawnSync(executable, ['--version'], {
      encoding: 'utf8', windowsHide: true,
      shell: process.platform === 'win32' && executable.endsWith('.cmd'),
      timeout: 30_000,
    });
    return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? result.error?.message ?? '' };
  },
};

export function inspectRuntimeEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
  dependencies: DoctorDependencies = defaultDependencies,
): RuntimeEnvironmentStatus {
  const expectedVersion = requiredCodexCliVersion();
  const executable = findCodexExecutable(environment, dependencies);
  const node = { available: true as const, version: dependencies.nodeVersion, source: 'embedded' as const };
  if (!executable) {
    return {
      ready: false,
      node,
      codex: {
        available: false, compatible: false, expectedVersion,
        issue: `Codex CLI \u672a\u5b89\u88c5\u3002HUMMER \u9700\u8981 ${expectedVersion} \u7248\u672c\u624d\u80fd\u6267\u884c\u771f\u5b9e\u4efb\u52a1\u3002`,
      },
    };
  }
  const result = dependencies.runVersion(executable);
  const version = /codex-cli\s+(\S+)/.exec(result.stdout)?.[1];
  if (result.status !== 0 || !version) {
    return {
      ready: false,
      node,
      codex: {
        available: true, compatible: false, expectedVersion, executable,
        issue: '\u5df2\u627e\u5230 Codex CLI\uff0c\u4f46\u65e0\u6cd5\u8bfb\u53d6\u7248\u672c\u3002\u8bf7\u6309\u5b89\u88c5\u6307\u5f15\u91cd\u65b0\u5b89\u88c5\u3002',
      },
    };
  }
  const compatible = version === expectedVersion;
  return {
    ready: compatible,
    node,
    codex: {
      available: true, compatible, expectedVersion, version, executable,
      ...(!compatible ? { issue: `Codex CLI \u7248\u672c\u4e3a ${version}\uff0cHUMMER \u9700\u8981 ${expectedVersion}\u3002` } : {}),
    },
  };
}

function findCodexExecutable(environment: NodeJS.ProcessEnv, dependencies: DoctorDependencies): string | undefined {
  if (environment.HUMMER_CODEX_PATH) return dependencies.exists(environment.HUMMER_CODEX_PATH) ? environment.HUMMER_CODEX_PATH : undefined;
  if (dependencies.platform !== 'win32') return 'codex';
  return (environment.PATH ?? '').split(delimiter)
    .filter(Boolean)
    .map((entry) => join(entry, 'codex.cmd'))
    .find(dependencies.exists);
}
