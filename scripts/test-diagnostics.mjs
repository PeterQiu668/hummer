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
      'vitest apps/desktop/src/diagnostic-pack.test.ts apps/desktop/src/diagnostic-bundle.test.ts apps/desktop/src/diagnostic-export-*.test.ts',
      ['auditable manifest and summary', 'independent digest verification', 'token/database/DemoSession exclusion', 'trusted Desktop IPC and no-partial-output'],
    )],
    limitations: ['Dry run: no diagnostic bundle was generated or verified.'],
  });
} else {
  const run = runVitest({
    file: [
      'apps/desktop/src/diagnostic-pack.test.ts',
      'apps/desktop/src/diagnostic-bundle.test.ts',
      'apps/desktop/src/diagnostic-export-service.test.ts',
      'apps/desktop/src/diagnostic-export-host.test.ts',
    ],
    pattern: 'diagnostic|DIAGNOSTIC-',
    cwd: repositoryRoot,
    config: 'vitest.config.ts',
  });
  const check = finishedCheck('diagnostic-bundle', run, [
    'ZIP contains only manifest, summary, and inventory-listed UTF-8 files',
    'tenant and node references are hashed',
    'credentials, tokens, SQLite bytes, database paths, and DemoSession/recording bytes are rejected',
    'unlisted archive entries and digest mismatches fail verification',
    'trusted top-level renderer and authenticated tenant are required before file selection',
    'failed exports leave no partial file and existing files are never overwritten',
  ], 18);
  emitGate({
    gate: 'diagnostics', mode: 'redacted-zip', status: check.status,
    checks: [check], assertions: run.testSummary?.passed ?? 0, negativeCases: 18,
    limitations: [
      'This unit gate covers the library and trusted Desktop IPC seam; scripts/e2e-packaged-diagnostic-export.mjs separately executes and scans the compiled main/preload output.',
      'The verifier accepts only bounded UTF-8 diagnostic files and intentionally rejects binary attachments.',
    ],
  });
}
