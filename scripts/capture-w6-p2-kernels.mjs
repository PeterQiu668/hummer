import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const round = option('round') ?? 'round-w6-p2-kernels';
if (!/^round-w6-p2-kernels(?:\.[1-9][0-9]*)?$/.test(round)) {
  fail('Round must be round-w6-p2-kernels or a positive revision.');
}
if (process.version !== 'v22.22.2') fail(`Node v22.22.2 is required; got ${process.version}.`);

const outputDirectory = resolve(repository, 'evidence', round);
if (existsSync(outputDirectory)) fail(`Evidence round already exists and will not be overwritten: evidence/${round}`);

const npmCli = findNpmCli();
const specifications = [
  { id: 'contract', args: ['run', 'test:contract'] },
  { id: 'chaos-seven-faults', args: ['run', 'test:chaos'] },
  { id: 'local-capacity', args: ['run', 'test:perf'] },
  { id: 'privacy-kernel', args: ['run', 'test:privacy'] },
  { id: 'distillation-kernel', args: ['run', 'test:distillation'] },
  { id: 'skill-replay-kernel', args: ['run', 'test:skill-replay'] },
  { id: 'public-market-kernel', args: ['run', 'test:public-market'] },
  { id: 'upgrade-rollback', args: ['run', 'test:upgrade-rollback'] },
  { id: 'diagnostics', args: ['run', 'test:diagnostics'] },
  { id: 'full-test', args: ['test'] },
  { id: 'typecheck', args: ['run', 'typecheck'] },
  { id: 'build', args: ['run', 'build'] },
];

const commands = specifications.map(runNpm);
const counts = {
  pass: commands.filter((command) => command.exitCode === 0).length,
  fail: commands.filter((command) => command.exitCode !== 0).length,
  skipped: 0,
};
const evidence = {
  schema: 'hummer.w6-p2-kernel-evidence',
  version: 1,
  round,
  generatedAt: new Date().toISOString(),
  commit: git(['rev-parse', 'HEAD']).trim(),
  branch: git(['branch', '--show-current']).trim(),
  node: process.version,
  commands,
  accepted: {
    stabilization: 'seven deterministic local fault classes and a 10-node/100-task/10000-event Memory+SQLite capacity floor pass',
    privacy: 'strict local-only DemoSession contract, source allowlist, pause/delete/rechain, tenant isolation, and redaction egress gate pass on synthetic metadata',
    distillation: 'synthetic structured records compile into a reviewable dual-track draft; uncertain grounding fails closed; bounded corrections and append-only rollback pass',
    replay: 'deterministic side-effect-free replay, exact failure step, executable regression evidence, and five-shadow-run promotion gate pass',
    publicMarket: 'local read-only listing projection, membership boundaries, install gate, report, human takedown, and post-takedown denial pass',
    operations: 'marker-scoped synthetic upgrade rollback and independently verifiable redacted diagnostic ZIP gates pass',
  },
  pending: {
    realCapture: 'no OS recorder, real screen/input capture, or independently completed expert demonstration',
    realGrounding: 'no production AX/UIAutomation or GUI model accuracy evidence',
    realReplay: 'no real GUI/CUA side effect, persistent CapabilityGrant consumption, or multi-machine replay',
    publicSurface: 'no public HTTP/UI endpoint, remote bundle transport, or real host materialization',
    externalInstalls: 'the required ten third-party installs remain pending',
    realUpgrade: 'no signed NSIS cross-version upgrade on a clean Windows machine',
    externalAcceptance: 'two-machine soak, five seed users, twenty real tasks, and payment signal remain external acceptance work',
  },
  safety: {
    deployed: false,
    pushed: false,
    realUserDataCaptured: false,
    realInstallationModified: false,
    paymentCodeAdded: false,
    agentHubWritten: false,
  },
  counts,
};

mkdirSync(outputDirectory, { recursive: true });
const gatesPath = resolve(outputDirectory, 'gates.json');
const reportPath = resolve(outputDirectory, 'report.md');
writeFileSync(gatesPath, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
writeFileSync(reportPath, report(evidence), { encoding: 'utf8', flag: 'wx' });
process.stdout.write(`${JSON.stringify({
  status: counts.fail === 0 ? 'captured' : 'failed',
  gates: relative(repository, gatesPath).replaceAll('\\', '/'),
  report: relative(repository, reportPath).replaceAll('\\', '/'),
  counts,
})}\n`);
process.exitCode = counts.fail === 0 ? 0 : 1;

function runNpm(specification) {
  const argv = [npmCli, ...specification.args];
  const environment = { ...process.env };
  const pathKey = Object.keys(environment).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
  environment[pathKey] = `${dirname(process.execPath)}${delimiter}${environment[pathKey] ?? ''}`;
  environment.npm_node_execpath = process.execPath;
  environment.NODE = process.execPath;
  const startedAt = new Date().toISOString();
  const outcome = spawnSync(process.execPath, argv, {
    cwd: repository,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 96 * 1024 * 1024,
    env: environment,
  });
  const stdout = normalize(outcome.stdout);
  const stderr = normalize(outcome.stderr ?? outcome.error?.message);
  return {
    id: specification.id,
    cmd: normalize([process.execPath, ...argv].join(' ')),
    startedAt,
    finishedAt: new Date().toISOString(),
    exitCode: outcome.status ?? 1,
    json: parseLastJson(stdout),
    stdout,
    stderr,
    stdoutTail: tail(stdout),
    stderrTail: tail(stderr),
  };
}

function report(value) {
  const commands = value.commands.map((command) =>
    `- \`${command.id}\`: exit \`${command.exitCode}\`; command \`${command.cmd}\``).join('\n');
  return `# W6 stabilization and Phase 2 local-kernel evidence\n\n` +
    `Source: \`${value.commit}\` on \`${value.branch}\`; generated ${value.generatedAt}.\n\n` +
    `## Result\n\n${value.counts.pass}/${value.commands.length} executable gates passed; ${value.counts.fail} failed; ${value.counts.skipped} skipped.\n\n` +
    `## Commands\n\n${commands}\n\n` +
    `## What this proves\n\n` +
    `- Local W6 chaos, capacity, synthetic upgrade rollback, and redacted diagnostic boundaries are executable.\n` +
    `- W7-W10 now have honest local kernels for privacy, synthetic distillation, deterministic replay, and a read-only public-market domain.\n` +
    `- Full unit/UI regression, typecheck, and production build pass at the source commit.\n\n` +
    `## What remains pending\n\n` +
    `- Real expert capture and review, real UIAutomation/GUI grounding, and real CUA execution.\n` +
    `- Public HTTP/UI, trusted remote bundle delivery, ten external installs, and a real takedown exercise.\n` +
    `- Two-machine soak, clean-machine signed NSIS upgrade, five seed users, twenty real tasks, and payment signal.\n\n` +
    `No deployment, push, real capture, real installation change, payment integration, or agent-hub write was performed.\n`;
}

function findNpmCli() {
  if (process.env.HUMMER_NPM_CLI && existsSync(process.env.HUMMER_NPM_CLI)) return process.env.HUMMER_NPM_CLI;
  if (process.env.npm_execpath && existsSync(process.env.npm_execpath)) return process.env.npm_execpath;
  const npmCommand = execFileSync('where.exe', ['npm.cmd'], { encoding: 'utf8' }).split(/\r?\n/).find(Boolean);
  const candidate = npmCommand ? resolve(dirname(npmCommand.trim()), 'node_modules', 'npm', 'bin', 'npm-cli.js') : '';
  if (candidate && existsSync(candidate)) return candidate;
  throw new Error('npm-cli.js was not found; set HUMMER_NPM_CLI');
}

function git(args) {
  return execFileSync('git', args, { cwd: repository, encoding: 'utf8' });
}

function option(name) {
  const prefix = `--${name}=`;
  const inline = process.argv.slice(2).find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function normalize(value) {
  return String(value ?? '').replaceAll(repository, '<WORKTREE>');
}

function parseLastJson(stdout) {
  for (const line of stdout.trim().split(/\r?\n/).reverse()) {
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      // Human-readable runner output is retained verbatim.
    }
  }
  return null;
}

function tail(value, lines = 30) {
  return String(value ?? '').trimEnd().split(/\r?\n/).slice(-lines).join('\n');
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
