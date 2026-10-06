import { emitGate, finishedCheck, repositoryRoot, runVitest, usageFailure } from './support/gate-runner.mjs';

const args = process.argv.slice(2);
if (args.length > 0) {
  usageFailure('tenancy', 'no arguments; the current gate is the mandatory P0 regression pair', args);
} else {
  runP0RegressionPair();
}

function runP0RegressionPair() {
  const definitions = [
    {
      id: 'TEN-P0-API-WORKORDER-BARE-ID',
      surface: 'API WorkOrder read/write by bare id',
      file: 'apps/api/work-orders/work-orders.test.ts',
      marker: '\\[TEN-P0-API-WORKORDER-BARE-ID\\]',
      expected: 'A tenant-B authenticated context cannot read or mutate tenant-A WorkOrder state by knowing its id.',
    },
    {
      id: 'TEN-P0-DESKTOP-SESSION-BARE-ID',
      surface: 'Desktop session projection/event read by bare session id',
      file: 'apps/desktop/src/persistence/runtime-event-store.test.ts',
      marker: '\\[TEN-P0-DESKTOP-SESSION-BARE-ID\\]',
      expected: 'A tenant-B authenticated context cannot read tenant-A session metadata or events by knowing its session id.',
    },
  ];

  const checks = definitions.map((definition) => {
    const run = runVitest({
      file: definition.file,
      pattern: definition.marker,
      cwd: repositoryRoot,
      config: 'vitest.config.ts',
    });
    const check = finishedCheck(definition.id, run, [definition.expected], 1);
    const proved = check.status === 'passed'
      && check.tests?.passed >= 1
      && check.tests?.failed === 0;
    return {
      ...check,
      status: proved ? 'passed' : 'failed',
      surface: definition.surface,
      expected: definition.expected,
      p0: true,
    };
  });

  const failed = checks.filter((check) => check.status !== 'passed');
  emitGate({
    gate: 'tenancy',
    mode: 'p0-regression',
    status: failed.length === 0 ? 'passed' : 'failed',
    checks,
    assertions: checks.reduce((total, check) => total + (check.tests?.passed ?? 0), 0),
    negativeCases: checks.filter((check) => check.status === 'passed').length,
    limitations: [
      'This emergency gate is intentionally limited to the two confirmed P0 crossings.',
      'The remaining 19-item tenancy matrix, chain heads, quota, export, WebSocket, recording, cache, and temporary-path surfaces are not represented as passed.',
    ],
    reason: failed.length === 0
      ? undefined
      : `P0 tenancy regression not proved: ${failed.map((check) => check.id).join(', ')}`,
  });
}
