import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const round = option('round') ?? 'round-p2-runtime-surfaces-1';
if (!/^round-p2-runtime-surfaces-[1-9][0-9]*$/.test(round)) fail('Round must match round-p2-runtime-surfaces-N.');
if (process.version !== 'v22.22.2') fail(`Node v22.22.2 is required; got ${process.version}.`);
const outputDirectory = resolve(repository, 'evidence', round);
if (existsSync(outputDirectory)) fail(`Evidence round already exists and will not be overwritten: evidence/${round}`);

const predecessorManifestPath = resolve(repository, 'evidence/round-p1-packaged-diagnostic-zip-integration-20261007a/manifest.json');
if (!existsSync(predecessorManifestPath)) fail('The sealed packaged-diagnostic predecessor manifest is missing.');
const predecessorManifest = JSON.parse(readFileSync(predecessorManifestPath, 'utf8'));
if (!/^[a-f0-9]{64}$/.test(predecessorManifest.rootHash ?? '')) fail('The packaged-diagnostic predecessor manifest is invalid.');

const npmCli = findNpmCli();
const specifications = [
  ['windows-uia-capture', 'run', 'test:windows-uia-capture'],
  ['seven-risk-approval-matrix', 'run', 'test:risk-approval-matrix'],
  ['trusted-bundle-durable', 'run', 'test:trusted-bundle-bridge'],
  ['capability-outcome-binding', 'run', 'test:capability-outcome-binding'],
  ['capability-independent-verifier', 'run', 'test:capability', '--', '--manifest'],
  ['diagnostic-zip', 'run', 'test:diagnostics'],
  ['demo-session-ui', 'run', 'test:demo-session-ui'],
  ['public-market-e2e', 'run', 'test:public-market-e2e'],
  ['privacy-kernel', 'run', 'test:privacy'],
  ['contract', 'run', 'test:contract'],
  ['full-test', 'test'],
  ['typecheck', 'run', 'typecheck'],
  ['build', 'run', 'build'],
].map(([id, ...args]) => ({ id, args }));
const commands = specifications.map(runNpm);
const counts = {
  pass: commands.filter((item) => item.exitCode === 0).length,
  fail: commands.filter((item) => item.exitCode !== 0).length,
  skipped: 0,
};
const evidence = {
  schema: 'hummer.p2-runtime-evidence', version: 1, round,
  generatedAt: new Date().toISOString(),
  commit: git(['rev-parse', 'HEAD']).trim(), branch: git(['branch', '--show-current']).trim(), node: process.version,
  predecessor: {
    path: relative(repository, predecessorManifestPath).replaceAll('\\', '/'),
    rootHash: predecessorManifest.rootHash,
    proves: 'the prior chain includes real loopback Web/Relay/Node screenshots and the compiled Electron diagnostic ZIP with atomic no-overwrite publication',
  },
  commands,
  accepted: {
    windowsUia: 'real local Windows UIAutomation reads bounded role and automationId metadata from a non-sensitive WinForms fixture and fails closed with zero writes',
    riskApproval: 'all seven controlled risk classes show target, risk and cost; six require a human click and unknown/new risks fail closed with zero preapproval enqueue',
    durableBundles: 'SQLite trusted-bundle persistence preserves immutable bytes and approval evidence across restart and fails without partial rows',
    outcomeBinding: 'capability drafts require an independently verified accepted HUMMER outcome receipt plus exact artifact bytes and provenance bindings',
    capabilityVerification: 'dependency-free verifier rejects outer and inner receipt forgery and validates the exact eight-file export',
    diagnosticZip: 'trusted Desktop export emits only allowlisted generated summaries and publishes a verified ZIP without partial or overwrite behavior',
    regression: 'privacy, marketplace, contracts, full unit/UI, typecheck and production build pass together after integration',
  },
  pending: {
    realExpert: 'the UIAutomation fixture is synthetic and is not a real expert demonstration or distillation acceptance run',
    externalMachines: 'no second physical machine, external Relay, public deployment, clean-machine install or external capability install',
    marketValidation: 'real users, real tasks, retention and payment signal remain external acceptance work',
    guiReplay: 'no real GUI/CUA side-effect replay has been authorized or proven',
  },
  safety: { deployed: false, pushed: false, realUserDataCaptured: false, realInstallationModified: false, paymentCodeAdded: false, agentHubWritten: false },
  counts,
};

mkdirSync(outputDirectory, { recursive: true });
const gatesPath = resolve(outputDirectory, 'gates.json');
const reportPath = resolve(outputDirectory, 'report.md');
writeFileSync(gatesPath, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
writeFileSync(reportPath, report(evidence), { encoding: 'utf8', flag: 'wx' });
process.stdout.write(`${JSON.stringify({ status: counts.fail === 0 ? 'captured' : 'failed', gates: pathOf(gatesPath), report: pathOf(reportPath), counts })}\n`);
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
  return `# Phase 2 local runtime evidence\n\nSource: \`${value.commit}\` on \`${value.branch}\`; generated ${value.generatedAt}.\n\n` +
    `## Result\n\n${value.counts.pass}/${value.commands.length} executable gates passed; ${value.counts.fail} failed; ${value.counts.skipped} skipped.\n\n## Commands\n\n${commands}\n\n` +
    `## What this proves\n\n- A real local Windows UIAutomation source can feed the bounded DemoSession path without screenshots, video, raw key capture or upload.\n- All seven controlled risk classes have an explicit UI approval/fail-closed matrix.\n- Capability drafts require verified accepted outcomes and exact artifact bytes; trusted bundles survive local SQLite restart without weakening immutable, tenant or node boundaries.\n- The independent capability verifier, diagnostic ZIP gate and integrated regression/build gates pass.\n- The predecessor hash binds the separately sealed real loopback Web/Relay/Node screenshots and compiled Desktop diagnostic ZIP.\n\n` +
    `## What remains pending\n\n- A real expert demonstration, distillation acceptance and authorized GUI/CUA replay.\n- A second machine, public deployment, clean-machine installs and external capability installs.\n- Real users, real tasks, retention and payment signal.\n\nNo deployment, push, real-user capture, real installation change, payment integration or agent-hub write was performed.\n`;
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
function pathOf(value) { return relative(repository, value).replaceAll('\\', '/'); }
function fail(message) { process.stderr.write(`${message}\n`); process.exit(1); }
