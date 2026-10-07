import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

if (process.version !== 'v22.22.2') throw new Error(`Node v22.22.2 is required; got ${process.version}`);
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this capture through npm so npm_execpath is pinned and explicit');

const repository = resolve(import.meta.dirname, '..');
const round = 'round-p1-local-stack-supervisor';
const directory = resolve(repository, 'evidence', round);
const path = resolve(directory, 'gate.json');
if (existsSync(path)) throw new Error('Local stack evidence already exists; never overwrite a completed round');

const commands = [
  ['run', 'typecheck'],
  ['run', 'build'],
  ['test', '-w', '@hummer/relay'],
  ['run', 'test:local:stack'],
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
  gate: 'local-stack-supervisor',
  mode: 'single-host-loopback-existing-desktop-identity',
  status: exitCode === 0 ? 'passed' : 'failed',
  capturedAt: new Date().toISOString(),
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(),
  toolchain: { node: process.version, platform: process.platform, arch: process.arch },
  commands: results,
  checks: [
    'strict config contains identity and absolute paths but no credential values',
    'one supervisor starts real Relay and Node with fresh in-memory credentials',
    'live named-pipe status works and a second supervisor is rejected',
    'coordinated stop closes Node Relay SQLite and archives a redaction-safe receipt',
    'the same durable state restarts under a fresh session and fresh credentials',
    'state configs SQLite journal and receipts contain no generated plaintext bearer pattern',
    'Desktop parent-lifetime hook is inert by default and quits only on explicit supervisor stdin EOF',
    'Relay full tests and root unit UI build and typecheck regressions remain green',
  ],
  limitations: [
    'The gate runs headless Relay and Node on one Windows host; it does not claim packaged Desktop or second-device evidence.',
    'The config requires an existing Desktop tenant/account identity and does not solve first-run identity provisioning.',
    'Loopback HTTP and bootstrap secrets are not production TLS IdP or KMS integration.',
  ],
};
mkdirSync(directory, { recursive: true });
writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
process.stdout.write(`${JSON.stringify({ status: evidence.status, path: `evidence/${round}/gate.json`, exitCode })}\n`);
process.exitCode = exitCode;

function sanitize(value, root) {
  return value.replaceAll(root, '<WORKTREE>').replaceAll('\\', '/');
}
