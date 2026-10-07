import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

if (process.version !== 'v22.22.2') throw new Error(`Node v22.22.2 is required; got ${process.version}`);
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this capture through npm so npm_execpath is pinned and explicit');

const repository = resolve(import.meta.dirname, '..');
const round = 'round-p1-task-grant-receipt-boundary';
const directory = resolve(repository, 'evidence', round);
const path = resolve(directory, 'gate.json');
if (existsSync(path)) throw new Error('Task-grant receipt evidence already exists; never overwrite a completed round');

const commands = [
  ['run', 'typecheck'],
  ['run', 'build:cli', '-w', '@hummer/relay'],
  ['run', 'test:grants', '-w', '@hummer/relay'],
  ['test', '-w', '@hummer/node-agent'],
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
  gate: 'task-grant-and-node-receipt-boundary',
  mode: 'dual-credential-one-use-grant-and-create-only-node-receipt',
  status: exitCode === 0 ? 'passed' : 'failed',
  capturedAt: new Date().toISOString(),
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(),
  toolchain: { node: process.version, platform: process.platform, arch: process.arch },
  commands: results,
  checks: [
    'node badge and task grant travel in separate headers and are both required',
    'Relay derives tenant, node, WorkOrder, run, capability, path, and explicit one-use scope from persisted task and approval facts',
    'task grant consume spends exactly one use while later checkpoints remain non-consuming',
    'wrong, missing, reflected, foreign, multi-use, revoked, expired, or expanded grants fail closed before executor invocation',
    'Node Agent verifies approval and task-grant bindings before every executor boundary',
    'portable receipt verification recomputes field hashes, root hash, and disclosed domain-event chain',
    'node-owned receipt storage is tenant/node marked, real-directory constrained, create-only, canonical, size-bounded, and file-synced',
    'receipt persistence precedes the terminal completed event and persistence failure prevents completion',
    'real Relay and Node Agent child processes still stop at pending approval with the production executor unavailable',
  ],
  limitations: [
    'Relay CLI does not yet provision or durably update task-grant snapshots; the authenticator is injectable and missing wiring returns 503.',
    'Grant consume, revoke, and exhaustion are process-atomic but not restart-durable until the control-plane persistence slice lands.',
    'The production runtime executor remains intentionally unavailable; this gate proves authorization and receipt boundaries, not host execution.',
    'The receipt proves internal hash consistency, not signer identity, trusted time, or third-party non-repudiation.',
    'The daemon integration runs two real child processes over loopback on one Windows machine, not across external devices.',
  ],
};
mkdirSync(directory, { recursive: true });
writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
process.stdout.write(`${JSON.stringify({ status: evidence.status, path: `evidence/${round}/gate.json`, exitCode })}\n`);
process.exitCode = exitCode;

function sanitize(value, root) {
  return value.replaceAll(root, '<WORKTREE>').replaceAll('\\', '/');
}
