import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import {
  emitGate, parseGateArgs, plannedCheck, repositoryRoot, usageFailure,
} from './support/gate-runner.mjs';

const parsed = parseGateArgs(process.argv.slice(2), []);
if (parsed.unknown.length || parsed.modes.length) {
  usageFailure('perf', '[--dry-run]', parsed.unknown);
} else if (parsed.dryRun) {
  emitGate({
    gate: 'perf', mode: 'local-memory-sqlite', status: 'planned',
    checks: [plannedCheck(
      'local-capacity',
      'vitest test/performance.test.ts',
      ['10 nodes, 100 tasks, and 10000 persisted events run independently on Memory and file-backed SQLite stores'],
    )],
    limitations: ['Dry run: no capacity assertions were executed.', 'This gate never claims true two-machine performance.'],
  });
} else {
  runPerformanceGate();
}

function runPerformanceGate() {
  const vitest = resolve(repositoryRoot, 'node_modules', 'vitest', 'vitest.mjs');
  const cwd = resolve(repositoryRoot, 'apps', 'relay');
  const args = [vitest, 'run', 'test/performance.test.ts', '--config', 'vitest.config.ts', '--reporter=verbose'];
  const outcome = spawnSync(process.execPath, args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });
  const stdout = String(outcome.stdout ?? '');
  const stderr = String(outcome.stderr ?? outcome.error?.message ?? '');
  const metrics = [...stdout.matchAll(/HUMMER_PERF_RESULT (\{[^\r\n]+\})/gu)]
    .map((match) => JSON.parse(match[1]));
  const metricPass = metrics.length === 2 && metrics.every((result) =>
    result.nodeCount === 10
    && result.taskCount === 100
    && result.eventCount === 10_000
    && result.persistedEventCount === 10_000
    && result.rejectedOverLimit === true
    && result.heartbeatP95Ms < 2_000
    && result.dispatchP95Ms < 5_000
    && result.eventWriteP95Ms < 50);
  const status = outcome.status === 0 && metricPass ? 'passed' : 'failed';
  emitGate({
    gate: 'perf', mode: 'local-memory-sqlite', status,
    assertions: metrics.length * 4,
    negativeCases: metrics.length,
    checks: [{
      id: 'local-capacity',
      status,
      command: [process.execPath, ...args].join(' ').replaceAll(repositoryRoot, '<REPOSITORY_ROOT>'),
      exitCode: outcome.status ?? 1,
      tests: { total: 2, passed: status === 'passed' ? 2 : 0, failed: status === 'passed' ? 0 : 2, pending: 0 },
      negativeCases: metrics.length,
      evidence: ['all 10000 events are read back; an out-of-sequence event is explicitly rejected for each store'],
      metrics,
      stdoutTail: tail(stdout),
      stderrTail: tail(stderr),
    }],
    limitations: [
      'This is a deterministic local single-process benchmark of Memory and file-backed SQLite, not a two-machine or network latency claim.',
      'Thresholds are release safety ceilings, not a production capacity forecast.',
    ],
    ...(metrics.length === 2 ? {} : { reason: `Expected two metric records, observed ${metrics.length}.` }),
  });
}

function tail(value, max = 2_000) {
  const normalized = String(value ?? '').trim().replaceAll(repositoryRoot, '<REPOSITORY_ROOT>');
  return normalized.length <= max ? normalized : normalized.slice(-max);
}
