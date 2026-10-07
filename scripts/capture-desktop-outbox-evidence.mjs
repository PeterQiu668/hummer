import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

if (process.version !== 'v22.22.2') throw new Error(`Node v22.22.2 is required; got ${process.version}`);
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this capture through npm so npm_execpath is pinned and explicit');

const repository = resolve(import.meta.dirname, '..');
const round = 'round-p1-desktop-fleet-outbox';
const directory = resolve(repository, 'evidence', round);
const path = resolve(directory, 'gate.json');
if (existsSync(path)) throw new Error('Desktop outbox evidence already exists; never overwrite a completed round');

const result = spawnSync(process.execPath, [npmCli, 'run', 'test:desktop:outbox'], {
  cwd: repository,
  encoding: 'utf8',
  windowsHide: true,
  env: process.env,
});
const exitCode = result.status ?? 1;
const evidence = {
  schema: 'hummer.executable-gate-result',
  version: 1,
  gate: 'desktop-fleet-durable-outbox',
  mode: 'sqlite-http-response-loss-and-process-kill',
  status: exitCode === 0 ? 'passed' : 'failed',
  capturedAt: new Date().toISOString(),
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(),
  toolchain: { node: process.version, platform: process.platform, arch: process.arch },
  command: {
    cmd: 'npm run test:desktop:outbox',
    exitCode,
    stdout: sanitize(String(result.stdout ?? ''), repository),
    stderr: sanitize(String(result.stderr ?? result.error?.message ?? ''), repository),
  },
  checks: [
    'Desktop build completed before the gate',
    'five focused files passed 37 tests',
    'SQLite row existed before the first network mutation',
    'response-lost replay reused identical TaskEnvelope bytes and converged on Relay inserted=false',
    'mismatched successful Relay responses remained pending with a safe error code',
    'concurrent renderer requests single-flighted one outbox delivery',
    'expired and permanent failures terminalized without infinite retry',
    'a committed outbox row survived a forcibly killed child process and was read by a fresh process',
    'badge and renderer session token canaries were absent from the persisted database surfaces under test',
  ],
  limitations: [
    'Durability applies only to the Desktop StartWork Relay path; intake confirmation and browser/mobile paths remain outside this outbox.',
    'Delivery is at-least-once. Relay idempotency converges retries to one logical task; this is not transport exactly-once.',
    'The process-kill gate kills a dedicated persistence child, not a packaged Electron executable.',
    'The outbox insert is atomic on its own SQLite transaction; it is not a cross-table business transaction with a separate WorkOrder fact.',
  ],
};
mkdirSync(directory, { recursive: true });
writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
process.stdout.write(`${JSON.stringify({ status: evidence.status, path: `evidence/${round}/gate.json`, exitCode })}\n`);
process.exitCode = exitCode;

function sanitize(value, root) {
  return value.replaceAll(root, '<WORKTREE>').replaceAll('\\', '/');
}
