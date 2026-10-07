import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const risks = ['egress', 'write', 'spend', 'delete', 'privilege', 'network', 'unknown'];
const testFile = 'src/features/home/StartWorkRiskApprovalMatrix.test.tsx';
const result = spawnSync(process.execPath, [
  resolve(root, 'node_modules/vitest/vitest.mjs'),
  'run',
  '--config', resolve(root, 'vitest.ui.config.ts'),
  resolve(root, testFile),
  '--reporter=json',
], {
  cwd: root,
  encoding: 'utf8',
  windowsHide: true,
  maxBuffer: 10 * 1024 * 1024,
});

let report;
try {
  report = JSON.parse(result.stdout.trim());
} catch {
  fail(`focused Vitest output was not JSON (exit ${result.status}): ${safeText(result.stderr || result.stdout)}`);
}

const assertions = report.testResults?.flatMap((entry) => entry.assertionResults ?? []) ?? [];
const passedTitles = assertions.filter((entry) => entry.status === 'passed').map((entry) => entry.title);
const missingRisks = risks.filter((risk) => !passedTitles.some((title) => title.includes(`[risk='${risk}']`)));
const canonicalCovered = passedTitles.some((title) => title.includes('canonical seven-class contract taxonomy'));
const newRiskCovered = passedTitles.some((title) => title.includes('[risk=new-or-unrecognized]'));

if (result.status !== 0 || report.success !== true || missingRisks.length || !canonicalCovered || !newRiskCovered) {
  fail('risk approval matrix is incomplete or failed', {
    vitestExit: result.status,
    vitestSuccess: report.success,
    missingRisks,
    canonicalCovered,
    newRiskCovered,
    failedTests: assertions.filter((entry) => entry.status !== 'passed').map((entry) => entry.fullName),
  });
}

const gate = {
  schema: 'hummer.executable-gate-result',
  version: 1,
  gate: 'strict-seven-risk-ui-relay-approval-matrix',
  mode: 'production-start-work-ui-and-remote-relay-client',
  status: 'passed',
  riskClasses: risks.map((risk) => ({
    risk,
    contextBeforeApproval: ['target', 'risk', 'cost'],
    relayEnqueueBeforeApproval: 0,
    runtimeExecutionBeforeApproval: 0,
    disposition: risk === 'unknown' ? 'fail-closed-replan-required' : 'explicit-human-confirmation-required',
  })),
  checks: [
    { id: 'canonical-taxonomy-exact-match', status: 'passed' },
    { id: 'seven-ui-context-and-zero-preapproval-side-effects', status: 'passed' },
    { id: 'six-confirmable-classes-enqueue-once-after-human-click', status: 'passed' },
    { id: 'unknown-and-new-risk-fail-closed', status: 'passed' },
  ],
  assertions: report.numPassedTests,
  negativeCases: 2,
  testFile,
  limitations: [
    'The gate exercises the production React StartWorkFlow and production RemoteRelayClient with an in-memory HTTP response stub; the separate real-web-relay-e2e gate covers a real loopback Fastify Relay.',
    'No Node agent is attached in this gate, so it proves zero runtime execution by absence of any runtime execution surface; it is not two-machine or external Relay evidence.',
    'Synthetic plans, node metadata, costs, and badge values only; no real user or production data is used.',
  ],
};

process.stdout.write(`${JSON.stringify(gate)}\n`);

function fail(message, details = {}) {
  process.stdout.write(`${JSON.stringify({
    schema: 'hummer.executable-gate-result',
    version: 1,
    gate: 'strict-seven-risk-ui-relay-approval-matrix',
    status: 'failed',
    error: message,
    ...details,
  })}\n`);
  process.exit(1);
}

function safeText(value) {
  return String(value).replace(/[\r\n]+/g, ' ').slice(0, 1_000);
}
