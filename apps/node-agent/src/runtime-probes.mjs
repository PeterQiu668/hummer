import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { NodeAgentError } from './errors.mjs';
import { assertExactRecord, requireNonEmptyString } from './validation.mjs';

const execFileAsync = promisify(execFile);
const PROVIDER_EXECUTABLES = Object.freeze({ codex: 'codex', claude: 'claude', deepseek: 'deepseek' });
const SUPPORTED_PROVIDERS = new Set(['codex', 'claude', 'deepseek', 'cli-other']);

/** @typedef {'codex'|'claude'|'deepseek'|'cli-other'} RuntimeProvider */
/**
 * @typedef {{provider: RuntimeProvider, executable?: string}} ProbeRequest
 * @typedef {{exitCode: number, stdout: string, stderr: string}} VersionResult
 * @typedef {{resolve(executable: string): Promise<string|null>, version(path: string): Promise<VersionResult>}} ProbeRunner
 * @typedef {{provider: RuntimeProvider, executable: string, status: 'available'|'missing'|'unavailable', path: string|null, version: string|null, detail: string}} RuntimeProbeResult
 */

/** @returns {ProbeRunner} */
export function createSystemProbeRunner() {
  return {
    async resolve(executable) {
      try {
        const locator = process.platform === 'win32' ? 'where.exe' : 'which';
        const { stdout } = await execFileAsync(locator, [executable], { windowsHide: true, timeout: 5_000 });
        const matches = stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
        return selectResolvedPath(matches, process.platform);
      } catch {
        return null;
      }
    },
    async version(path) {
      try {
        const isWindowsScript = process.platform === 'win32' && /\.(?:cmd|bat|ps1)$/iu.test(path);
        const command = isWindowsScript ? 'powershell.exe' : path;
        const args = isWindowsScript
          ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '& $env:HUMMER_RUNTIME_PROBE_PATH --version']
          : ['--version'];
        const { stdout, stderr } = await execFileAsync(command, args, {
          windowsHide: true,
          timeout: 30_000,
          env: probeEnvironment(isWindowsScript ? path : undefined),
        });
        return { exitCode: 0, stdout, stderr };
      } catch (error) {
        const failure = /** @type {{code?: unknown, stdout?: unknown, stderr?: unknown}} */ (error);
        return {
          exitCode: typeof failure.code === 'number' ? failure.code : 1,
          stdout: typeof failure.stdout === 'string' ? failure.stdout : '',
          stderr: typeof failure.stderr === 'string' ? failure.stderr : 'Version command failed',
        };
      }
    },
  };
}

/** @param {string[]} matches @param {NodeJS.Platform} platform */
export function selectResolvedPath(matches, platform) {
  if (platform === 'win32') {
    return matches.find((path) => /\.(?:exe|com|cmd|bat|ps1)$/iu.test(path))
      ?? matches[0]
      ?? null;
  }
  return matches[0] ?? null;
}

/** @param {ProbeRequest} request @param {ProbeRunner} [runner] @returns {Promise<RuntimeProbeResult>} */
export async function probeRuntime(request, runner = createSystemProbeRunner()) {
  const record = assertExactRecord(request, ['provider', 'executable'], 'invalid_probe_request', 'runtime probe request');
  const providerName = record.provider;
  if (typeof providerName !== 'string' || !SUPPORTED_PROVIDERS.has(providerName)) {
    throw new NodeAgentError('unsupported_provider', `Unsupported runtime provider: ${String(providerName)}`);
  }
  const provider = /** @type {RuntimeProvider} */ (providerName);
  const executable = provider === 'cli-other'
    ? requireNonEmptyString(record.executable, 'invalid_probe_request', 'cli-other executable')
    : PROVIDER_EXECUTABLES[provider];
  const path = await runner.resolve(executable);
  if (!path) {
    return { provider, executable, status: 'missing', path: null, version: null, detail: 'Executable was not found on PATH' };
  }
  const versionResult = await runner.version(path);
  if (versionResult.exitCode !== 0) {
    return {
      provider,
      executable,
      status: 'unavailable',
      path,
      version: null,
      detail: `Version command exited with exit code ${versionResult.exitCode}: ${sanitizeDetail(versionResult.stderr)}`,
    };
  }
  const version = firstLine(versionResult.stdout || versionResult.stderr);
  if (!version) {
    return { provider, executable, status: 'unavailable', path, version: null, detail: 'Version command returned no version text' };
  }
  return { provider, executable, status: 'available', path, version, detail: 'Runtime is available' };
}

/**
 * @param {{cliOtherExecutable?: string}} [options]
 * @param {ProbeRunner} [runner]
 * @returns {Promise<RuntimeProbeResult[]>}
 */
export async function probeAllRuntimes(options = {}, runner = createSystemProbeRunner()) {
  assertExactRecord(options, ['cliOtherExecutable'], 'invalid_probe_request', 'probe options');
  const requests = /** @type {ProbeRequest[]} */ ([
    { provider: 'codex' },
    { provider: 'claude' },
    { provider: 'deepseek' },
  ]);
  if (options.cliOtherExecutable) requests.push({ provider: 'cli-other', executable: options.cliOtherExecutable });
  const results = await Promise.all(requests.map((request) => probeRuntime(request, runner)));
  if (!options.cliOtherExecutable) {
    results.push({
      provider: 'cli-other',
      executable: '',
      status: 'missing',
      path: null,
      version: null,
      detail: 'No cli-other executable was configured',
    });
  }
  return results;
}

/** @param {string} text */
function firstLine(text) {
  return text.split(/\r?\n/u).map((line) => line.trim()).find(Boolean) ?? '';
}

/** @param {string} text */
function sanitizeDetail(text) {
  const value = firstLine(text);
  return value ? value.slice(0, 240) : 'no diagnostic text';
}

/** @param {string|undefined} scriptPath */
function probeEnvironment(scriptPath) {
  /** @type {NodeJS.ProcessEnv} */
  const clean = {};
  for (const key of ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE']) {
    if (process.env[key] !== undefined) clean[key] = process.env[key];
  }
  if (scriptPath) clean.HUMMER_RUNTIME_PROBE_PATH = scriptPath;
  return clean;
}
