import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const EXIT = Object.freeze({ passed: 0, planned: 0, failed: 1, pending: 2 });

export function parseGateArgs(argv, allowedModes) {
  const args = new Set(argv);
  const dryRun = args.delete('--dry-run');
  const modes = allowedModes.filter((mode) => args.delete(`--${mode}`));
  const soak = [...args].find((arg) => arg.startsWith('--soak='));
  if (soak) args.delete(soak);
  if (soak) modes.push(`soak=${soak.slice('--soak='.length)}`);
  return { dryRun, modes, unknown: [...args] };
}

export function runVitest({ file, pattern }) {
  const vitest = resolve(repositoryRoot, 'node_modules', 'vitest', 'vitest.mjs');
  const result = run(process.execPath, [vitest, 'run', file, '--config', 'vitest.config.ts', '-t', pattern, '--reporter=json'], {
    cwd: resolve(repositoryRoot, 'apps', 'relay'),
  });
  const summary = parseLastJson(result.stdout);
  return {
    ...result,
    testSummary: summary ? {
      total: summary.numTotalTests,
      passed: summary.numPassedTests,
      failed: summary.numFailedTests,
      pending: summary.numPendingTests,
    } : null,
  };
}

export function runNodeTests({ file, pattern }) {
  const args = ['--test'];
  if (pattern) args.push(`--test-name-pattern=${pattern}`);
  args.push(resolve(repositoryRoot, file));
  const result = run(process.execPath, args, { cwd: repositoryRoot });
  const total = numberFromTap(result.stdout, 'tests');
  const passed = numberFromTap(result.stdout, 'pass');
  const failed = numberFromTap(result.stdout, 'fail');
  return { ...result, testSummary: { total, passed, failed, pending: null } };
}

export function plannedCheck(id, command, evidence) {
  return { id, status: 'planned', command, evidence };
}

export function finishedCheck(id, runResult, evidence, negativeCases = 0) {
  return {
    id,
    status: runResult.exitCode === 0 ? 'passed' : 'failed',
    command: runResult.command.replaceAll(repositoryRoot, '<REPOSITORY_ROOT>'),
    exitCode: runResult.exitCode,
    tests: runResult.testSummary,
    negativeCases,
    evidence,
    stdoutTail: tail(runResult.stdout),
    stderrTail: tail(runResult.stderr),
  };
}

export function emitGate({ gate, mode, status, checks = [], assertions = 0, negativeCases = 0, limitations = [], reason }) {
  const result = {
    schema: 'hummer.executable-gate-result',
    version: 1,
    gate,
    mode,
    status,
    capturedAt: new Date().toISOString(),
    toolchain: { node: process.version, platform: process.platform, arch: process.arch },
    assertions,
    negativeCases,
    checks,
    limitations,
    ...(reason ? { reason } : {}),
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = EXIT[status] ?? EXIT.failed;
}

export function usageFailure(gate, usage, unknown = []) {
  emitGate({
    gate,
    mode: 'invalid',
    status: 'failed',
    reason: unknown.length ? `Unknown arguments: ${unknown.join(', ')}` : `Select exactly one mode: ${usage}`,
  });
}

function run(command, args, { cwd }) {
  const outcome = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  return {
    command: [command, ...args].join(' '),
    exitCode: outcome.status ?? 1,
    stdout: String(outcome.stdout ?? ''),
    stderr: String(outcome.stderr ?? outcome.error?.message ?? ''),
  };
}

function parseLastJson(value) {
  const lines = String(value).trim().split(/\r?\n/).reverse();
  for (const line of lines) {
    try { return JSON.parse(line); } catch { /* keep looking */ }
  }
  return null;
}

function numberFromTap(value, label) {
  const match = String(value).match(new RegExp(`^(?:#|ℹ) ${label} (\\d+)$`, 'm'));
  return match ? Number(match[1]) : null;
}

function tail(value, max = 2_000) {
  const normalized = String(value ?? '').trim().replaceAll(repositoryRoot, '<REPOSITORY_ROOT>');
  return normalized.length <= max ? normalized : normalized.slice(-max);
}
