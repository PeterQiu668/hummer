import {
  emitGate, finishedCheck, parseGateArgs, repositoryRoot, runVitest, usageFailure,
} from './support/gate-runner.mjs';

const parsed = parseGateArgs(process.argv.slice(2), []);
if (parsed.unknown.length || parsed.modes.length > 0 || parsed.dryRun) {
  usageFailure('demo-session-ui', '[default]', parsed.unknown.length ? parsed.unknown : parsed.dryRun ? ['--dry-run is not supported'] : parsed.modes);
} else {
  const ipc = runVitest({
    file: ['apps/desktop/src/demo-session-ipc.test.ts'],
    pattern: 'DEMO-SESSION-IPC',
    cwd: repositoryRoot,
    config: 'vitest.config.ts',
  });
  const ui = runVitest({
    file: ['src/features/demo-session/DemoSessionPage.test.tsx'],
    pattern: 'DEMO-SESSION-UI',
    cwd: repositoryRoot,
    config: 'vitest.ui.config.ts',
  });
  const checks = [
    finishedCheck('desktop-ipc', ipc, ['auth-derived tenant and human ownership', 'test-only synthetic injector', 'pause/end/export/cross-tenant negative cases', 'segment purge and rechain'], 7),
    finishedCheck('renderer-control-surface', ui, ['explicit app/window allowlist', 'adapter-not-connected disclosure', 'delete confirmation', 'redaction-first review projection'], 4),
  ];
  emitGate({
    gate: 'demo-session-ui', mode: 'default',
    status: checks.every((check) => check.status === 'passed') ? 'passed' : 'failed',
    checks,
    assertions: (ipc.testSummary?.passed ?? 0) + (ui.testSummary?.passed ?? 0),
    negativeCases: 7,
    limitations: [
      'No operating-system capture adapter, screenshot/video bytes, raw keystrokes, GUI grounding, upload, distillation or replay.',
      'The production preload exposes no synthetic metadata injection API.',
      'This gate does not claim AC-P2-DIST-01.',
    ],
  });
}
