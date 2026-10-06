import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dryRuns = [
  ['test-fleet.mjs', '--idempotency'],
  ['test-fleet.mjs', '--soak=100'],
  ['test-security.mjs', '--grants'],
  ['test-security.mjs', '--token-leak'],
  ['test-chaos.mjs', '--approval-timeout'],
  ['test-chaos.mjs', '--revoke'],
  ['test-chaos.mjs', '--process-kill'],
];

let assertions = 0;
for (const [script, mode] of dryRuns) {
  const result = spawnSync(process.execPath, [resolve(root, 'scripts', script), mode, '--dry-run'], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${script} ${mode} dry-run must exit zero: ${result.stderr}`);
  const output = JSON.parse(result.stdout.trim());
  assert.equal(output.schema, 'hummer.executable-gate-result');
  assert.equal(output.status, 'planned');
  assert.equal(output.checks[0].status, 'planned');
  assertions += 4;
}

for (const mode of ['--process-kill']) {
  const result = spawnSync(process.execPath, [resolve(root, 'scripts', 'test-chaos.mjs'), mode], { encoding: 'utf8' });
  assert.equal(result.status, 2, `${mode} must remain a non-zero pending gate`);
  assert.equal(JSON.parse(result.stdout.trim()).status, 'pending');
  assertions += 2;
}

console.log(JSON.stringify({ status: 'passed', assertions, dryRuns: dryRuns.length, pendingModes: 1 }));
