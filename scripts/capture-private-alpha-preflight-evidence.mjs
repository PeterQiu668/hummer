import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

if (process.version !== 'v22.22.2') throw new Error(`Node v22.22.2 is required; got ${process.version}`);
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this capture through npm so npm_execpath is pinned and explicit');

const repository = resolve(import.meta.dirname, '..');
const round = 'round-private-alpha-preflight-rerun-1';
const directory = resolve(repository, 'evidence', round);
const path = resolve(directory, 'gate.json');
if (existsSync(path)) throw new Error('Private Alpha preflight rerun evidence already exists; never overwrite a completed round');

const commands = [
  { cmd: 'npm run typecheck', executable: process.execPath, args: [npmCli, 'run', 'typecheck'], expectedExitCode: 0 },
  { cmd: 'npm run build', executable: process.execPath, args: [npmCli, 'run', 'build'], expectedExitCode: 0 },
  { cmd: 'npm run test:contract', executable: process.execPath, args: [npmCli, 'run', 'test:contract'], expectedExitCode: 0 },
  { cmd: 'npm run test:private-alpha:preflight', executable: process.execPath, args: [npmCli, 'run', 'test:private-alpha:preflight'], expectedExitCode: 0 },
  {
    cmd: 'node scripts/validate-private-alpha-preflight.mjs docs/release/private-alpha-preflight.template.json',
    executable: process.execPath,
    args: ['scripts/validate-private-alpha-preflight.mjs', 'docs/release/private-alpha-preflight.template.json'],
    expectedExitCode: 2,
  },
  { cmd: 'npm run test:security -- --grants', executable: process.execPath, args: [npmCli, 'run', 'test:security', '--', '--grants'], expectedExitCode: 0 },
  { cmd: 'npm run test:security -- --token-leak', executable: process.execPath, args: [npmCli, 'run', 'test:security', '--', '--token-leak'], expectedExitCode: 0 },
  { cmd: 'npm test -w @hummer/relay', executable: process.execPath, args: [npmCli, 'test', '-w', '@hummer/relay'], expectedExitCode: 0 },
  { cmd: 'npm run test:unit', executable: process.execPath, args: [npmCli, 'run', 'test:unit'], expectedExitCode: 0 },
];
const results = [];
let exitCode = 0;
for (const command of commands) {
  const run = spawnSync(command.executable, command.args, {
    cwd: repository,
    encoding: 'utf8',
    windowsHide: true,
    env: process.env,
    maxBuffer: 32 * 1024 * 1024,
  });
  const actualExitCode = run.status ?? 1;
  const passed = actualExitCode === command.expectedExitCode;
  results.push({
    cmd: command.cmd,
    expectedExitCode: command.expectedExitCode,
    exitCode: actualExitCode,
    passed,
    stdout: sanitize(String(run.stdout ?? ''), repository),
    stderr: sanitize(String(run.stderr ?? run.error?.message ?? ''), repository),
  });
  if (!passed) {
    exitCode = actualExitCode === 0 ? 1 : actualExitCode;
    break;
  }
}

const evidence = {
  schema: 'hummer.executable-gate-result',
  version: 1,
  gate: 'private-alpha-preflight-readiness',
  mode: 'local-read-only-no-external-action',
  status: exitCode === 0 ? 'passed' : 'failed',
  capturedAt: new Date().toISOString(),
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(),
  toolchain: { node: process.version, platform: process.platform, arch: process.arch },
  commands: results,
  checks: [
    'a complete approved two-device private-alpha preflight document is accepted',
    'the intentionally incomplete template is blocked with exit code 2',
    'unknown fields placeholders and credential-bearing keys are rejected',
    'controller and node must be two distinct Windows devices',
    'Relay URL must be non-loopback credential-free HTTPS with an active certificate digest',
    'Node badge scope set exactly matches the production local-stack Node badge and expires within eight hours',
    'canary is low-sensitivity at most one MiB and strictly inside its dedicated workspace without links',
    'public exposure production data unsafe executors deletion and real payment all remain disabled',
  ],
  limitations: [
    'The validator checks a user-supplied local record; it does not authenticate the approver or independently inspect another machine.',
    'No network connection TLS gateway firewall badge issuance installation or external process is performed by this gate.',
    'A ready result authorizes nothing by itself; the owner must separately approve the recorded L3 action.',
  ],
};
mkdirSync(directory, { recursive: true });
writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
process.stdout.write(`${JSON.stringify({ status: evidence.status, path: `evidence/${round}/gate.json`, exitCode })}\n`);
process.exitCode = exitCode;

function sanitize(value, root) {
  return value.replaceAll(root, '<WORKTREE>').replaceAll('\\', '/');
}
