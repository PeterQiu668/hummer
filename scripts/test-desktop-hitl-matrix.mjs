import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const riskMatrix = args.includes('--risk-matrix');
const passthrough = args.filter((arg) => arg !== '--risk-matrix');

if (riskMatrix && passthrough.length) fail('usage: npm run test:desktop:hitl-matrix -- --risk-matrix');

runNpm('desktop:build');

if (!riskMatrix) {
  const result = spawnSync(process.execPath, [resolve(root, 'scripts/e2e-desktop-web-relay-hitl.mjs'), ...passthrough], {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
  });
  process.exit(result.status ?? 1);
}

const result = spawnSync(process.execPath, [resolve(root, 'scripts/test-risk-approval-matrix.mjs')], {
  cwd: root,
  encoding: 'utf8',
  windowsHide: true,
  maxBuffer: 10 * 1024 * 1024,
});
if (result.stderr) process.stderr.write(result.stderr);
if (result.status !== 0) {
  if (result.stdout) process.stdout.write(result.stdout);
  process.exit(result.status ?? 1);
}

let gate;
try {
  gate = JSON.parse(result.stdout.trim());
} catch {
  fail('risk matrix gate did not return one JSON result');
}

const expected = ['egress', 'write', 'spend', 'delete', 'privilege', 'network', 'unknown'];
const actual = Array.isArray(gate.riskClasses) ? gate.riskClasses.map((entry) => entry.risk) : [];
if (gate.status !== 'passed' || JSON.stringify(actual) !== JSON.stringify(expected)) {
  fail(`risk matrix did not prove the exact seven classes: ${JSON.stringify(actual)}`);
}
if (gate.riskClasses.some((entry) => entry.relayEnqueueBeforeApproval !== 0 || entry.runtimeExecutionBeforeApproval !== 0)) {
  fail('a controlled risk reached Relay or runtime before explicit human approval');
}

const receipt = {
  ...gate,
  authoritativeCommand: 'npm run test:desktop:hitl-matrix -- --risk-matrix',
  acceptance: {
    exactRiskClasses: expected,
    preApprovalRejected: '7/7',
    unknownAndFutureRisk: 'fail-closed',
  },
};
const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
const outputDir = resolve(root, 'spikes/p0-hitl');
const outputPath = resolve(outputDir, 'risk-matrix.json');
mkdirSync(outputDir, { recursive: true });
if (existsSync(outputPath)) {
  if (readFileSync(outputPath, 'utf8') !== serialized) fail('existing risk-matrix.json differs; evidence is not overwritten');
} else {
  writeFileSync(outputPath, serialized, { encoding: 'utf8', flag: 'wx' });
}
process.stdout.write(`${JSON.stringify(receipt)}\n`);

function runNpm(script) {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) fail('npm_execpath is required to run the Desktop build with the pinned Node process');
  const result = spawnSync(process.execPath, [npmCli, 'run', script], {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
