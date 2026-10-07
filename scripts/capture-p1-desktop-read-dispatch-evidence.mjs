import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

if (process.version !== 'v22.22.2') throw new Error(`Node v22.22.2 is required; got ${process.version}`);
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this capture through npm so npm_execpath is pinned and explicit');

const repository = resolve(import.meta.dirname, '..');
const round = 'round-p1-desktop-read-dispatch';
const directory = resolve(repository, 'evidence', round);
const path = resolve(directory, 'gate.json');
if (existsSync(path)) throw new Error('Desktop read-dispatch evidence already exists; never overwrite a completed round');

const commands = [
  ['run', 'typecheck'],
  ['run', 'build'],
  ['run', 'test:contract'],
  ['run', 'test:p1:desktop-read-dispatch'],
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
    maxBuffer: 24 * 1024 * 1024,
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
  gate: 'desktop-read-attestation-dispatch',
  mode: 'explicit-form-capability-matched-human-review-durable-outbox',
  status: exitCode === 0 ? 'passed' : 'failed',
  capturedAt: new Date().toISOString(),
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(),
  toolchain: { node: process.version, platform: process.platform, arch: process.arch },
  commands: results,
  checks: [
    'Desktop requires an explicit fs.read.attest.v1 choice and never infers a file path from natural-language work',
    'the form requires a strict relative path byte ceiling and opaque pre-provisioned one-use grant reference',
    'a read plan can target only an online node that explicitly advertises fs.read',
    'the human review screen shows the exact path byte ceiling grant reference and no-content-return promise before confirmation',
    'zero dispatch occurs before explicit human confirmation and invalid or unknown fields fail closed',
    'the confirmed TaskEnvelope binds executionPlan and grantRef and passes the shared Fleet contract',
    'Desktop SQLite outbox accepts only the known plan shape commits it before network and replays identical bytes after restart',
    'response binding idempotency tenant actor expiry and credential persistence protections remain enforced',
    'general model CLI shell network write spend delete and privilege execution remain disabled',
  ],
  limitations: [
    'The one-use task grant must already be provisioned offline; this slice does not add a public issuer or expose a plaintext token.',
    'The gate uses local React and Desktop SQLite integrations rather than a packaged app on a second physical device.',
    'A completed read still requires the separately verified Relay Node executor path and human approval.',
    'Production TLS IdP remote installation and external-user evidence remain pending.',
  ],
};
mkdirSync(directory, { recursive: true });
writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
process.stdout.write(`${JSON.stringify({ status: evidence.status, path: `evidence/${round}/gate.json`, exitCode })}\n`);
process.exitCode = exitCode;

function sanitize(value, root) {
  return value.replaceAll(root, '<WORKTREE>').replaceAll('\\', '/');
}
