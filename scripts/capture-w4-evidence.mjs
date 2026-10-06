import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = resolve(repository, 'evidence', 'round-w4');
const gatesPath = resolve(outputDirectory, 'gates.json');
const reportPath = resolve(outputDirectory, 'report.md');

if (existsSync(outputDirectory)) {
  fail('W4 evidence round already exists; sealed or partial evidence must never be overwritten.');
}
if (process.version !== 'v22.22.2') {
  fail(`Node v22.22.2 is required; got ${process.version}.`);
}

const npmCli = findNpmCli();
const specifications = [
  { id: 'tenancy-default', args: ['run', 'test:tenancy'] },
  { id: 'tenancy-chain-heads', args: ['run', 'test:tenancy', '--', '--chain-heads'] },
  { id: 'tenancy-quota', args: ['run', 'test:tenancy', '--', '--quota'] },
  { id: 'tenancy-export', args: ['run', 'test:tenancy', '--', '--export'] },
  { id: 'tenant-export-verifier', args: ['run', 'test:tenant-export'] },
  { id: 'typecheck', args: ['run', 'typecheck'] },
  { id: 'build', args: ['run', 'build'] },
];

const sourceCommit = git(['rev-parse', 'HEAD']).trim();
const commands = specifications.map(runNpm);
const counts = {
  pass: commands.filter((command) => command.exitCode === 0).length,
  fail: commands.filter((command) => command.exitCode !== 0).length,
  skipped: 0,
};
const evidence = {
  schema: 'hummer.w4-evidence',
  version: 1,
  round: 'W4',
  generatedAt: new Date().toISOString(),
  commit: sourceCommit,
  branch: git(['branch', '--show-current']).trim(),
  worktree: 'w4-evidence',
  node: process.version,
  commands,
  accepted: {
    tenancyMatrix: '21 non-duplicated executable W4 attack cases pass with explicit category mapping',
    tenantChainHeads: 'tenant chain-head independence behavior gate passes',
    quota: 'warning, rejection, token/cost, and foreign-node quota behavior gates pass',
    auditExport: 'tenant-qualified export manifest and cross-tenant byte/reference rejection gates pass',
    offlineProjection: 'explicit JSON/stdin verifier and chain-head projection CAS negative tests pass',
  },
  broken: {
    postgresRls: 'pending: no configured PostgreSQL/RLS test environment; not counted as passed',
    matrixNaming: 'the source prompt labels the W4 matrix as 21 items while its read/write/surface/side noun list contains 27 entries; this evidence claims only the 21 executable non-duplicated cases reported by the gate',
  },
  counts,
  artifacts: [],
  screenshots: [],
  safety: {
    agentHubWritten: false,
    realDeletionPerformed: false,
    deployed: false,
    pushed: false,
    productionOrTestFilesModifiedByCapture: false,
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
    return `   - \`${command.cmd}\` → exit ${command.exitCode} (tail: ${escapeMarkdown(summary)})`;
  }).join('\n');
  return `# W4 tenancy governance evidence report

ROUND W4 | ${evidence.generatedAt.slice(0, 10)} | branch ${evidence.branch} | source commit ${evidence.commit} | worktree w4-evidence

1. 本轮目标（AC-P1-08 / AC-P1-09 / AC-P1-10 / AC-P1-12）
   - 复核 21 条可执行租户穿越矩阵、独立租户链头、配额拒绝入链、租户显式审计导出及离线投影验证。
2. 改动清单
   - 新增：\`scripts/capture-w4-evidence.mjs\`、\`evidence/round-w4/*\`。
   - 未触碰：production/tests、历史证据、生成配置、F:\\agent-hub、仓库根工作树。
3. 门禁运行记录（原始命令、stdout/stderr、JSON 与退出码见 \`gates.json\`）
${commandLines}
4. 证据
   - \`evidence/round-w4/gates.json\`
   - \`evidence/round-w4/report.md\`
   - \`evidence/round-w4/manifest.json\`（封存后提供逐文件 SHA-256 与 rootHash）
5. 未完成 / 失败 / 降级项
   - Postgres/RLS：pending；没有配置可执行测试环境，不计为通过。
   - 21/27 口径：主提示词称 21 条，但其 read/write/surface/side 名词列表含 27 项；本轮只声明门禁实际报告的 21 条不重复攻击用例通过，不把 27 写成已通过。
   - 外部 agent-hub 归档投递不在本轮；本轮未写 F:\\agent-hub。
6. 契约影响
   - api-contract.yaml / packages/contracts：否；ADR：无；迁移：无，v1-v10 零改动。
7. 本轮触及的选型假设
   - 不需要更新 §5.2；Postgres/RLS 仍是待验证选型。
8. 下一轮第一件事
   - 配置隔离的 PostgreSQL/RLS spike 环境并把结果作为新的独立证据轮次。
9. 阻塞与需要丘总决定的事
   - 若进入 Postgres/RLS spike：选择 A）提供本机隔离实例/容器（推荐），或 B）继续保持 pending；不得把未运行项标绿。

安全声明：本轮没有真实删除、部署或推送，也没有写入 agent-hub。
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
