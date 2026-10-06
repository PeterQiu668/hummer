import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dryRuns = [
  ['test-fleet.mjs', ['--idempotency']],
  ['test-fleet.mjs', ['--soak=100']],
  ['test-security.mjs', ['--grants']],
  ['test-security.mjs', ['--token-leak']],
  ['test-chaos.mjs', []],
  ['test-chaos.mjs', ['--approval-timeout']],
  ['test-chaos.mjs', ['--revoke']],
  ['test-chaos.mjs', ['--process-kill']],
  ['test-perf.mjs', []],
];

let assertions = 0;
for (const [script, args] of dryRuns) {
  const result = spawnSync(process.execPath, [resolve(root, 'scripts', script), ...args, '--dry-run'], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${script} ${args.join(' ')} dry-run must exit zero: ${result.stderr}`);
  const output = JSON.parse(result.stdout.trim());
  assert.equal(output.schema, 'hummer.executable-gate-result');
  assert.equal(output.status, 'planned');
  assert.equal(output.checks[0].status, 'planned');
  if (script === 'test-chaos.mjs' && args.length === 0) assert.equal(output.checks.length, 7);
  assertions += 4;
}

console.log(JSON.stringify({ status: 'passed', assertions, dryRuns: dryRuns.length, pendingModes: 0 }));
