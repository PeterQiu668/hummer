import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

if (process.version !== 'v22.22.2') throw new Error(`Node v22.22.2 is required; got ${process.version}`);
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this capture through npm so npm_execpath is pinned and explicit');

const repository = resolve(import.meta.dirname, '..');
const round = 'round-p1-durable-grant-authority';
const directory = resolve(repository, 'evidence', round);
const path = resolve(directory, 'gate.json');
if (existsSync(path)) throw new Error('Durable grant evidence already exists; never overwrite a completed round');

const commands = [
  ['run', 'typecheck'],
  ['run', 'build:cli', '-w', '@hummer/relay'],
  ['run', 'test:task-grant-durable', '-w', '@hummer/relay'],
  ['run', 'test:grants', '-w', '@hummer/relay'],
  ['test', '-w', '@hummer/relay'],
  ['run', 'test:daemons'],
];
const results = [];
let exitCode = 0;
for (const args of commands) {
  const result = spawnSync(process.execPath, [npmCli, ...args], {
    cwd: repository,
    encoding: 'utf8',
    windowsHide: true,
    env: process.env,
    maxBuffer: 16 * 1024 * 1024,
  });
  const status = result.status ?? 1;
  results.push({
    cmd: `npm ${args.join(' ')}`,
    exitCode: status,
    stdout: sanitize(String(result.stdout ?? ''), repository),
    stderr: sanitize(String(result.stderr ?? result.error?.message ?? ''), repository),
  });
  if (status !== 0) {
    exitCode = status;
    break;
  }
}

const evidence = {
  schema: 'hummer.executable-gate-result',
  version: 1,
  gate: 'durable-task-grant-authority',
  mode: 'sqlite-full-sync-import-consume-restart-revoke-restart',
  status: exitCode === 0 ? 'passed' : 'failed',
  capturedAt: new Date().toISOString(),
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(),
  toolchain: { node: process.version, platform: process.platform, arch: process.arch },
  commands: results,
  checks: [
    'Relay config v2 requires a separate absolute task-grant SQLite database',
    'offline provisioning imports strict digest-only snapshots without reading badge secrets',
    'identical re-import is idempotent and never rolls usedCount or terminal state backward',
    'binding or digest conflicts and non-single-use snapshots fail closed',
    'consume commits exhaustion before success and concurrent attempts produce one winner',
    'close and reopen preserve exhaustion, checkpoint eligibility, expiry, and revocation',
    'real persisted Fleet and grant state reject replay after Relay restart',
    'a second restart after revocation rejects the formerly valid checkpoint',
    'plaintext task tokens are absent from the SQLite bytes and command outputs under test',
    'the production executor remains unavailable and the real daemon pair stops at approval',
  ],
  limitations: [
    'Snapshot import is a local provisioning primitive, not a public issuer, IdP, KMS, or remote control plane.',
    'Fleet and grant facts use separate SQLite databases; no cross-database distributed transaction is claimed.',
    'Static high-entropy node badges remain bootstrap credentials rather than production identity.',
    'The production executor remains intentionally unavailable.',
    'The daemon gate runs on one Windows host over loopback rather than across two external devices.',
  ],
};
mkdirSync(directory, { recursive: true });
writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
process.stdout.write(`${JSON.stringify({ status: evidence.status, path: `evidence/${round}/gate.json`, exitCode })}\n`);
process.exitCode = exitCode;

function sanitize(value, root) {
  return value.replaceAll(root, '<WORKTREE>').replaceAll('\\', '/');
}
