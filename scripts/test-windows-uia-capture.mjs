import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import {
  emitGate, finishedCheck, parseGateArgs, repositoryRoot, runVitest, usageFailure,
} from './support/gate-runner.mjs';

const parsed = parseGateArgs(process.argv.slice(2), []);
if (parsed.unknown.length || parsed.modes.length > 0 || parsed.dryRun) {
  usageFailure('windows-uia-capture', '[default]', parsed.unknown.length ? parsed.unknown : parsed.dryRun ? ['--dry-run is not supported'] : parsed.modes);
} else if (process.platform !== 'win32') {
  emitGate({
    gate: 'windows-uia-capture', mode: 'default', status: 'failed',
    reason: 'The real Windows UIAutomation gate must run on Windows.',
  });
} else {
  const core = runVitest({
    file: [
      'apps/desktop/src/windows-uia-capture.test.ts',
      'apps/desktop/src/demo-session-uia-capture.test.ts',
      'apps/desktop/src/demo-session-ipc.test.ts',
    ],
    pattern: 'WINDOWS-UIA|DEMO-SESSION-IPC',
    cwd: repositoryRoot,
    config: 'vitest.config.ts',
  });
  const ui = runVitest({
    file: ['src/features/demo-session/DemoSessionPage.test.tsx'],
    pattern: 'DEMO-SESSION-UI',
    cwd: repositoryRoot,
    config: 'vitest.ui.config.ts',
  });
  const config = run(process.execPath, [resolve(repositoryRoot, 'packages/config/scripts/generate.mjs')]);
  const desktopBuild = run(process.execPath, [
    resolve(repositoryRoot, 'node_modules/typescript/bin/tsc'), '-b', resolve(repositoryRoot, 'apps/desktop'),
  ]);
  const real = run(process.execPath, [resolve(repositoryRoot, 'scripts/e2e-windows-uia-capture.mjs')]);
  const realEvidence = parseLastJson(real.stdout);
  const checks = [
    finishedCheck('strict-adapter-persistence-ipc', core, [
      'explicit PID and exact-title validation',
      'current authenticated DemoSession boundary',
      'paused, outside-boundary and cross-session zero-write behavior',
      'production IPC without renderer synthetic injection',
    ], 12),
    finishedCheck('desktop-control-surface', ui, [
      'human-entered PID and exact title',
      'one-shot capture control',
      'honest no-screen/no-video/no-upload disclosure',
    ], 1),
    finishedCheck('generated-config', config, ['generated Desktop config is current']),
    finishedCheck('desktop-typescript-build', desktopBuild, ['Desktop production TypeScript compiles']),
    finishedCheck('real-windows-uia-fixture', real, [
      'self-built WinForms fixture on the interactive Windows desktop',
      'real Windows UIAutomation process/title/control-tree metadata',
      'wrong window, outside application, paused session and disappeared window write zero records',
      ...(realEvidence?.capture ? [`captured ${realEvidence.capture.nodeCount} local accessibility nodes`] : []),
    ], Number(realEvidence?.negativeCases ?? 0)),
  ];
  emitGate({
    gate: 'windows-uia-capture', mode: 'default',
    status: checks.every((check) => check.status === 'passed') ? 'passed' : 'failed',
    checks,
    assertions: (core.testSummary?.passed ?? 0) + (ui.testSummary?.passed ?? 0) + Number(realEvidence?.assertions ?? 0),
    negativeCases: 14 + Number(realEvidence?.negativeCases ?? 0),
    limitations: [
      'Captures Windows UIAutomation metadata only; no screenshot, video, raw keyboard text, input hook or upload exists.',
      'The fixture contains synthetic non-sensitive data and does not constitute a real expert acceptance run.',
      'This gate is local to one Windows machine and does not prove remote capture, distillation, replay or a second-machine workflow.',
    ],
  });
}

function run(command, args) {
  const outcome = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  return {
    command: [command, ...args].join(' '),
    exitCode: outcome.status ?? 1,
    stdout: String(outcome.stdout ?? ''),
    stderr: String(outcome.stderr ?? outcome.error?.message ?? ''),
    testSummary: null,
  };
}

function parseLastJson(value) {
  for (const line of String(value).trim().split(/\r?\n/).reverse()) {
    try { return JSON.parse(line); } catch { /* keep looking */ }
  }
  return null;
}
