import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = resolve(repository, 'evidence', 'round-w5');
const gatesPath = resolve(outputDirectory, 'gates.json');
const reportPath = resolve(outputDirectory, 'report.md');
const installerPath = resolve(repository, 'release', 'm5e', 'HUMMER-Setup-0.6.0-internal.1.exe');
const blockmapPath = `${installerPath}.blockmap`;

if (existsSync(outputDirectory)) fail('W5 evidence round already exists; sealed or partial evidence must never be overwritten.');
if (process.version !== 'v22.22.2') fail(`Node v22.22.2 is required; got ${process.version}.`);
if (!existsSync(installerPath) || !existsSync(blockmapPath)) fail('The W5 Windows installer and blockmap must be built before evidence capture.');
if (!process.env.HUMMER_CODEX_PATH || !existsSync(process.env.HUMMER_CODEX_PATH)) {
  fail('HUMMER_CODEX_PATH must identify the supported Codex CLI used by the packaged smoke gate.');
}

const npmCli = findNpmCli();
const specifications = [
  { id: 'capability', args: ['run', 'test:capability'] },
  { id: 'contracts', args: ['run', 'test:contract'] },
  { id: 'web-relay-browser', args: ['run', 'test:web-e2e'] },
  { id: 'tenancy', args: ['run', 'test:tenancy'] },
  { id: 'security', args: ['run', 'test:security'] },
  { id: 'fleet-idempotency', args: ['run', 'test:fleet', '--', '--idempotency'] },
  { id: 'full-test', args: ['test'] },
  { id: 'typecheck', args: ['run', 'typecheck'] },
  { id: 'build', args: ['run', 'build'] },
  { id: 'packaged-smoke-pinned-codex', args: ['run', 'test:desktop:packaged'] },
];

const sourceCommit = git(['rev-parse', 'HEAD']).trim();
const commands = specifications.map(runNpm);
const counts = {
  pass: commands.filter((command) => command.exitCode === 0).length,
  fail: commands.filter((command) => command.exitCode !== 0).length,
  skipped: 0,
};
const evidence = {
  schema: 'hummer.w5-evidence',
  version: 1,
  round: 'W5',
  generatedAt: new Date().toISOString(),
  commit: sourceCommit,
  branch: git(['branch', '--show-current']).trim(),
  worktree: 'phase0-fleet',
  node: process.version,
  commands,
  accepted: {
    remoteRelayBrowser: 'HTTPS-only authenticated Relay browser client, real task POSTs, explicit mobile batch confirmation, terminal 401/403 handling, and no persisted badge pass the browser integration gate',
    capabilityRegistry: 'tenant-bound capability registry, trials, immutable catalog snapshots, read-only shares, and install gate pass Memory and SQLite gates',
    capabilityPackage: 'self-describing deterministic eight-file Agent Skills export verifies actual bytes, hashes, receipt, permissions, paths, and no-overwrite install',
    capabilityUi: 'capability catalog renders Relay facts and exposes install only through a startup-injected trusted installer port',
    packagedApp: 'unsigned internal Windows installer builds and the unpacked app passes renderer, native SQLite, tenant, and isolation smoke with the supported pinned Codex CLI',
  },
  broken: {
    twoMachine: 'pending: no second physical Windows machine or external Relay was available; the browser gate is not claimed as two-machine evidence',
    trustedInstallerBridge: 'pending: deployment-specific browser-to-target trusted installer bridge is not wired',
    currentCodex: 'pending: host default Codex CLI 0.160.1 is not protocol-qualified; startup correctly rejects it and packaged smoke uses the supported 0.153.4 binary',
    signing: 'pending: the NSIS installer has Authenticode status NotSigned',
    productionIdentity: 'pending: production TLS/IdP badge provisioning and five real seed users require external coordination',
    postgresRls: 'pending: no configured PostgreSQL/RLS test environment; not counted as passed',
  },
  counts,
  artifacts: [artifact(installerPath), artifact(blockmapPath)],
  screenshots: ['dist/web-relay-e2e (ignored build output; 390x844 browser gate)'],
  safety: {
    agentHubWritten: false,
    realDeletionPerformed: false,
    deployed: false,
    pushed: false,
    installerExecuted: false,
    packagedUnpackedAppSmokeOnly: true,
  },
};

mkdirSync(outputDirectory, { recursive: true });
writeFileSync(gatesPath, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
writeFileSync(reportPath, report(evidence), { encoding: 'utf8', flag: 'wx' });

process.stdout.write(`${JSON.stringify({
  status: counts.fail === 0 ? 'captured' : 'failed',
  output: relative(repository, gatesPath).replaceAll('\\', '/'),
  report: relative(repository, reportPath).replaceAll('\\', '/'),
  counts,
})}\n`);
process.exitCode = counts.fail === 0 ? 0 : 1;

function artifact(path) {
  const bytes = readFileSync(path);
  return {
    path: relative(repository, path).replaceAll('\\', '/'),
    bytes: statSync(path).size,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

function runNpm(specification) {
  const argv = [npmCli, ...specification.args];
  const startedAt = new Date().toISOString();
  const environment = { ...process.env };
  const pathKey = Object.keys(environment).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
  environment[pathKey] = `${dirname(process.execPath)}${delimiter}${environment[pathKey] ?? ''}`;
  environment.npm_node_execpath = process.execPath;
  environment.NODE = process.execPath;
  const outcome = spawnSync(process.execPath, argv, {
    cwd: repository,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
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

function report(evidence) {
  const commandLines = evidence.commands.map((command) => {
    const summary = command.json
      ? `status=${command.json.status ?? 'n/a'}, assertions=${command.json.assertions ?? 'n/a'}, negativeCases=${command.json.negativeCases ?? 'n/a'}`
      : command.stdoutTail.split(/\r?\n/).filter(Boolean).at(-1) ?? '(no stdout)';
    return `   - \`${command.cmd}\` -> exit ${command.exitCode} (tail: ${escapeMarkdown(summary)})`;
  }).join('\n');
  const artifacts = evidence.artifacts.map((item) => `   - \`${item.path}\`: ${item.bytes} bytes, SHA-256 \`${item.sha256}\``).join('\n');
  return `# W5 internal beta foundation evidence report

ROUND W5 | ${evidence.generatedAt.slice(0, 10)} | branch ${evidence.branch} | source commit ${evidence.commit} | worktree phase0-fleet

1. 本轮目标
   - 打通远程 Relay 浏览器入口、手机批量派活、能力资产注册/分享/安装门禁、真实能力目录 UI，并形成可安装的 Windows 内测包。
2. 改动清单
   - Relay：远程 HTTPS + bearer、任务/审批/能力目录、Memory/SQLite 能力注册表。
   - Web：真实任务 POST、390px 批量派活、逐项结果、401/403 不重试；未配置时显式只读。
   - 能力：8 文件自描述 Agent Skills 导出、哈希/回执/权限/路径/覆盖保护、只读分享与受信安装决策。
   - 发布：W5 浏览器端到端门禁、Windows NSIS 内测包、内测运行手册。
3. 门禁运行记录（完整 stdout/stderr、JSON 与退出码见 \`gates.json\`）
${commandLines}
4. 产物
${artifacts}
   - \`evidence/round-w5/gates.json\`
   - \`evidence/round-w5/report.md\`
   - \`evidence/round-w5/manifest.json\`（封存后提供逐文件 SHA-256 与 rootHash）
5. 未完成 / 失败 / 降级项
   - 真实双机与外部 Relay：pending；本轮浏览器门禁使用 HTTPS route mock，不能冒充双机证据。
   - 受信安装桥：pending；UI 只接受启动时注入的 installer port，但实际部署桥尚未接线。
   - Codex 版本：主机默认 0.160.1 未做协议资格验证且被正确拒绝；打包 smoke 使用已验证的 0.153.4。
   - 代码签名：pending；安装包 Authenticode 为 NotSigned。
   - 生产 TLS/IdP、Postgres/RLS、5 名真实种子用户：均需外部环境或协调，不计为通过。
6. 契约影响
   - 已新增/加固能力包、分享、试跑、安装决策契约；Relay SQLite 迁移到 schema 15。Desktop 历史 v1-v10 未在 W5 修改。
7. 本轮触及的选型假设
   - 保持本地优先、显式审批、失败关闭；没有把浏览器 token 存入 localStorage，也没有允许 UI 直连系统安装门禁。
8. 下一轮第一件事
   - 在第二台 Windows 机器上接入真实 HTTPS Relay，完成 100 条任务双机 soak，并实现/验证目标机受信 installer bridge。
9. 阻塞与需要丘总决定的事
   - 提供第二台 Windows 机器和测试域名/IdP；确认是否为内测包购买/配置代码签名；选择 Codex 版本策略（继续精确 pin，或先对 0.160.1 做协议回归再扩大兼容范围）。

安全声明：本轮没有真实删除、安装、部署、推送或写入 agent-hub；仅生成并启动了未安装的 unpacked 内测应用。
`;
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

function git(args) {
  return execFileSync('git', args, { cwd: repository, encoding: 'utf8' });
}

function normalize(value) {
  return String(value ?? '').replaceAll(repository, '<WORKTREE>');
}

function parseLastJson(stdout) {
  for (const line of stdout.trim().split(/\r?\n/).reverse()) {
    try {
      const value = JSON.parse(line);
      if (value && typeof value === 'object') return value;
    } catch {
      // npm headers and test-runner output are intentionally retained verbatim.
    }
  }
  return null;
}

function tail(value, lines = 30) {
  return String(value ?? '').trimEnd().split(/\r?\n/).slice(-lines).join('\n');
}

function escapeMarkdown(value) {
  return String(value).replaceAll('`', '\\`').replaceAll('\n', ' ');
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
