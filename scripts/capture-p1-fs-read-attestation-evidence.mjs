import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

if (process.version !== 'v22.22.2') throw new Error(`Node v22.22.2 is required; got ${process.version}`);
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this capture through npm so npm_execpath is pinned and explicit');

const repository = resolve(import.meta.dirname, '..');
const round = 'round-p1-fs-read-attestation';
const directory = resolve(repository, 'evidence', round);
const path = resolve(directory, 'gate.json');
if (existsSync(path)) throw new Error('Read attestation evidence already exists; never overwrite a completed round');

const commands = [
  ['run', 'typecheck'],
  ['run', 'build'],
  ['run', 'test:contract'],
  ['test', '-w', '@hummer/node-agent'],
  ['run', 'test:fs-read', '-w', '@hummer/relay'],
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
  gate: 'fs-read-attestation-executor',
  mode: 'explicit-plan-human-approval-one-use-grant-bounded-local-read',
  status: exitCode === 0 ? 'passed' : 'failed',
  capturedAt: new Date().toISOString(),
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(),
  toolchain: { node: process.version, platform: process.platform, arch: process.arch },
  commands: results,
  checks: [
    'TaskEnvelope accepts only the explicit fs.read.attest.v1 execution plan with one strict relative path and a 1 MiB ceiling',
    'Node config v3 requires a separate real workspace root and advertises only fs.read',
    'approval and durable task grant bind task.execute plus fs.read to the exact path with maxUses one',
    'absolute traversal backslash alternate-stream control alias device hard-link symlink and junction paths fail closed',
    'authorization is checkpointed before open and before every 64 KiB read chunk',
    'mid-read revocation produces no partial events receipt or terminal completion',
    'receipt binds relative path byte count and SHA-256 and passes portable verification before completion',
    'real HTTP Relay Node SQLite integration completes one approved read and exhausts the grant exactly once',
    'file content and plaintext task token are absent from logs journal receipt Fleet SQLite and grant SQLite including WAL files',
    'Codex Claude DeepSeek arbitrary CLI shell network write spend delete and privilege execution remain disabled',
  ],
  limitations: [
    'The integration runs on one Windows host over loopback rather than across two external devices.',
    'The receipt proves the bytes read from a local file, not external signer identity, trusted time, or post-read immutability.',
    'Hard links and aliases are conservatively rejected even when a local use case might otherwise be legitimate.',
    'Static high-entropy node badges remain bootstrap credentials rather than production identity.',
  ],
};
mkdirSync(directory, { recursive: true });
writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
process.stdout.write(`${JSON.stringify({ status: evidence.status, path: `evidence/${round}/gate.json`, exitCode })}\n`);
process.exitCode = exitCode;

function sanitize(value, root) {
  return value.replaceAll(root, '<WORKTREE>').replaceAll('\\', '/');
}
