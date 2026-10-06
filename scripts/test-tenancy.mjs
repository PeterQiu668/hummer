import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { repositoryRoot, usageFailure } from './support/gate-runner.mjs';

const args = process.argv.slice(2);
if (args.length > 0) {
  usageFailure('tenancy', 'no arguments; runs the complete confirmed P0 regression set', args);
} else {
  runP0RegressionGate();
}

function runP0RegressionGate() {
  const definitions = {
    rootNode: [
      marker('TEN-P0-API-WORKORDER-BARE-ID', 'apps/api/work-orders/work-orders.test.ts'),
      marker('TEN-P0-DESKTOP-SESSION-BARE-ID', 'apps/desktop/src/persistence/tenant-read-isolation.test.ts'),
      marker('TEN-P0B-DESKTOP-IDENTIFIERS', 'apps/desktop/src/persistence/tenant-identifier-isolation.test.ts'),
      marker('TEN-P0C-DESKTOP-SIDE-CHANNELS', 'apps/desktop/src/persistence/tenant-side-channel-isolation.test.ts'),
      marker('TEN-P0-DESKTOP-RUNTIME-IPC', 'apps/desktop/src/runtime-ipc-tenancy.test.ts'),
      marker('TEN-P0G-IDENTITY-BOUNDARY', 'apps/desktop/src/persistence/identity-tenant-boundary.test.ts'),
    ],
    rootUi: [
      marker('TEN-P0E-RENDERER-CACHE', 'src/features/identity/rendererTenantBoundary.test.tsx'),
    ],
    relay: [
      marker('TEN-P0D-RELAY-SURFACES', 'test/relay-surfaces-tenancy.test.ts'),
      marker('TEN-P0-RELAY-MULTITENANT-GRANT', 'test/tenant-boundary.test.ts'),
    ],
    node: [
      marker('TEN-P0F-NODE-AGENT-BOUNDARY', 'apps/node-agent/test/tenancy-boundary.test.mjs'),
    ],
  };

  const node22 = Number(process.versions.node.split('.')[0]) === 22;
  const groups = [
    mergeVitestGroups('root', [
      runVitestGroup({
        id: 'root-node',
        cwd: repositoryRoot,
        config: 'vitest.config.ts',
        definitions: definitions.rootNode,
      }),
      runVitestGroup({
        id: 'root-ui',
        cwd: repositoryRoot,
        config: 'vitest.ui.config.ts',
        definitions: definitions.rootUi,
      }),
    ]),
    runVitestGroup({
      id: 'relay',
      cwd: resolve(repositoryRoot, 'apps', 'relay'),
      config: 'vitest.config.ts',
      definitions: definitions.relay,
    }),
    runNodeGroup({
      id: 'node-agent',
      definitions: definitions.node,
    }),
  ];

  if (!node22) {
    for (const group of groups) {
      group.status = 'failed';
      group.toolchain.compatible = false;
      group.toolchain.reason = `Node 22 is required; gate ran under ${process.version}.`;
    }
  }

  const checks = groups.flatMap((group) => group.markers.map((entry) => ({
    ...entry,
    runnerGroup: group.id,
    command: group.command,
    exitCode: group.exitCode,
  })));
  const failed = checks.filter((check) => check.status !== 'passed');
  const status = node22 && groups.every((group) => group.status === 'passed') && failed.length === 0
    ? 'passed'
    : 'failed';

  emitTenancyGate({
    gate: 'tenancy',
    mode: 'confirmed-p0-regression',
    status,
    checks,
    assertions: groups.reduce((total, group) => total + group.passed, 0),
    negativeCases: groups.reduce((total, group) => total + group.negativeCases, 0),
    limitations: [
      'This is the executable regression set for the ten confirmed P0 tenant-boundary markers only.',
      'Passing this gate does not prove the complete 21-item W4 tenancy matrix or any surface without one of these behavior-test markers.',
      'A negative case is one selected behavior test that passed; it is not an estimate of assertions inside that test.',
      'Vitest tests outside the selected marker suites are excluded, including runner-reported skips caused only by the marker filter.',
    ],
    reason: status === 'passed'
      ? undefined
      : failureReason({ node22, groups, failed }),
    groups,
  });
}

function marker(id, file) {
  return { id, marker: `[${id}]`, file };
}

function runVitestGroup({ id, cwd, config, definitions }) {
  const vitest = resolve(repositoryRoot, 'node_modules', 'vitest', 'vitest.mjs');
  const pattern = definitions.map((definition) => escapeRegex(definition.marker)).join('|');
  const result = run(process.execPath, [
    vitest,
    'run',
    ...definitions.map((definition) => definition.file),
    '--config',
    config,
    '-t',
    pattern,
    '--reporter=json',
  ], cwd);
  const report = parseJsonReport(result.stdout);
  const assertions = report?.testResults?.flatMap((testResult) => testResult.assertionResults ?? []) ?? [];
  const markers = definitions.map((definition) => summarizeVitestMarker(definition, assertions));
  return finishGroup({
    id,
    runner: 'vitest-json',
    result,
    markers,
    reportParsed: report !== null,
  });
}

function runNodeGroup({ id, definitions }) {
  const pattern = definitions.map((definition) => escapeRegex(definition.marker)).join('|');
  const result = run(process.execPath, [
    '--test',
    `--test-name-pattern=${pattern}`,
    '--test-reporter=tap',
    ...definitions.map((definition) => resolve(repositoryRoot, definition.file)),
  ], repositoryRoot);
  const markers = definitions.map((definition) => summarizeTapMarker(definition, result.stdout));
  return finishGroup({
    id,
    runner: 'node-test-tap',
    result,
    markers,
    reportParsed: /^TAP version 13$/m.test(result.stdout),
  });
}

function mergeVitestGroups(id, parts) {
  const passed = parts.reduce((total, part) => total + part.passed, 0);
  const failed = parts.reduce((total, part) => total + part.failed, 0);
  const skipped = parts.reduce((total, part) => total + part.skipped, 0);
  return {
    id,
    status: parts.every((part) => part.status === 'passed') ? 'passed' : 'failed',
    passed,
    failed,
    skipped,
    negativeCases: passed,
    toolchain: {
      node: process.version,
      runner: 'vitest-json (node and jsdom configs)',
      compatible: Number(process.versions.node.split('.')[0]) === 22,
    },
    command: parts.map((part) => part.command),
    exitCode: parts.every((part) => part.exitCode === 0) ? 0 : 1,
    reportParsed: parts.every((part) => part.reportParsed),
    markers: parts.flatMap((part) => part.markers),
    runs: parts.map((part) => ({
      id: part.id,
      command: part.command,
      exitCode: part.exitCode,
      reportParsed: part.reportParsed,
    })),
  };
}

function finishGroup({ id, runner, result, markers, reportParsed }) {
  const passed = markers.reduce((total, entry) => total + entry.passed, 0);
  const failed = markers.reduce((total, entry) => total + entry.failed, 0);
  const skipped = markers.reduce((total, entry) => total + entry.skipped, 0);
  const markerFailure = markers.some((entry) => entry.status !== 'passed');
  return {
    id,
    status: result.exitCode === 0 && reportParsed && !markerFailure ? 'passed' : 'failed',
    passed,
    failed,
    skipped,
    negativeCases: passed,
    toolchain: {
      node: process.version,
      runner,
      compatible: Number(process.versions.node.split('.')[0]) === 22,
    },
    command: redact(result.command),
    exitCode: result.exitCode,
    reportParsed,
    markers,
    ...(result.exitCode === 0 && reportParsed ? {} : {
      stdoutTail: tail(result.stdout),
      stderrTail: tail(result.stderr),
    }),
  };
}

function summarizeVitestMarker(definition, assertions) {
  const selected = assertions.filter((assertion) => String(assertion.fullName ?? '').includes(definition.marker));
  const passed = selected.filter((assertion) => assertion.status === 'passed').length;
  const failed = selected.filter((assertion) => assertion.status === 'failed').length;
  const skipped = selected.filter((assertion) => !['passed', 'failed'].includes(assertion.status)).length;
  return summarizeMarker(definition, { passed, failed, skipped });
}

function summarizeTapMarker(definition, stdout) {
  const lines = String(stdout).split(/\r?\n/);
  const selected = lines.filter((line) => /^(?:ok|not ok) \d+ - /.test(line) && line.includes(definition.marker));
  const passed = selected.filter((line) => line.startsWith('ok ') && !/# (?:SKIP|TODO)\b/i.test(line)).length;
  const failed = selected.filter((line) => line.startsWith('not ok ')).length;
  const skipped = selected.filter((line) => /# (?:SKIP|TODO)\b/i.test(line)).length;
  return summarizeMarker(definition, { passed, failed, skipped });
}

function summarizeMarker(definition, { passed, failed, skipped }) {
  const status = passed > 0 && failed === 0 && skipped === 0 ? 'passed' : 'failed';
  const reasons = [];
  if (passed === 0) reasons.push('marker missing or selected zero passing tests');
  if (failed > 0) reasons.push(`${failed} selected test(s) failed`);
  if (skipped > 0) reasons.push(`${skipped} selected test(s) skipped or todo`);
  return {
    id: definition.id,
    file: definition.file,
    status,
    passed,
    failed,
    skipped,
    negativeCases: passed,
    ...(reasons.length > 0 ? { reason: reasons.join('; ') } : {}),
  };
}

function run(command, args, cwd) {
  const outcome = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });
  return {
    command: [command, ...args].join(' '),
    exitCode: outcome.status ?? 1,
    stdout: String(outcome.stdout ?? ''),
    stderr: String(outcome.stderr ?? outcome.error?.message ?? ''),
  };
}

function parseJsonReport(stdout) {
  const lines = String(stdout).trim().split(/\r?\n/).reverse();
  for (const line of lines) {
    try {
      const report = JSON.parse(line);
      if (Array.isArray(report.testResults)) return report;
    } catch {
      // Keep looking: a runner warning may precede or follow the JSON report.
    }
  }
  return null;
}

function failureReason({ node22, groups, failed }) {
  const reasons = [];
  if (!node22) reasons.push(`Node 22 required, received ${process.version}`);
  for (const group of groups.filter((entry) => entry.status !== 'passed')) {
    reasons.push(`${group.id} runner exit=${group.exitCode}, reportParsed=${group.reportParsed}`);
  }
  if (failed.length > 0) reasons.push(`marker failures: ${failed.map((entry) => entry.id).join(', ')}`);
  return reasons.join('; ');
}

function emitTenancyGate({ gate, mode, status, checks, assertions, negativeCases, limitations, reason, groups }) {
  const result = {
    schema: 'hummer.executable-gate-result',
    version: 1,
    gate,
    mode,
    status,
    capturedAt: new Date().toISOString(),
    toolchain: { node: process.version, platform: process.platform, arch: process.arch },
    assertions,
    negativeCases,
    checks,
    groups,
    limitations,
    ...(reason ? { reason } : {}),
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = status === 'passed' ? 0 : 1;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function redact(value) {
  return String(value).replaceAll(repositoryRoot, '<REPOSITORY_ROOT>');
}

function tail(value, max = 2_000) {
  const normalized = redact(String(value ?? '').trim());
  return normalized.length <= max ? normalized : normalized.slice(-max);
}
