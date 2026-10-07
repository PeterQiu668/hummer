import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

if (process.version !== 'v22.22.2') throw new Error(`Node v22.22.2 is required; got ${process.version}`);
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this capture through npm so npm_execpath is pinned and explicit');

const repository = resolve(import.meta.dirname, '..');
const round = 'round-p1-first-run-identity-claim';
const directory = resolve(repository, 'evidence', round);
const path = resolve(directory, 'gate.json');
if (existsSync(path)) throw new Error('First-run identity evidence already exists; never overwrite a completed round');

const commands = [
  ['run', 'typecheck'],
  ['run', 'build'],
  ['exec', '--', 'vitest', 'run', '--config', 'vitest.config.ts', 'apps/desktop/src/local-stack-claim.test.ts', 'apps/desktop/src/desktop-relay-host.test.ts', 'apps/desktop/src/parent-lifetime.test.ts'],
  ['run', 'test:local:stack'],
  ['run', 'test:local:stack:first-run'],
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
  gate: 'first-run-desktop-identity-claim',
  mode: 'fresh-electron-authenticated-local-pipe-claim',
  status: exitCode === 0 ? 'passed' : 'failed',
  capturedAt: new Date().toISOString(),
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(),
  toolchain: { node: process.version, platform: process.platform, arch: process.arch },
  commands: results,
  checks: [
    'config v2 starts without tenant or account identifiers and waits for authenticated Desktop identity',
    'bad claim token leaves Relay and Node stopped while the valid claim starts both services exactly once',
    'Desktop persistence resolves the authoritative identity and Relay late configuration is immutable',
    'fresh Electron UI creates a company without prefilled identifiers and lists the claimed Node online',
    'claim token and Relay control badge never reach renderer storage or persisted test bytes',
    'legacy explicit identity mode still starts stops and restarts with secret scans clean',
    'Relay full tests and root unit UI build and typecheck regressions remain green',
  ],
  limitations: [
    'The gate runs on one Windows host over loopback rather than a signed installer on a second device.',
    'The Electron onboarding gate uses a version-only Codex probe and does not execute a real Codex task.',
    'Loopback bootstrap is not production TLS IdP KMS or remote enrollment evidence.',
  ],
};
mkdirSync(directory, { recursive: true });
writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
process.stdout.write(`${JSON.stringify({ status: evidence.status, path: `evidence/${round}/gate.json`, exitCode })}\n`);
process.exitCode = exitCode;

function sanitize(value, root) {
  return value.replaceAll(root, '<WORKTREE>').replaceAll('\\', '/');
}
