import {
  emitGate, finishedCheck, parseGateArgs, plannedCheck, runVitest, usageFailure,
} from './support/gate-runner.mjs';

const parsed = parseGateArgs(process.argv.slice(2), ['approval-timeout', 'revoke', 'process-kill']);
if (parsed.unknown.length || parsed.modes.length !== 1) {
  usageFailure('chaos', '--approval-timeout | --revoke | --process-kill', parsed.unknown);
} else if (parsed.modes[0] === 'approval-timeout') {
  approvalTimeout(parsed.dryRun);
} else if (parsed.modes[0] === 'revoke') {
  revoke(parsed.dryRun);
} else {
  pendingMode(parsed.modes[0], parsed.dryRun);
}

function approvalTimeout(dryRun) {
  const evidence = ['expired approval decision is rejected for both Memory and SQLite stores'];
  if (dryRun) {
    emitGate({ gate: 'chaos', mode: 'approval-timeout', status: 'planned', checks: [plannedCheck('approval-expiry', 'vitest fleet-service.test.ts -t <approval expiry case>', evidence)], limitations: ['Dry run: no virtual-clock assertion was executed.'] });
    return;
  }
  const run = runVitest({ file: 'test/fleet-service.test.ts', pattern: 'rejects cross-binding, expanded scope, expiry' });
  const check = finishedCheck('approval-expiry', run, evidence, 2);
  emitGate({
    gate: 'chaos', mode: 'approval-timeout', status: check.status, checks: [check],
    assertions: run.testSummary?.passed ?? 0, negativeCases: 2,
    limitations: ['Uses an injected deterministic Relay clock; no process was killed and no wall-clock wait was hidden.'],
  });
}

function revoke(dryRun) {
  const evidence = [
    'Relay grant authorization rejects the old token immediately after revocation',
    'the next authenticated Fastify request fails without reflecting bearer material',
  ];
  if (dryRun) {
    emitGate({ gate: 'chaos', mode: 'revoke', status: 'planned', checks: [plannedCheck('grant-revocation-checkpoint', 'vitest badge-auth.test.ts fastify-transport.test.ts -t <revocation cases>', evidence)], limitations: ['Dry run: no revocation assertion was executed.'] });
    return;
  }
  const registry = runVitest({ file: 'test/badge-auth.test.ts', pattern: 'revokes immediately' });
  const transport = runVitest({ file: 'test/fastify-transport.test.ts', pattern: 'grant revocation effective' });
  const checks = [
    finishedCheck('registry-revocation', registry, evidence, 1),
    finishedCheck('transport-revocation-checkpoint', transport, evidence, 1),
  ];
  emitGate({
    gate: 'chaos', mode: 'revoke',
    status: checks.every((check) => check.status === 'passed') ? 'passed' : 'failed',
    checks,
    assertions: checks.reduce((sum, check) => sum + (check.tests?.passed ?? 0), 0),
    negativeCases: 2,
    limitations: ['This proves revocation at the next Relay authorization checkpoint; an already-running node executor still needs an in-flight checkpoint hook.'],
  });
}

function pendingMode(mode, dryRun) {
  const reasons = {
    'process-kill': 'No supervised multi-process kill/restart harness exists in the delegated baseline.',
  };
  const check = plannedCheck(mode, mode === 'revoke' ? '<requires durable token revocation API and audit proof>' : '<requires supervised Relay/Node child processes and crash evidence>', []);
  emitGate({
    gate: 'chaos', mode, status: dryRun ? 'planned' : 'pending', checks: [check],
    limitations: [reasons[mode], 'No substitute unit assertion is reported as a chaos pass.'],
    reason: dryRun ? 'Dry run only: pending prerequisite is declared without execution.' : reasons[mode],
  });
}
