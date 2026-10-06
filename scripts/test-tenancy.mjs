import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { repositoryRoot } from './support/gate-runner.mjs';

const MODES = new Set(['--chain-heads', '--quota', '--export']);
const args = process.argv.slice(2);

if (args.length > 1 || (args.length === 1 && !MODES.has(args[0]))) {
  emit({
    mode: 'invalid',
    status: 'failed',
    reason: args.length === 0 ? 'invalid invocation' : `Unknown arguments: ${args.join(', ')}`,
    limitations: [],
  }, 2);
} else if (Number(process.versions.node.split('.')[0]) !== 22) {
  emit({
    mode: modeName(args[0]),
    status: 'failed',
    reason: `Node 22 is required; received ${process.version}`,
    limitations: commonLimitations(),
  }, 1);
} else {
  const mode = modeName(args[0]);
  const definitions = definitionsFor(mode);
  const groups = runGroups(definitions);
  const checks = groups.flatMap((group) => group.checks.map((check) => ({
    ...check,
    runnerGroup: group.id,
    command: group.command,
    exitCode: group.exitCode,
  })));
  const passed = checks.filter((check) => check.status === 'passed').length;
  const status = passed === definitions.length && groups.every((group) => group.status === 'passed')
    ? 'passed'
    : 'failed';
  emit({
    mode,
    status,
    matrix: matrixSummary(definitions, checks),
    assertions: checks.reduce((total, check) => total + check.passed, 0),
    negativeCases: passed,
    checks,
    groups: groups.map(({ checks: _checks, ...group }) => group),
    limitations: limitationsFor(mode),
    ...(status === 'passed' ? {} : { reason: failureReason(groups, checks) }),
  }, status === 'passed' ? 0 : 1);
}

function modeName(arg) {
  if (arg === '--chain-heads') return 'chain-heads';
  if (arg === '--quota') return 'quota';
  if (arg === '--export') return 'export';
  return 'w4-21-case-matrix';
}

function definitionsFor(mode) {
  if (mode === 'chain-heads') return [
    relay('TEN-W4-SIDE-CHAIN-HEAD', 'chain-heads', 'Memory and SQLite tenant chain heads advance independently', 'test/governance.test.ts', 2),
  ];
  if (mode === 'quota') return [
    relay('TEN-W4-QUOTA-ADMISSION', 'quota', '80 percent warning, 100 percent task admission rejection, and in-chain rejection', 'test/governance.test.ts', 2),
    relay('TEN-W4-QUOTA-TOKEN-COST', 'quota', 'token and cost exhaustion reject new task admission', 'test/governance.test.ts', 2),
    relay('TEN-W4-QUOTA-FOREIGN-NODE', 'quota', 'foreign and unknown node quota references are indistinguishable', 'test/governance.test.ts', 2),
  ];
  if (mode === 'export') return [
    relay('TEN-W4-EXPORT-MANIFEST', 'export', 'Memory and SQLite manifests verify and hide foreign export references', 'test/governance.test.ts', 2),
    relay('TEN-W4-EXPORT-HTTP-TENANT', 'export', 'authenticated HTTP tenant overrides caller-supplied tenant and hides foreign export ids', 'test/governance.test.ts'),
    root('TEN-W4-EXPORT-DESKTOP', 'export', 'desktop export manifest is tenant-explicit and rejects foreign bytes', 'apps/desktop/src/persistence/tenant-governance-store.test.ts'),
  ];

  return [
    root('TEN-W4-READ-WORKORDER', 'read', 'WorkOrder and result ownership cannot be read by a foreign tenant', 'apps/api/work-orders/work-orders.test.ts', 1, 'TEN-P0-API-WORKORDER-BARE-ID'),
    root('TEN-W4-READ-DOMAIN-EVENT', 'read', 'session and DomainEvent projections are tenant-scoped', 'apps/desktop/src/persistence/tenant-read-isolation.test.ts', 1, 'TEN-P0-DESKTOP-SESSION-BARE-ID'),
    root('TEN-W4-READ-EVIDENCE-APPROVAL', 'read', 'foreign approval and evidence references are unavailable', 'apps/desktop/src/persistence/tenant-read-isolation.test.ts', 1, 'TEN-P0-DESKTOP-SESSION-BARE-ID'),
    root('TEN-W4-READ-RECEIPT-OUTCOME', 'read', 'receipt, outcome, and workspace-job references are tenant-opaque', 'apps/desktop/src/persistence/tenant-side-channel-isolation.test.ts', 1, 'TEN-P0C-DESKTOP-SIDE-CHANNELS'),
    relay('TEN-W4-READ-AUDIT-EXPORT', 'read', 'Memory and SQLite audit exports hide foreign references and bytes', 'test/governance.test.ts', 2, 'TEN-W4-RELAY-GOVERNANCE'),

    root('TEN-W4-WRITE-IDEMPOTENCY', 'write', 'foreign tenant cannot collide with or tamper with DomainEvent idempotency state', 'apps/desktop/src/persistence/tenant-identifier-isolation.test.ts', 1, 'TEN-P0B-DESKTOP-IDENTIFIERS'),
    root('TEN-W4-WRITE-CREATE-TASK', 'write', 'task creation rejects a tenant that differs from the authenticated command tenant', 'apps/api/work-orders/work-orders.test.ts'),
    root('TEN-W4-WRITE-POLICY', 'write', 'cross-tenant policy requests fail before role permissions apply', 'packages/contracts/src/tenancy/policy.test.ts', 1, 'TEN-ROLE-POLICY-MATRIX'),
    relay('TEN-W4-WRITE-GRANT-MANIFEST', 'write', 'Memory and SQLite reject an ungranted manifest tenant without persisting it', 'test/tenant-boundary.test.ts', 2, 'TEN-P0-RELAY-MULTITENANT-GRANT'),
    root('TEN-W4-WRITE-CONTROLLED-ARTIFACT', 'write', 'controlled writes and egress bytes stay in the owning tenant directory', 'apps/desktop/src/persistence/tenant-side-channel-isolation.test.ts', 1, 'TEN-P0C-DESKTOP-SIDE-CHANNELS'),

    root('TEN-W4-SURFACE-DESKTOP-IPC', 'surface', 'desktop IPC rejects anonymous and cross-tenant runtime control', 'apps/desktop/src/runtime-ipc-tenancy.test.ts', 1, 'TEN-P0-DESKTOP-RUNTIME-IPC'),
    relay('TEN-W4-SURFACE-HTTP', 'surface', 'HTTP foreign and unknown references have the same result', 'test/relay-surfaces-tenancy.test.ts', 1, 'TEN-P0D-RELAY-SURFACES'),
    relay('TEN-W4-SURFACE-SSE', 'surface', 'SSE payload and Last-Event-ID sequence stay inside the tenant-node stream', 'test/relay-surfaces-tenancy.test.ts', 1, 'TEN-P0D-RELAY-SURFACES'),
    relay('TEN-W4-SURFACE-QUEUE', 'surface', 'Memory and SQLite queue/event/approval/retry/audit references stay tenant-opaque', 'test/relay-surfaces-tenancy.test.ts', 2, 'TEN-P0D-RELAY-SURFACES'),

    nodeTest('TEN-W4-SIDE-OUTPUT-BYTES', 'side', 'foreign tenant facts cannot leave the node in receipt or artifact bytes', 'apps/node-agent/test/tenancy-boundary.test.mjs', 1, 'TEN-P0F-NODE-AGENT-BOUNDARY'),
    root('TEN-W4-SIDE-DIAGNOSTIC-PATHS', 'side', 'diagnostics redact tenant/path material and workspaces are partitioned', 'apps/desktop/src/persistence/tenant-side-channel-isolation.test.ts', 1, 'TEN-P0C-DESKTOP-SIDE-CHANNELS'),
    root('TEN-W4-SIDE-RUNTIME-TOKEN', 'side', 'event publication stops after the bound token changes tenant', 'apps/desktop/src/runtime-ipc-tenancy.test.ts', 1, 'TEN-P0-DESKTOP-RUNTIME-IPC'),
    nodeTest('TEN-W4-SIDE-NODE-CACHE-JOURNAL', 'side', 'same-process claim caches, grants, and journals stay tenant-local', 'apps/node-agent/test/tenancy-boundary.test.mjs', 1, 'TEN-P0F-NODE-AGENT-BOUNDARY'),
    nodeTest('TEN-W4-SIDE-RESTART-WORKSPACE', 'side', 'restart journal refuses foreign scope without leaking records or tokens', 'apps/node-agent/test/tenancy-boundary.test.mjs', 1, 'TEN-P0F-NODE-AGENT-BOUNDARY'),
    relay('TEN-W4-SIDE-CAPABILITY-GRANT', 'side', 'grant ids and snapshots are tenant-partitioned and existence-opaque', 'test/tenant-boundary.test.ts', 1, 'TEN-P0-RELAY-MULTITENANT-GRANT'),
    relay('TEN-W4-SIDE-CHAIN-HEAD', 'side', 'Memory and SQLite chain heads advance independently per tenant', 'test/governance.test.ts', 2, 'TEN-W4-RELAY-GOVERNANCE'),
  ];
}

function root(id, category, expected, file, expectedPasses = 1, foundationMarker) {
  return definition(id, category, expected, file, 'root-node', 'vitest', repositoryRoot, 'vitest.config.ts', expectedPasses, foundationMarker);
}

function relay(id, category, expected, file, expectedPasses = 1, foundationMarker) {
  return definition(id, category, expected, file, 'relay', 'vitest', resolve(repositoryRoot, 'apps', 'relay'), 'vitest.config.ts', expectedPasses, foundationMarker);
}

function nodeTest(id, category, expected, file, expectedPasses = 1, foundationMarker) {
  return definition(id, category, expected, file, 'node-agent', 'node', repositoryRoot, undefined, expectedPasses, foundationMarker);
}

function definition(id, category, expected, file, group, runner, cwd, config, expectedPasses, foundationMarker) {
  return {
    id,
    marker: `[${id}]`,
    category,
    expected,
    file,
    group,
    runner,
    cwd,
    config,
    expectedPasses,
    ...(foundationMarker ? { foundationMarker: `[${foundationMarker}]` } : {}),
  };
}

function runGroups(definitions) {
  const buckets = new Map();
  for (const entry of definitions) {
    if (!buckets.has(entry.group)) buckets.set(entry.group, []);
    buckets.get(entry.group).push(entry);
  }
  return [...buckets.entries()].map(([id, entries]) => entries[0].runner === 'node'
    ? runNodeGroup(id, entries)
    : runVitestGroup(id, entries));
}

function runVitestGroup(id, definitions) {
  const vitest = resolve(repositoryRoot, 'node_modules', 'vitest', 'vitest.mjs');
  const pattern = definitions.map((entry) => escapeRegex(entry.marker)).join('|');
  const files = [...new Set(definitions.map((entry) => entry.file))];
  const result = run(process.execPath, [vitest, 'run', ...files, '--config', definitions[0].config, '-t', pattern, '--reporter=json'], definitions[0].cwd);
  const report = parseJsonReport(result.stdout);
  const assertions = report?.testResults?.flatMap((testResult) => testResult.assertionResults ?? []) ?? [];
  const checks = definitions.map((entry) => summarizeVitest(entry, assertions));
  return finishGroup(id, 'vitest-json', result, report !== null, checks);
}

function runNodeGroup(id, definitions) {
  const pattern = definitions.map((entry) => escapeRegex(entry.marker)).join('|');
  const files = [...new Set(definitions.map((entry) => resolve(repositoryRoot, entry.file)))];
  const result = run(process.execPath, ['--test', `--test-name-pattern=${pattern}`, '--test-reporter=tap', ...files], repositoryRoot);
  const checks = definitions.map((entry) => summarizeTap(entry, result.stdout));
  return finishGroup(id, 'node-test-tap', result, /^TAP version 13$/m.test(result.stdout), checks);
}

function finishGroup(id, runner, result, reportParsed, checks) {
  const status = result.exitCode === 0 && reportParsed && checks.every((check) => check.status === 'passed')
    ? 'passed'
    : 'failed';
  return {
    id,
    runner,
    status,
    command: redact(result.command),
    exitCode: result.exitCode,
    reportParsed,
    checks,
    ...(status === 'passed' ? {} : { stdoutTail: tail(result.stdout), stderrTail: tail(result.stderr) }),
  };
}

function summarizeVitest(definition, assertions) {
  const selected = assertions.filter((assertion) => String(assertion.fullName ?? '').includes(definition.marker));
  return summarize(definition, {
    passed: selected.filter((assertion) => assertion.status === 'passed').length,
    failed: selected.filter((assertion) => assertion.status === 'failed').length,
    skipped: selected.filter((assertion) => !['passed', 'failed'].includes(assertion.status)).length,
  });
}

function summarizeTap(definition, stdout) {
  const selected = String(stdout).split(/\r?\n/)
    .filter((line) => /^(?:ok|not ok) \d+ - /.test(line) && line.includes(definition.marker));
  return summarize(definition, {
    passed: selected.filter((line) => line.startsWith('ok ') && !/# (?:SKIP|TODO)\b/i.test(line)).length,
    failed: selected.filter((line) => line.startsWith('not ok ')).length,
    skipped: selected.filter((line) => /# (?:SKIP|TODO)\b/i.test(line)).length,
  });
}

function summarize(definition, counts) {
  const status = counts.passed === definition.expectedPasses && counts.failed === 0 && counts.skipped === 0
    ? 'passed'
    : 'failed';
  return {
    id: definition.id,
    marker: definition.marker,
    category: definition.category,
    expected: definition.expected,
    file: definition.file,
    expectedPasses: definition.expectedPasses,
    ...counts,
    status,
    ...(definition.foundationMarker ? { foundationMarker: definition.foundationMarker } : {}),
    ...(status === 'passed' ? {} : {
      reason: `expected exactly ${definition.expectedPasses} passed, 0 failed, 0 skipped; received ${counts.passed}/${counts.failed}/${counts.skipped}`,
    }),
  };
}

function matrixSummary(definitions, checks) {
  const categories = [...new Set(definitions.map((entry) => entry.category))];
  return {
    expected: definitions.length,
    passed: checks.filter((check) => check.status === 'passed').length,
    failed: checks.filter((check) => check.status !== 'passed').length,
    byCategory: Object.fromEntries(categories.map((category) => {
      const selected = checks.filter((check) => check.category === category);
      return [category, { expected: selected.length, passed: selected.filter((check) => check.status === 'passed').length }];
    })),
  };
}

function limitationsFor(mode) {
  const limitations = commonLimitations();
  if (mode === 'w4-21-case-matrix') {
    limitations.push(
      'The source prompt calls the matrix 21 items while its read/write/surface/side noun list contains 27 entries; this gate uses 21 non-duplicated executable attack cases and reports their category mapping explicitly.',
      'Capability-package surfaces are covered by the separate W5 capability registry/runtime gates; recording-session storage remains future-phase, and neither is counted inside this fixed W4 21-case matrix.',
      'The implemented subscription transport is SSE; a future WebSocket transport needs its own behavior case before it can be claimed.',
    );
  }
  if (mode === 'export') {
    limitations.push('The export gate verifies tenant-qualified manifests, hashes, and byte/reference isolation; it does not claim external archive delivery.');
  }
  return limitations;
}

function commonLimitations() {
  return ['Postgres/RLS has no configured test environment and remains pending; it is not counted as passed.'];
}

function failureReason(groups, checks) {
  const failedGroups = groups.filter((group) => group.status !== 'passed').map((group) => group.id);
  const failedChecks = checks.filter((check) => check.status !== 'passed').map((check) => check.id);
  return [
    failedGroups.length ? `runner groups: ${failedGroups.join(', ')}` : '',
    failedChecks.length ? `behavior checks: ${failedChecks.join(', ')}` : '',
  ].filter(Boolean).join('; ');
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
      // Runner warnings may appear before or after the JSON report.
    }
  }
  return null;
}

function emit(payload, exitCode) {
  const result = {
    schema: 'hummer.executable-gate-result',
    version: 1,
    gate: 'tenancy',
    capturedAt: new Date().toISOString(),
    toolchain: { node: process.version, platform: process.platform, arch: process.arch },
    ...payload,
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = exitCode;
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
