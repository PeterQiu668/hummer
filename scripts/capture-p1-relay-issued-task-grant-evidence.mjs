import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

if (process.version !== 'v22.22.2') throw new Error(`Node v22.22.2 is required; got ${process.version}`);
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this capture through npm so npm_execpath is pinned and explicit');

const repository = resolve(import.meta.dirname, '..');
const round = 'round-p1-relay-issued-task-grant';
const directory = resolve(repository, 'evidence', round);
const path = resolve(directory, 'gate.json');
if (existsSync(path)) throw new Error('Relay-issued task-grant evidence already exists; never overwrite a completed round');

const commands = [
  ['run', 'typecheck'],
  ['run', 'build'],
  ['run', 'test:contract'],
  ['run', 'test:p1:relay-issued-grant'],
  ['run', 'test:daemons'],
  ['run', 'test:desktop:outbox'],
  ['run', 'test:unit'],
  ['run', 'test:ui'],
];
const results = [];
let exitCode = 0;
for (const args of commands) {
  const result = spawnSync(process.execPath, [npmCli, ...args], {
    cwd: repository,
    encoding: 'utf8',
    windowsHide: true,
    env: process.env,
    maxBuffer: 32 * 1024 * 1024,
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
  gate: 'relay-issued-task-grant',
  mode: 'post-approval-node-bound-deterministic-token-digest-only-durable-state',
  status: exitCode === 0 ? 'passed' : 'failed',
  capturedAt: new Date().toISOString(),
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(),
  toolchain: { node: process.version, platform: process.platform, arch: process.arch },
  commands: results,
  checks: [
    'Desktop generates a stable public grant reference and never asks the operator for a bearer token',
    'Relay rejects issuance before a bound approved human decision and rejects a foreign node badge',
    'Relay derives the one-use token from an environment-only issuer secret and immutable task scope',
    'only the token digest and immutable binding are committed to the separate task-grant SQLite authority',
    'a restart re-derives the same token without resetting use exhaustion revocation or expiry',
    'Node holds the issued token only in the active execution and sends it only to consume and checkpoint routes',
    'real HTTP Relay Node SQLite execution completes one bounded read and exhausts exactly one grant use',
    'plaintext file bytes task token and issuer secret are absent from logs journal receipts SQLite and evidence',
    'offline digest import remains recovery compatibility and is not required by the normal Desktop path',
  ],
  limitations: [
    'The verified transport is one Windows host over loopback, not a packaged two-device TLS deployment.',
    'The issuer secret is process memory backed, not HSM or KMS managed, and rotation still needs an explicit procedure.',
    'Static node badges remain bootstrap credentials rather than production IdP identity.',
    'The Node config still carries a legacy task-token fallback for transports that do not implement dynamic issuance.',
  ],
};
mkdirSync(directory, { recursive: true });
writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
process.stdout.write(`${JSON.stringify({ status: evidence.status, path: `evidence/${round}/gate.json`, exitCode })}\n`);
process.exitCode = exitCode;

function sanitize(value, root) {
  return value.replaceAll(root, '<WORKTREE>').replaceAll('\\', '/');
}
