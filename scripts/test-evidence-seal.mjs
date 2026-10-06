import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = mkdtempSync(join(tmpdir(), 'hummer-evidence-seal-'));
let assertions = 0;

function run(...args) {
  return spawnSync(process.execPath, [resolve('scripts/evidence-seal.mjs'), ...args], { cwd: root, encoding: 'utf8' });
}

try {
  spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' });
  spawnSync('git', ['config', 'user.email', 'evidence-test@invalid.local'], { cwd: root, encoding: 'utf8' });
  spawnSync('git', ['config', 'user.name', 'Evidence Test'], { cwd: root, encoding: 'utf8' });
  writeFileSync(join(root, 'README.md'), 'fixture\n', 'utf8');
  spawnSync('git', ['add', 'README.md'], { cwd: root, encoding: 'utf8' });
  spawnSync('git', ['commit', '-m', 'fixture'], { cwd: root, encoding: 'utf8' });

  mkdirSync(join(root, 'evidence', 'round-a'), { recursive: true });
  writeFileSync(join(root, 'evidence', 'round-a', 'result.json'), '{"exitCode":0}\n', 'utf8');
  const first = run('--round', 'round-a');
  assert.equal(first.status, 0, first.stderr); assertions += 1;
  const firstManifest = JSON.parse(readFileSync(join(root, 'evidence', 'round-a', 'manifest.json'), 'utf8'));
  assert.equal(firstManifest.files.length, 1); assertions += 1;
  assert.match(firstManifest.rootHash, /^[a-f0-9]{64}$/); assertions += 1;

  const overwrite = run('--round', 'round-a');
  assert.equal(overwrite.status, 1); assertions += 1;
  assert.match(overwrite.stderr, /immutable/); assertions += 1;

  mkdirSync(join(root, 'evidence', 'round-b'), { recursive: true });
  writeFileSync(join(root, 'evidence', 'round-b', 'result.json'), '{"exitCode":1,"expected":true}\n', 'utf8');
  const second = run('--round=round-b', '--prev', 'evidence/round-a/manifest.json');
  assert.equal(second.status, 0, second.stderr); assertions += 1;
  const secondManifest = JSON.parse(readFileSync(join(root, 'evidence', 'round-b', 'manifest.json'), 'utf8'));
  assert.equal(secondManifest.prevManifestRootHash, firstManifest.rootHash); assertions += 1;

  mkdirSync(join(root, 'evidence', 'empty'), { recursive: true });
  const empty = run('--round', 'empty');
  assert.equal(empty.status, 1); assertions += 1;
  assert.match(empty.stderr, /empty/); assertions += 1;

  process.stdout.write(`${JSON.stringify({ status: 'passed', assertions, negativeCases: 2 })}\n`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
