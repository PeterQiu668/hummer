import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

if (process.version !== 'v22.22.2') throw new Error(`Node v22.22.2 is required; got ${process.version}`);
const repository = resolve(import.meta.dirname, '..');
const directory = resolve(repository, 'evidence', 'round-p1-w3-process-kill');
const path = resolve(directory, 'gates.json');
if (existsSync(path)) throw new Error('process-kill evidence already exists; never overwrite a completed round');

const command = [resolve(repository, 'scripts', 'test-chaos.mjs'), '--process-kill'];
const result = spawnSync(process.execPath, command, { cwd: repository, encoding: 'utf8', windowsHide: true });
const exitCode = result.status ?? 1;
const evidence = {
  round: 'P1-W3-process-kill',
  generatedAt: new Date().toISOString(),
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(),
  worktree: 'phase0-fleet',
  node: process.version,
  commands: [{
    cmd: `${process.execPath} scripts/test-chaos.mjs --process-kill`,
    exitCode,
    stdout: String(result.stdout ?? '').replaceAll(repository, '<WORKTREE>'),
    stderr: String(result.stderr ?? result.error?.message ?? '').replaceAll(repository, '<WORKTREE>'),
  }],
  accepted: { processKill: 'real child process killed at executing; fresh process recovered fail-closed with zero executor calls' },
  broken: {},
  counts: { pass: exitCode === 0 ? 1 : 0, fail: exitCode === 0 ? 0 : 1, skipped: 0 },
  artifacts: [],
  screenshots: [],
};
mkdirSync(directory, { recursive: true });
writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
process.stdout.write(`${JSON.stringify({ status: exitCode === 0 ? 'captured' : 'failed', path: 'evidence/round-p1-w3-process-kill/gates.json', exitCode })}\n`);
process.exitCode = exitCode;
