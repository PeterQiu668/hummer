import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const capturedAt = new Date().toISOString();
const head = run('git', ['rev-parse', 'HEAD']);

const checks = {
  contract: run('npm', ['run', 'test:contract']),
  nodeAgent: run('npm', ['run', 'check', '-w', '@hummer/node-agent']),
  relayTypecheck: run('npm', ['run', 'typecheck', '-w', '@hummer/relay']),
  relayTest: run('npm', ['test', '-w', '@hummer/relay']),
  homeUi: run('npx', [
    'vitest',
    'run',
    'src/features/home/StartWorkPage.test.tsx',
    'src/features/home/StartWorkFlow.test.tsx',
    'src/components/pages/WorkbenchPage.test.tsx',
    '--config',
    'vitest.ui.config.ts',
  ]),
  receiptTest: run('node', ['scripts/test-fleet-receipt.mjs']),
  receiptVerify: run('npm', ['run', 'verify:fleet:receipt']),
  typecheck: run('npm', ['run', 'typecheck']),
  build: run('npm', ['run', 'build']),
  test: run('npm', ['test']),
};

const receiptResults = parseJson(checks.receiptTest.stdout);
const tamperResult = receiptResults?.results?.find((item) => item.name === 'one-byte child receipt tamper is rejected');

writeEvidence('round-d1/contract.json', {
  schema: 'hummer.phase0-evidence',
  version: 1,
  capturedAt,
  gitHead: head.stdout.trim(),
  status: checks.contract.exitCode === 0 ? 'passed' : 'failed',
  acceptance: ['AC-P0-01', 'AC-P0-02'],
  check: checks.contract,
});

writeEvidence('round-d2/fleet.json', {
  schema: 'hummer.phase0-evidence',
  version: 1,
  capturedAt,
  gitHead: head.stdout.trim(),
  status: checks.nodeAgent.exitCode === 0 ? 'network-gate-and-journal-verified' : 'failed',
  acceptance: [],
  limitations: [
    'No real Codex, Claude, DeepSeek, or GUI executor has been run through the fleet path.',
    'The static human/account badge registry is a development substitute, not a production identity provider.',
    'No true two-machine run has been performed.',
    'The durable journal deliberately returns recovery_required for in-doubt execution and never auto-retries.',
  ],
  check: checks.nodeAgent,
});

writeEvidence('round-d3/idempotency.json', {
  schema: 'hummer.phase0-evidence',
  version: 1,
  capturedAt,
  gitHead: head.stdout.trim(),
  status: checks.relayTypecheck.exitCode === 0 && checks.relayTest.exitCode === 0 ? 'network-transport-unit-verified' : 'failed',
  acceptance: [],
  limitations: [
    'WSS, production badge issuance/revocation, durable SSE replay, TLS deployment, and a two-machine 100-task run remain unimplemented.',
  ],
  checks: [checks.relayTypecheck, checks.relayTest],
});

writeEvidence('round-d4/ui.json', {
  schema: 'hummer.phase0-evidence',
  version: 1,
  capturedAt,
  gitHead: head.stdout.trim(),
  status: checks.homeUi.exitCode === 0 ? 'workbench-intent-verified' : 'failed',
  acceptance: [],
  limitations: [
    'The Workbench emits a validated pending dispatch intent, but no production Relay adapter is injected yet.',
    'No real runtime or two-machine execution is started by this UI slice.',
  ],
  check: checks.homeUi,
});

writeEvidence('round-d5/receipt.json', {
  schema: 'hummer.phase0-evidence',
  version: 1,
  capturedAt,
  gitHead: head.stdout.trim(),
  status: checks.receiptTest.exitCode === 0 && checks.receiptVerify.exitCode === 0 ? 'synthetic-fixture-verified' : 'failed',
  acceptance: [],
  limitations: ['The checked-in fleet receipt uses synthetic nodes and does not prove a real two-machine run.'],
  checks: [checks.receiptTest, checks.receiptVerify],
});

writeEvidence('round-d5/tamper.json', {
  schema: 'hummer.phase0-tamper-evidence',
  version: 1,
  capturedAt,
  gitHead: head.stdout.trim(),
  status: tamperResult?.passed && tamperResult?.exitCode === 1 ? 'passed' : 'failed',
  mutation: 'one-byte child receipt tamper',
  verifierExitCode: tamperResult?.exitCode ?? null,
  verifierOutput: tamperResult?.output ?? null,
});

writeEvidence('round-p0-integration/gates.json', {
  schema: 'hummer.phase0-gate-evidence',
  version: 1,
  capturedAt,
  gitHead: head.stdout.trim(),
  status: [checks.typecheck, checks.build, checks.test].every((check) => check.exitCode === 0) ? 'passed' : 'failed',
  checks: [checks.typecheck, checks.build, checks.test],
  toolchain: {
    node: '22.22.2 isolated pinned binary verified in evidence/round-00/baseline.json',
    codex: '0.153.4 isolated pinned binary verified in evidence/round-00/baseline.json',
    globalDefaultsMutated: false,
  },
  openBlockers: [
    'No true two-machine run, production badge issuance/revocation, real executor, offline recovery drill, or 100-task cross-process evidence yet.',
    'The in-doubt recovery_required state has no operator adjudication workflow yet.',
  ],
});

const failed = Object.values(checks).filter((check) => check.exitCode !== 0);
console.log(JSON.stringify({ captured: true, gitHead: head.stdout.trim(), checks: Object.keys(checks).length, failed: failed.map((item) => item.command) }));
process.exit(failed.length === 0 ? 0 : 1);

function run(command, args) {
  const useCommandShim = process.platform === 'win32' && (command === 'npm' || command === 'npx');
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    shell: useCommandShim,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  return {
    command: [command, ...args].join(' '),
    exitCode: result.status ?? 1,
    stdout: normalize(result.stdout),
    stderr: normalize(result.stderr || result.error?.message),
  };
}

function normalize(value) {
  return String(value ?? '').replaceAll(repositoryRoot, '<REPOSITORY_ROOT>').trim();
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function writeEvidence(relativePath, value) {
  const destination = join(repositoryRoot, 'evidence', relativePath);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
