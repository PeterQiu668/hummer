import {
  emitGate, finishedCheck, parseGateArgs, plannedCheck, runVitest, usageFailure,
} from './support/gate-runner.mjs';

const parsed = parseGateArgs(process.argv.slice(2), ['idempotency']);
if (parsed.unknown.length || parsed.modes.length !== 1) {
  usageFailure('fleet', '--idempotency | --soak=100', parsed.unknown);
} else {
  const mode = parsed.modes[0];
  if (mode === 'idempotency') runIdempotency(parsed.dryRun);
  else if (mode === 'soak=100') runSoak(parsed.dryRun);
  else usageFailure('fleet', '--idempotency | --soak=100', mode.startsWith('soak=') ? [`--${mode} (only --soak=100 is supported)`] : []);
}

function runIdempotency(dryRun) {
  const evidence = [
    'duplicate enqueue returns the original result',
    'canonical mismatch under a reused key is rejected',
    'duplicate event delivery does not increase event count',
    '100 duplicate deliveries yield one task and one event sequence',
  ];
  if (dryRun) {
    emitGate({ gate: 'fleet', mode: 'idempotency', status: 'planned', checks: [plannedCheck('relay-idempotency', 'vitest fleet-service.test.ts -t <idempotency cases>', evidence)], limitations: ['Dry run: no assertions were executed.'] });
    return;
  }
  const run = runVitest({
    file: 'test/fleet-service.test.ts',
    pattern: 'duplicate delivery|reused task idempotency|deduplicates event delivery|100 deliveries|reused event idempotency',
  });
  const check = finishedCheck('relay-idempotency', run, evidence, 4);
  emitGate({
    gate: 'fleet', mode: 'idempotency', status: check.status,
    checks: [check], assertions: run.testSummary?.passed ?? 0, negativeCases: 4,
    limitations: ['This is a deterministic local Memory/SQLite service proof, not a two-machine transport proof.'],
  });
}

function runSoak(dryRun) {
  const evidence = ['100 duplicate deliveries are exercised against both local Memory and SQLite stores'];
  if (dryRun) {
    emitGate({ gate: 'fleet', mode: 'soak=100', status: 'planned', checks: [plannedCheck('local-soak-baseline', 'vitest fleet-service.test.ts -t "100 deliveries"', evidence)], limitations: ['Dry run: no assertions were executed.', 'A real two-machine soak remains required and will return pending when executed.'] });
    return;
  }
  const run = runVitest({ file: 'test/fleet-service.test.ts', pattern: '100 deliveries' });
  const check = finishedCheck('local-soak-baseline', run, evidence);
  emitGate({
    gate: 'fleet', mode: 'soak=100', status: check.status === 'failed' ? 'failed' : 'pending',
    checks: [check], assertions: run.testSummary?.passed ?? 0,
    limitations: [
      'Local single-process duplicate delivery passed, but it does not satisfy the required true two-machine soak.',
      'No remote endpoint, second enrolled node, or cross-process receipt was supplied to this gate.',
    ],
    reason: check.status === 'failed' ? 'The local prerequisite failed.' : 'True two-machine evidence is not implemented; refusing to report a pass.',
  });
}
