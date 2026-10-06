import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = resolve(repository, 'evidence', 'round-p1-w2w3-foundation');
const outputPath = resolve(outputDirectory, 'gates.json');

if (existsSync(outputPath)) {
  process.stderr.write('P1 foundation evidence already exists; create a new round instead of overwriting it.\n');
  process.exit(1);
}
if (process.version !== 'v22.22.2') {
  process.stderr.write(`Node v22.22.2 is required; got ${process.version}.\n`);
  process.exit(1);
}

function findNpmCli() {
  if (process.env.npm_execpath && existsSync(process.env.npm_execpath)) return process.env.npm_execpath;
  if (process.env.HUMMER_NPM_CLI && existsSync(process.env.HUMMER_NPM_CLI)) return process.env.HUMMER_NPM_CLI;
  if (process.platform === 'win32') {
    const npmCommand = execFileSync('where.exe', ['npm.cmd'], { encoding: 'utf8' }).split(/\r?\n/).find(Boolean);
    if (npmCommand) {
      const candidate = resolve(dirname(npmCommand.trim()), 'node_modules', 'npm', 'bin', 'npm-cli.js');
      if (existsSync(candidate)) return candidate;
    }
  }
  throw new Error('npm-cli.js was not found; set HUMMER_NPM_CLI');
}

const npmCli = findNpmCli();
const specifications = [
  { id: 'typecheck', args: ['run', 'typecheck'], expected: [0] },
  { id: 'build', args: ['run', 'build'], expected: [0] },
  { id: 'test', args: ['test'], expected: [0] },
  { id: 'contract', args: ['run', 'test:contract'], expected: [0] },
  { id: 'relay', args: ['run', 'test', '-w', '@hummer/relay'], expected: [0] },
  { id: 'node-agent', args: ['run', 'test', '-w', '@hummer/node-agent'], expected: [0] },
  { id: 'fleet-idempotency', script: 'scripts/test-fleet.mjs', args: ['--idempotency'], expected: [0] },
  { id: 'security-grants', script: 'scripts/test-security.mjs', args: ['--grants'], expected: [0] },
  { id: 'security-token-leak', script: 'scripts/test-security.mjs', args: ['--token-leak'], expected: [0] },
  { id: 'chaos-approval-timeout', script: 'scripts/test-chaos.mjs', args: ['--approval-timeout'], expected: [0] },
  { id: 'chaos-revoke', script: 'scripts/test-chaos.mjs', args: ['--revoke'], expected: [0] },
  { id: 'fleet-real-two-machine-soak', script: 'scripts/test-fleet.mjs', args: ['--soak=100'], expected: [2], pending: true },
  { id: 'chaos-process-kill', script: 'scripts/test-chaos.mjs', args: ['--process-kill'], expected: [2], pending: true },
];

function normalize(value) {
  return String(value ?? '').replaceAll(repository, '<WORKTREE>');
}

const commands = specifications.map((specification) => {
  const argv = specification.script
    ? [resolve(repository, specification.script), ...specification.args]
    : [npmCli, ...specification.args];
  const startedAt = new Date().toISOString();
  const result = spawnSync(process.execPath, argv, {
    cwd: repository,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  const exitCode = result.status ?? 1;
  return {
    id: specification.id,
    cmd: `${process.execPath} ${argv.join(' ')}`.replaceAll(repository, '<WORKTREE>'),
    startedAt,
    finishedAt: new Date().toISOString(),
    exitCode,
    disposition: specification.expected.includes(exitCode) ? (specification.pending ? 'pending' : 'passed') : 'failed',
    stdout: normalize(result.stdout),
    stderr: normalize(result.stderr ?? result.error?.message),
  };
});

const changedPaths = execFileSync('git', ['diff', '--name-only', '2881b30549a2b72ea931831f855ffdff498aa823..HEAD'], { cwd: repository, encoding: 'utf8' })
  .split(/\r?\n/).filter(Boolean);
const artifacts = changedPaths.filter((path) => existsSync(resolve(repository, path))).map((path) => {
  const bytes = readFileSync(resolve(repository, path));
  return { path: path.replaceAll('\\', '/'), sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.byteLength };
});
const counts = {
  pass: commands.filter((command) => command.disposition === 'passed').length,
  fail: commands.filter((command) => command.disposition === 'failed').length,
  skipped: 0,
  pending: commands.filter((command) => command.disposition === 'pending').length,
};
const evidence = {
  round: 'P1-W2W3-foundation',
  generatedAt: new Date().toISOString(),
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(),
  worktree: 'phase0-fleet',
  node: process.version,
  commands,
  accepted: {
    contractV1: 'CapabilityGrant is in the shared TypeBox/Ajv/Standard Schema source',
    grants: 'least privilege, expiry, maxUses, rotation and next-checkpoint revocation',
    recovery: 'manual abandon or retry authorization with immutable journal lineage',
    diagnostics: 'allowlisted redacted diagnostic core and token-leak canary',
    evidenceSealing: 'immutable chained manifest command and negative tests',
  },
  broken: {
    trueTwoMachineSoak: 'pending: no enrolled second physical device or remote endpoint was supplied',
    supervisedProcessKill: 'pending: supervised multi-process kill/restart harness is not implemented',
    inFlightNodeRevocation: 'Relay revocation is immediate at the next authorization checkpoint; a long-running executor checkpoint hook remains',
  },
  counts,
  artifacts,
  screenshots: [],
};

mkdirSync(outputDirectory, { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
process.stdout.write(`${JSON.stringify({ status: counts.fail === 0 ? 'captured' : 'failed', output: relative(repository, outputPath).replaceAll('\\', '/'), counts })}\n`);
process.exitCode = counts.fail === 0 ? 0 : 1;
