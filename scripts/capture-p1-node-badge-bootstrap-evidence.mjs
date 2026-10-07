import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

if (process.version !== 'v22.22.2') throw new Error(`Node v22.22.2 is required; got ${process.version}`);
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this capture through npm so npm_execpath is pinned and explicit');

const repository = resolve(import.meta.dirname, '..');
const round = 'round-p1-node-badge-only-bootstrap';
const directory = resolve(repository, 'evidence', round);
const path = resolve(directory, 'gate.json');
if (existsSync(path)) throw new Error('Node badge-only evidence already exists; never overwrite a completed round');

const commands = [
  ['run', 'typecheck'],
  ['run', 'build'],
  ['run', 'test:contract'],
  ['run', 'test:p1:node-badge-bootstrap'],
  ['test', '-w', '@hummer/relay'],
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
  gate: 'node-badge-only-bootstrap',
  mode: 'badge-only-config-mandatory-relay-task-grant-issuance',
  status: exitCode === 0 ? 'passed' : 'failed',
  capturedAt: new Date().toISOString(),
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(),
  toolchain: { node: process.version, platform: process.platform, arch: process.arch },
  commands: results,
  checks: [
    'Node config version 4 accepts one configured credential and rejects unknown legacy task-token fields',
    'badge environment input is consumed once and deleted before daemon operation',
    'bootstrap registration heartbeat claim approval and polling emit no task-grant header',
    'a grant-bound task with no issuer transport fails before consume checkpoint or executor invocation',
    'the real Relay Node SQLite read path obtains the post-approval token and completes exactly once',
    'full Relay root unit and UI regressions remain green',
  ],
  limitations: [
    'The test runs on one Windows host over loopback rather than a packaged second device.',
    'The node badge and Relay issuer secret remain bootstrap credentials rather than IdP and KMS managed identity.',
    'Local grantScopes and grantExpiresAt remain a defense-in-depth configuration envelope.',
  ],
};
mkdirSync(directory, { recursive: true });
writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
process.stdout.write(`${JSON.stringify({ status: evidence.status, path: `evidence/${round}/gate.json`, exitCode })}\n`);
process.exitCode = exitCode;

function sanitize(value, root) {
  return value.replaceAll(root, '<WORKTREE>').replaceAll('\\', '/');
}
