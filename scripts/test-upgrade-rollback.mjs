import {
  emitGate, finishedCheck, parseGateArgs, plannedCheck, repositoryRoot, runVitest, usageFailure,
} from './support/gate-runner.mjs';

const parsed = parseGateArgs(process.argv.slice(2), []);
if (parsed.unknown.length || parsed.modes.length > 0) {
  usageFailure('upgrade-rollback', '[--dry-run]', parsed.unknown);
} else if (parsed.dryRun) {
  emitGate({
    gate: 'upgrade-rollback', mode: 'synthetic-local-install', status: 'planned',
    checks: [plannedCheck(
      'synthetic-upgrade-rollback',
      'vitest apps/desktop/src/release-upgrade.test.ts -t UPGRADE-',
      ['external package SHA-256', 'compatibility interval', 'atomic SQLite activity pointer', 'failure quarantine and rollback audit'],
    )],
    limitations: ['Dry run: no upgrade or rollback assertions were executed.'],
  });
} else {
  const run = runVitest({
    file: 'apps/desktop/src/release-upgrade.test.ts',
    pattern: 'UPGRADE-',
    cwd: repositoryRoot,
    config: 'vitest.config.ts',
  });
  const check = finishedCheck('synthetic-upgrade-rollback', run, [
    'package and payload SHA-256 are verified before activation',
    'incompatible and unmarked roots fail closed',
    'active release switch is committed in one SQLite transaction',
    'injected failures preserve the old release and quarantine only generated synthetic files',
    'rollback audit reasons redact token-shaped values',
  ], 6);
  emitGate({
    gate: 'upgrade-rollback', mode: 'synthetic-local-install', status: check.status,
    checks: [check], assertions: run.testSummary?.passed ?? 0, negativeCases: 6,
    limitations: [
      'The gate writes only to per-test synthetic directories carrying an explicit marker.',
      'No real HUMMER installation, registry key, NSIS package, user database, or user file is modified.',
      'A real signed NSIS cross-version upgrade and rollback on a clean Windows machine remains pending.',
    ],
  });
}
