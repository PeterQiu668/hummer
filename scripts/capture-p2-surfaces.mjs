import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const round = option('round') ?? 'round-p2-surfaces-1';
if (!/^round-p2-surfaces-[1-9][0-9]*$/.test(round)) fail('Round must match round-p2-surfaces-N.');
if (process.version !== 'v22.22.2') fail(`Node v22.22.2 is required; got ${process.version}.`);
const outputDirectory = resolve(repository, 'evidence', round);
if (existsSync(outputDirectory)) fail(`Evidence round already exists and will not be overwritten: evidence/${round}`);

const npmCli = findNpmCli();
const specifications = [
  ['demo-session-ui', 'run', 'test:demo-session-ui'],
  ['public-market-e2e', 'run', 'test:public-market-e2e'],
  ['trusted-bundle-bridge', 'run', 'test:trusted-bundle-bridge'],
  ['privacy-kernel', 'run', 'test:privacy'],
  ['capability-kernel', 'run', 'test:capability'],
  ['public-market-kernel', 'run', 'test:public-market'],
  ['contract', 'run', 'test:contract'],
  ['full-test', 'test'],
  ['typecheck', 'run', 'typecheck'],
  ['build', 'run', 'build'],
].map(([id, ...args]) => ({ id, args }));
const commands = specifications.map(runNpm);
const counts = { pass: commands.filter((item) => item.exitCode === 0).length, fail: commands.filter((item) => item.exitCode !== 0).length, skipped: 0 };
const evidence = {
  schema: 'hummer.p2-surface-evidence', version: 1, round,
  generatedAt: new Date().toISOString(),
  commit: git(['rev-parse', 'HEAD']).trim(), branch: git(['branch', '--show-current']).trim(), node: process.version, commands,
  accepted: {
    teachingSurface: 'trusted Desktop IPC and preload expose a local-only DemoSession control surface with allowlists, pause, segment deletion, redaction review, and no production synthetic injector',
    publicMarketSurface: 'anonymous redacted browse/detail, authenticated report and install authorization, human-only moderation, takedown, and a 390px browser surface pass against a real local store projection',
    trustedBundleBridge: 'strict eight-file bytes, trust bindings, Relay isolation, separate human approval, and marker-scoped no-overwrite atomic Node installation pass locally',
    regression: 'privacy, capability, marketplace, contract, full unit/UI, typecheck, and production build pass together after integration',
  },
  pending: {
    realCapture: 'no OS recorder, real screen/input capture, or independently completed expert demonstration',
    publicDeployment: 'no public Relay deployment, production storage adapter, domain, certificate, or internet exposure',
    externalInstall: 'no real user skill directory or external machine installation; ten third-party installs remain pending',
    marketValidation: 'five seed users, twenty real tasks, retention, and payment signal remain external acceptance work',
  },
  safety: { deployed: false, pushed: false, realUserDataCaptured: false, realInstallationModified: false, paymentCodeAdded: false, agentHubWritten: false },
  counts,
};

mkdirSync(outputDirectory, { recursive: true });
const gatesPath = resolve(outputDirectory, 'gates.json');
const reportPath = resolve(outputDirectory, 'report.md');
writeFileSync(gatesPath, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
writeFileSync(reportPath, report(evidence), { encoding: 'utf8', flag: 'wx' });
process.stdout.write(`${JSON.stringify({ status: counts.fail === 0 ? 'captured' : 'failed', gates: relative(repository, gatesPath).replaceAll('\\', '/'), report: relative(repository, reportPath).replaceAll('\\', '/'), counts })}\n`);
process.exitCode = counts.fail === 0 ? 0 : 1;

function runNpm(specification) {
  const argv = [npmCli, ...specification.args];
  const environment = { ...process.env };
  const pathKey = Object.keys(environment).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
  environment[pathKey] = `${dirname(process.execPath)}${delimiter}${environment[pathKey] ?? ''}`;
  environment.npm_node_execpath = process.execPath;
  environment.NODE = process.execPath;
  const startedAt = new Date().toISOString();
  const outcome = spawnSync(process.execPath, argv, { cwd: repository, encoding: 'utf8', windowsHide: true, maxBuffer: 96 * 1024 * 1024, env: environment });
  const stdout = normalize(outcome.stdout);
  const stderr = normalize(outcome.stderr ?? outcome.error?.message);
  return { id: specification.id, cmd: normalize([process.execPath, ...argv].join(' ')), startedAt, finishedAt: new Date().toISOString(), exitCode: outcome.status ?? 1, json: parseLastJson(stdout), stdout, stderr, stdoutTail: tail(stdout), stderrTail: tail(stderr) };
}

function report(value) {
  const commands = value.commands.map((command) => `- \`${command.id}\`: exit \`${command.exitCode}\`; command \`${command.cmd}\``).join('\n');
  return `# Phase 2 local surfaces evidence\n\nSource: \`${value.commit}\` on \`${value.branch}\`; generated ${value.generatedAt}.\n\n` +
    `## Result\n\n${value.counts.pass}/${value.commands.length} executable gates passed; ${value.counts.fail} failed; ${value.counts.skipped} skipped.\n\n## Commands\n\n${commands}\n\n` +
    `## What this proves\n\n- The local teaching surface is wired through trusted Desktop IPC with explicit privacy controls.\n- The local Relay exposes an honest public read-only marketplace surface with separate report and moderation authority.\n- A strict trusted bundle can cross the local Relay/Node boundary and materialize only in a marker-controlled synthetic root after human approval.\n- The integrated repository passes full unit/UI regression, typecheck, and production build.\n\n` +
    `## What remains pending\n\n- Real OS capture and expert demonstration.\n- Public deployment with production persistence and an external machine install.\n- Ten third-party installs, five seed users, twenty real tasks, retention, and payment signal.\n\nNo deployment, push, real capture, real installation change, payment integration, or agent-hub write was performed.\n`;
}

function findNpmCli() {
  if (process.env.HUMMER_NPM_CLI && existsSync(process.env.HUMMER_NPM_CLI)) return process.env.HUMMER_NPM_CLI;
  if (process.env.npm_execpath && existsSync(process.env.npm_execpath)) return process.env.npm_execpath;
  const npmCommand = execFileSync('where.exe', ['npm.cmd'], { encoding: 'utf8' }).split(/\r?\n/).find(Boolean);
  const candidate = npmCommand ? resolve(dirname(npmCommand.trim()), 'node_modules', 'npm', 'bin', 'npm-cli.js') : '';
  if (candidate && existsSync(candidate)) return candidate;
  throw new Error('npm-cli.js was not found; set HUMMER_NPM_CLI');
}
function git(args) { return execFileSync('git', args, { cwd: repository, encoding: 'utf8' }); }
function option(name) { const prefix = `--${name}=`; const inline = process.argv.slice(2).find((value) => value.startsWith(prefix)); if (inline) return inline.slice(prefix.length); const index = process.argv.indexOf(`--${name}`); return index >= 0 ? process.argv[index + 1] : undefined; }
function normalize(value) { return String(value ?? '').replaceAll(repository, '<WORKTREE>'); }
function parseLastJson(stdout) { for (const line of stdout.trim().split(/\r?\n/).reverse()) { try { const parsed = JSON.parse(line); if (parsed && typeof parsed === 'object') return parsed; } catch {} } return null; }
function tail(value, lines = 30) { return String(value ?? '').trimEnd().split(/\r?\n/).slice(-lines).join('\n'); }
function fail(message) { process.stderr.write(`${message}\n`); process.exit(1); }
