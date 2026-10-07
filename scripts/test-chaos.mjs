import {
  emitGate, finishedCheck, parseGateArgs, plannedCheck, repositoryRoot, runNodeTests, runVitest, usageFailure,
} from './support/gate-runner.mjs';

const parsed = parseGateArgs(process.argv.slice(2), ['approval-timeout', 'revoke', 'process-kill']);
if (parsed.unknown.length || parsed.modes.length > 1) {
  usageFailure('chaos', '[no mode: full seven-fault gate] | --approval-timeout | --revoke | --process-kill', parsed.unknown);
} else if (parsed.modes.length === 0) {
  allFaults(parsed.dryRun);
} else if (parsed.modes[0] === 'approval-timeout') {
  approvalTimeout(parsed.dryRun);
} else if (parsed.modes[0] === 'revoke') {
  revoke(parsed.dryRun);
} else if (parsed.modes[0] === 'process-kill') {
  processKill(parsed.dryRun);
} else {
  pendingMode(parsed.modes[0], parsed.dryRun);
}

function allFaults(dryRun) {
  const specifications = [
    {
      id: 'process-kill',
      command: 'node --test scripts/test-process-kill.mjs',
      evidence: ['a real child process is forcibly killed and a fresh process fails closed on the durable in-doubt journal'],
      run: () => runNodeTests({ file: 'scripts/test-process-kill.mjs' }),
      negativeCases: 3,
    },
    {
      id: 'network-outage',
      command: 'node --test apps/node-agent/test/relay-http-client.test.mjs --test-name-pattern=<bounded reconnect exhaustion>',
      evidence: ['a broken SSE connection uses capped backoff, exhausts the configured attempt budget, and returns relay_reconnect_exhausted'],
      run: () => runNodeTests({
        file: 'apps/node-agent/test/relay-http-client.test.mjs',
        pattern: 'SSE reconnect uses capped exponential backoff and stops after the configured bound',
      }),
      negativeCases: 1,
    },
    {
      id: 'disk-full',
      command: 'node --test apps/node-agent/test/node-agent.test.mjs --test-name-pattern=<journal append failure>',
      evidence: ['an EIO while persisting the executing record prevents the executor side effect and leaves the claim recovery_required'],
      run: () => runNodeTests({
        file: 'apps/node-agent/test/node-agent.test.mjs',
        pattern: 'an executing journal append failure prevents the executor side effect',
      }),
      negativeCases: 1,
    },
    {
      id: 'db-lock',
      command: 'vitest test/chaos-gates.test.ts -t <SQLite write lock>',
      evidence: ['a real file-backed Relay SQLite write lock returns SQLITE_BUSY, persists no node, and succeeds only after the lock is released'],
      run: () => runVitest({
        file: 'test/chaos-gates.test.ts',
        pattern: 'fails explicitly on a sustained SQLite write lock without partially registering a node',
      }),
      negativeCases: 1,
    },
    {
      id: 'clock-jump',
      command: 'vitest test/fleet-service.test.ts -t <clock rollback and forward jump>',
      evidence: ['clock rollback is rejected without changing the accepted heartbeat and a forward jump expires then safely re-leases the task'],
      run: () => runVitest({
        file: 'test/fleet-service.test.ts',
        pattern: 'rejects relay clock rollback|treats a forward clock jump',
      }),
      negativeCases: 2,
    },
    {
      id: 'token-expired',
      command: 'node --test apps/node-agent/test/node-agent.test.mjs --test-name-pattern=<expired local grant>',
      evidence: ['an expired task-scoped grant is rejected before polling or execution and its plaintext token is absent from the error'],
      run: () => runNodeTests({
        file: 'apps/node-agent/test/node-agent.test.mjs',
        pattern: 'rejects an expired local grant and does not leak its token in the error',
      }),
      negativeCases: 1,
    },
    {
      id: 'version-mismatch',
      command: 'vitest apps/desktop/src/runtime-environment-doctor.test.ts -t <incompatible version>',
      evidence: ['the runtime doctor marks an incompatible Codex CLI unavailable for execution and returns a repairable message without a stack trace'],
      run: () => runVitest({
        file: 'apps/desktop/src/runtime-environment-doctor.test.ts',
        pattern: 'reports an incompatible version without exposing an exception stack',
        cwd: repositoryRoot,
        config: 'vitest.config.ts',
      }),
      negativeCases: 1,
    },
  ];
  if (dryRun) {
    emitGate({
      gate: 'chaos', mode: 'all-seven', status: 'planned',
      checks: specifications.map((item) => plannedCheck(item.id, item.command, item.evidence)),
      limitations: ['Dry run: no fault assertions were executed.'],
    });
    return;
  }
  const checks = specifications.map((item) => finishedCheck(item.id, item.run(), item.evidence, item.negativeCases));
  emitGate({
    gate: 'chaos', mode: 'all-seven',
    status: checks.every((check) => check.status === 'passed') ? 'passed' : 'failed',
    checks,
    assertions: checks.reduce((sum, check) => sum + (check.tests?.passed ?? 0), 0),
    negativeCases: specifications.reduce((sum, item) => sum + item.negativeCases, 0),
    limitations: [
      'Faults are deterministic local process, client, filesystem, and SQLite injections; they are not a true two-machine or production infrastructure chaos run.',
      'Disk-full is represented by an EIO at the durable journal boundary, not by filling the host volume.',
    ],
  });
}

function approvalTimeout(dryRun) {
  const evidence = [
    'a running two-step executor crosses the approval TTL and is rejected at its next explicit checkpoint',
    'the post-timeout side effect, events, receipt, and completed status remain at zero',
    'Relay reports the immutable approved grant as expired without rewriting its decision',
  ];
  if (dryRun) {
    emitGate({ gate: 'chaos', mode: 'approval-timeout', status: 'planned', checks: [
      plannedCheck('active-executor-expiry', 'node --test apps/node-agent/test/node-agent.test.mjs --test-name-pattern=<local approval expiry aborts a long executor>', evidence),
      plannedCheck('relay-expiry-projection', 'vitest test/approval-revocation.test.ts -t <reports expiry>', evidence),
    ], limitations: ['Dry run: no virtual-clock assertion was executed.'] });
    return;
  }
  const node = runNodeTests({
    file: 'apps/node-agent/test/node-agent.test.mjs',
    pattern: 'local approval expiry aborts a long executor at its next checkpoint without output',
  });
  const relay = runVitest({ file: 'test/approval-revocation.test.ts', pattern: 'reports expiry without rewriting the immutable decision' });
  const checks = [
    finishedCheck('active-executor-expiry', node, evidence, 3),
    finishedCheck('relay-expiry-projection', relay, evidence, 1),
  ];
  emitGate({
    gate: 'chaos', mode: 'approval-timeout',
    status: checks.every((check) => check.status === 'passed') ? 'passed' : 'failed', checks,
    assertions: checks.reduce((sum, check) => sum + (check.tests?.passed ?? 0), 0), negativeCases: 4,
    limitations: ['Uses injected deterministic Node and Relay clocks; no wall-clock wait is hidden and no already-finished side effect is claimed to be rolled back.'],
  });
}

function revoke(dryRun) {
  const evidence = [
    'a running two-step executor is revoked after step one and fails at its next explicit authorization checkpoint',
    'step two, later events, receipt, and completed status remain at zero',
    'Memory and SQLite atomically choose revocation over late completion and publish a tenant/node-scoped SSE hint',
  ];
  if (dryRun) {
    emitGate({ gate: 'chaos', mode: 'revoke', status: 'planned', checks: [
      plannedCheck('active-executor-revocation', 'node --test apps/node-agent/test/node-agent.test.mjs --test-name-pattern=<long executor stops at the next checkpoint>', evidence),
      plannedCheck('relay-revocation-cas-and-sse', 'vitest test/approval-revocation.test.ts -t <revocation cases>', evidence),
    ], limitations: ['Dry run: no revocation assertion was executed.'] });
    return;
  }
  const node = runNodeTests({
    file: 'apps/node-agent/test/node-agent.test.mjs',
    pattern: 'a long executor stops at the next checkpoint after authoritative approval revocation',
  });
  const relay = runVitest({
    file: 'test/approval-revocation.test.ts',
    pattern: 'atomically revokes an approved active task|serves authorization query and tenant/node-scoped approval.revoked SSE',
  });
  const checks = [
    finishedCheck('active-executor-revocation', node, evidence, 4),
    finishedCheck('relay-revocation-cas-and-sse', relay, evidence, 4),
  ];
  emitGate({
    gate: 'chaos', mode: 'revoke',
    status: checks.every((check) => check.status === 'passed') ? 'passed' : 'failed',
    checks,
    assertions: checks.reduce((sum, check) => sum + (check.tests?.passed ?? 0), 0),
    negativeCases: 8,
    limitations: ['Revocation prevents new work after the next explicit checkpoint; it does not claim rollback of a side effect that completed before that checkpoint.'],
  });
}

function processKill(dryRun) {
  const evidence = ['a real child process reaches executing, is forcibly killed, and a fresh process recovers the durable journal'];
  if (dryRun) {
    emitGate({ gate: 'chaos', mode: 'process-kill', status: 'planned', checks: [plannedCheck('node-process-kill-recovery', 'node --test scripts/test-process-kill.mjs', evidence)], limitations: ['Dry run: no process was started or killed.'] });
    return;
  }
  const run = runNodeTests({ file: 'scripts/test-process-kill.mjs' });
  const check = finishedCheck('node-process-kill-recovery', run, evidence, 3);
  emitGate({
    gate: 'chaos', mode: 'process-kill', status: check.status, checks: [check],
    assertions: run.testSummary?.passed ?? 0, negativeCases: 3,
    limitations: ['This is a supervised local Node Agent crash/restart proof; Relay failover and true cross-machine recovery remain separate gates.'],
  });
}
