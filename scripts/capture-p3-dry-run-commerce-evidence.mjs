import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

if (process.version !== 'v22.22.2') throw new Error(`Node v22.22.2 is required; got ${process.version}`);
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this capture through npm so npm_execpath is pinned and explicit');

const repository = resolve(import.meta.dirname, '..');
const round = 'round-p3-dry-run-commerce-rerun-1';
const directory = resolve(repository, 'evidence', round);
const path = resolve(directory, 'gate.json');
if (existsSync(path)) throw new Error('Phase 3 dry-run commerce rerun evidence already exists; never overwrite a completed round');

const commands = [
  ['run', 'typecheck'],
  ['run', 'build'],
  ['run', 'test:contract'],
  ['run', 'test:marketplace:commerce'],
  ['test', '-w', '@hummer/relay'],
  ['run', 'test:unit'],
  ['run', 'test:ui'],
  ['run', 'audit:dead-controls'],
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
  gate: 'phase3-dry-run-marketplace-commerce',
  mode: 'local-claim-verified-no-real-payment',
  status: exitCode === 0 ? 'passed' : 'failed',
  capturedAt: new Date().toISOString(),
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(),
  toolchain: { node: process.version, platform: process.platform, arch: process.arch },
  commands: results,
  checks: [
    'a source-tenant human can declare and revoke an exact public-listing author claim',
    'a separate human marketplace moderator must verify the claim from an evidence digest',
    'only a verified claim can publish one active positive-integer CNY dry-run offer',
    'a buyer order requires an approved exact install attempt and rejects payment fields',
    'settlement persists one equal debit and credit and reconciles to zero',
    'cross-tenant reconciliation, wrong-role settlement, replay, and unknown fields fail closed',
    'production commerce files and manifests contain no known payment credential or provider integration',
    'root typecheck build contract Relay unit UI and dead-control regressions remain green',
  ],
  limitations: [
    'This evidence is local SQLite and loopback HTTP simulation; no money or provider network is used.',
    'No external author, real identity verification, customer, tax, legal, privacy, or marketplace launch approval is claimed.',
    'Real payment, custody, payout, invoice, refund, chargeback, KYC, AML, and production deployment remain prohibited L3 work.',
  ],
};
mkdirSync(directory, { recursive: true });
writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
process.stdout.write(`${JSON.stringify({ status: evidence.status, path: `evidence/${round}/gate.json`, exitCode })}\n`);
process.exitCode = exitCode;

function sanitize(value, root) {
  return value.replaceAll(root, '<WORKTREE>').replaceAll('\\', '/');
}
