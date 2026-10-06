import {
  emitGate, finishedCheck, parseGateArgs, plannedCheck, repositoryRoot, runVitest, usageFailure,
} from './support/gate-runner.mjs';

const parsed = parseGateArgs(process.argv.slice(2), []);
if (parsed.unknown.length || parsed.modes.length > 0) {
  usageFailure('privacy', '[default]', parsed.unknown);
} else if (parsed.dryRun) {
  emitGate({
    gate: 'privacy',
    mode: 'default',
    status: 'pending',
    checks: [plannedCheck(
      'privacy-kernel',
      'vitest privacy.test.ts demo-session-store.test.ts -t PRIVACY-',
      ['strict DemoSession v1 contract', 'source allowlist and pause zero-write', 'segment purge and digest rechain', 'redaction egress gate', 'tenant isolation'],
    )],
    limitations: ['Dry run: no assertions were executed.'],
    reason: 'Privacy gate execution was explicitly skipped.',
  });
} else {
  const run = runVitest({
    file: [
      'packages/contracts/src/privacy/privacy.test.ts',
      'apps/desktop/src/persistence/demo-session-store.test.ts',
    ],
    pattern: 'PRIVACY-',
    cwd: repositoryRoot,
    config: 'vitest.config.ts',
  });
  const evidence = [
    'strict TypeBox/AJV/Standard Schema DemoSession validation',
    'source allowlist and paused capture produce zero records',
    'deleted segment records are purged while a tombstone and deletion audit remain',
    'segment digest chain is recomputed after deletion',
    'unredacted egress and cross-tenant access are rejected',
  ];
  const check = finishedCheck('privacy-kernel', run, evidence, 16);
  emitGate({
    gate: 'privacy',
    mode: 'default',
    status: check.status,
    checks: [check],
    assertions: run.testSummary?.passed ?? 0,
    negativeCases: 16,
    limitations: [
      'Synthetic metadata only: no screen, image, video, real keystroke, or real user recording is captured.',
      'No OS recorder UI, UIAutomation adapter, upload, grounding, distillation, or replay is implemented.',
      'This gate does not claim AC-P2-DIST-01 or AC-P2-DIST-05.',
    ],
  });
}
