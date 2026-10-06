import {
  emitGate, finishedCheck, parseGateArgs, plannedCheck, repositoryRoot, runVitest, usageFailure,
} from './support/gate-runner.mjs';

const parsed = parseGateArgs(process.argv.slice(2), []);
if (parsed.unknown.length || parsed.modes.length > 0) {
  usageFailure('diagnostics', '[--dry-run]', parsed.unknown);
} else if (parsed.dryRun) {
  emitGate({
    gate: 'diagnostics', mode: 'redacted-zip', status: 'planned',
    checks: [plannedCheck(
      'diagnostic-bundle',
      'vitest apps/desktop/src/diagnostic-pack.test.ts apps/desktop/src/diagnostic-bundle.test.ts',
      ['auditable manifest and summary', 'independent digest verification', 'token/database/DemoSession exclusion'],
    )],
    limitations: ['Dry run: no diagnostic bundle was generated or verified.'],
  });
} else {
  const run = runVitest({
    file: ['apps/desktop/src/diagnostic-pack.test.ts', 'apps/desktop/src/diagnostic-bundle.test.ts'],
    pattern: 'diagnostic|DIAGNOSTIC-',
    cwd: repositoryRoot,
    config: 'vitest.config.ts',
  });
  const check = finishedCheck('diagnostic-bundle', run, [
    'ZIP contains only manifest, summary, and inventory-listed UTF-8 files',
    'tenant and node references are hashed',
    'credentials, tokens, SQLite bytes, database paths, and DemoSession/recording bytes are rejected',
    'unlisted archive entries and digest mismatches fail verification',
  ], 13);
  emitGate({
    gate: 'diagnostics', mode: 'redacted-zip', status: check.status,
    checks: [check], assertions: run.testSummary?.passed ?? 0, negativeCases: 13,
    limitations: [
      'This is a local library and executable gate; packaged Electron UI export wiring remains pending.',
      'The verifier accepts only bounded UTF-8 diagnostic files and intentionally rejects binary attachments.',
    ],
  });
}
