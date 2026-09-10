import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { _electron as electron } from 'playwright';
import { configureInternalValidationDisplay } from './support/configure-e2e-engine.mjs';

const root = process.cwd();
const engineProfile = process.argv.find((argument) => argument.startsWith('--engine-profile='))?.split('=')[1] ?? 'openai-codex-validation';
if (engineProfile === 'deepseek-standard' && !process.env.DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY is required for the real DeepSeek planner E2E');
const evidenceClass = engineProfile === 'deepseek-standard' ? 'real-product-deepseek' : 'real-external-internal-validation';
const spikeDirectory = resolve(root, 'spikes/m5b-planner');
const dataDirectory = resolve(spikeDirectory, `.facts-${engineProfile}`);
const profileDirectory = resolve(spikeDirectory, `profile-${engineProfile}`);
const wireLogPath = resolve(spikeDirectory, `${engineProfile}-wire.jsonl`);
const evidencePath = resolve(spikeDirectory, `${engineProfile}-evidence.json`);
const codexPath = resolve(process.env.LOCALAPPDATA, 'hermes/node/codex.cmd');
const baseUrl = 'http://127.0.0.1:4183';
const fallbackSentences = [
  '确认目标与可验收结果',
  '读取本次授权范围内的合成资料',
  '执行任务并记录完整证据',
  '交付结果，涉及外部变化时先请你确认',
];
const tasks = [
  { slug: 'excel', input: '打开本机 Excel，汇总上月销售明细，生成部门月报，发送前让我确认' },
  { slug: 'contract', input: '审查这份软件实施合同，重点看付款、验收、责任上限和违约条款' },
  { slug: 'external-send', input: '把新版产品报价和上线日期整理成客户通知，准备外发给华东客户' },
  { slug: 'delete', input: '把客户资料全部删掉' },
  { slug: 'hiring', input: '对 20 份实施顾问简历做初筛，按项目经验和行业知识列出面试建议，不要自动淘汰' },
];

if (!existsSync(codexPath)) throw new Error(`Codex npm shim not found at ${codexPath}`);
mkdirSync(spikeDirectory, { recursive: true });
for (const path of [dataDirectory, profileDirectory]) if (existsSync(path)) rmSync(path, { recursive: true, force: true });
for (const path of [wireLogPath, evidencePath]) if (existsSync(path)) rmSync(path);

const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4183', '--strictPort'], {
  cwd: root,
  stdio: 'pipe',
  windowsHide: true,
  env: { ...process.env, VITE_HUMMER_RUNTIME_ADAPTER: 'codex', VITE_HUMMER_CODEX_PROTOCOL: 'app-server-jsonrpc' },
});

let app;
const plans = [];
let runError;
try {
  await waitForServer(baseUrl);
  app = await electron.launch({
    args: [resolve(root, 'apps/desktop/dist/main.js'), '--disable-gpu', `--user-data-dir=${profileDirectory}`],
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      HUMMER_RENDERER_URL: baseUrl,
      HUMMER_CODEX_CWD: root,
      HUMMER_CODEX_PATH: codexPath,
      HUMMER_CODEX_WIRE_LOG_PATH: wireLogPath,
      HUMMER_DATA_DIR: dataDirectory,
      HUMMER_ENGINE_PROFILE: engineProfile,
    },
  });
  const page = await app.firstWindow();
  page.on('console', (message) => { if (message.type() === 'error') console.error(`[renderer] ${message.text()}`); });
  await ensureIdentity(page);
  await page.getByRole('heading', { name: '工作台' }).waitFor({ state: 'visible', timeout: 30_000 });
  if (engineProfile === 'openai-codex-validation') {
    await configureInternalValidationDisplay(page);
    await page.getByRole('heading', { name: '工作台' }).waitFor({ state: 'visible', timeout: 30_000 });
    await page.getByLabel('选择模型').selectOption({ label: '旗舰' });
  }

  for (const [index, task] of tasks.entries()) {
    if (index > 0) await page.getByRole('button', { name: '改一下' }).click();
    const fallbackReasons = [];
    let card;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const composer = page.getByRole('textbox', { name: '任务描述' });
      await composer.fill(task.input);
      await composer.press('Enter');
      const planHeading = page.getByText('我理解你要做的是：', { exact: true });
      await planHeading.waitFor({ state: 'visible', timeout: 150_000 });
      card = planHeading.locator('xpath=ancestor::form');
      if (await card.getByText('模型生成计划', { exact: true }).count()) break;
      const fallbackBadge = card.getByText('演示计划 · 未经模型生成', { exact: true });
      fallbackReasons.push(await fallbackBadge.getAttribute('title') ?? 'unknown fallback');
      if (attempt === 2) {
        const body = await card.innerText();
        throw new Error(`Planner fell back twice for ${task.slug}: ${fallbackReasons.join(' | ')}; ${body.slice(0, 700)}`);
      }
      await page.getByRole('button', { name: '改一下' }).click();
    }
    if (!card) throw new Error(`Planner card was not created for ${task.slug}`);
    const understanding = await card.locator('ol li').evaluateAll((items) => items.map((item) => item.textContent?.replace(/^\s*\d+\s*/, '').trim() ?? '').filter(Boolean));
    if (understanding.some((item) => fallbackSentences.some((fallback) => item.includes(fallback)))) throw new Error(`Template sentence leaked into real ${task.slug} plan`);
    const cardText = (await card.innerText()).replace(/\s+/g, ' ').trim();
    if (task.slug === 'delete' && (!cardText.includes('data.delete*') || !cardText.includes('critical'))) throw new Error('Delete plan did not contain the critical data.delete* policy gate');
    await page.screenshot({ path: resolve(root, `dist/hummer-m5b-plan-${task.slug}.png`), fullPage: true });
    plans.push({ ...task, understanding, cardText, retryCount: fallbackReasons.length, fallbackReasons });
  }
  if (new Set(plans.map((plan) => JSON.stringify(plan.understanding))).size !== tasks.length) throw new Error('The five real plans did not produce five distinct understanding arrays');
} catch (error) {
  runError = error;
} finally {
  if (app) {
    const process = app.process();
    await Promise.race([app.close(), delay(5_000)]);
    if (!process.killed) process.kill();
  }
  vite.kill();
}

if (runError) throw runError;
const ledger = await readPlanningLedger(dataDirectory);
const evidence = {
  generatedAt: new Date().toISOString(),
  evidenceClass,
  engineProfile,
  codexVersion: '0.153.4',
  tasks: plans,
  planningOutcomes: ledger.outcomes,
  planningCosts: ledger.costs,
  receipts: ledger.receipts,
  fallbackSentenceCount: plans.reduce((count, plan) => count + plan.understanding.filter((item) => fallbackSentences.includes(item)).length, 0),
  distinctUnderstandingCount: new Set(plans.map((plan) => JSON.stringify(plan.understanding))).size,
};
if (engineProfile === 'deepseek-standard' && (ledger.costs.length !== tasks.length || ledger.receipts.some((receipt) => !receipt.costCount))) {
  throw new Error('DeepSeek planner E2E did not persist one priced planning receipt per task');
}
writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
const secretScan = [readFileSync(evidencePath, 'utf8'), existsSync(wireLogPath) ? readFileSync(wireLogPath, 'utf8') : ''].join('\n');
if (/\bsk-[A-Za-z0-9_-]{12,}\b/.test(secretScan)) throw new Error('Secret-shaped token leaked into planner evidence');
console.log(JSON.stringify({ evidencePath, wireLogPath, evidenceClass, engineProfile, planCount: plans.length, distinctUnderstandingCount: evidence.distinctUnderstandingCount, planningOutcomeCount: ledger.outcomes.length, planningCostCount: ledger.costs.length }, null, 2));

async function readPlanningLedger(directory) {
  const require = createRequire(resolve(root, 'apps/desktop/package.json'));
  const Database = require('better-sqlite3');
  const database = new Database(resolve(directory, 'hummer.sqlite3'), { readonly: true });
  try {
    const outcomes = database.prepare("SELECT id, tenant_id AS tenantId, session_id AS sessionId, verdict, evidence_ref AS evidenceRef, occurred_at AS occurredAt FROM outcome_events ORDER BY occurred_at").all();
    const costs = database.prepare("SELECT id, session_id AS sessionId, outcome_event_id AS outcomeEventId, model, input_tokens AS inputTokens, cached_input_tokens AS cachedInputTokens, output_tokens AS outputTokens, cost_cny AS costCny, pricing_source AS pricingSource FROM cost_ledger ORDER BY computed_at").all();
    database.close();
    const { openPersistence } = await import(pathToFileURL(resolve(root, 'apps/desktop/dist/persistence/database.js')).href);
    const persistence = openPersistence({ dataDirectory: directory });
    try {
      const receipts = outcomes.map((outcome) => {
        const receipt = persistence.buildOutcomeReceipt(outcome.tenantId, outcome.id);
        return { outcomeEventId: outcome.id, costCount: receipt.costs.length, totalCostCny: receipt.totalCostCny, chainIntegrity: receipt.chainIntegrity };
      });
      return { outcomes, costs, receipts };
    } finally {
      persistence.close();
    }
  } finally {
    if (database.open) database.close();
  }
}

async function ensureIdentity(page) {
  const identityGate = page.getByRole('heading', { name: '进入 HUMMER' });
  const workbenchHeading = page.getByRole('heading', { name: '工作台' });
  await Promise.race([identityGate.waitFor({ state: 'visible', timeout: 30_000 }), workbenchHeading.waitFor({ state: 'visible', timeout: 30_000 })]);
  if (await identityGate.isVisible()) {
    await page.getByLabel('公司名称').fill('HUMMER M5-B 验收企业');
    await page.getByLabel('你的姓名').fill('规划层验收人');
    await page.getByLabel('邮箱或手机').fill('planner-e2e@example.test');
    await page.getByRole('button', { name: '创建并进入' }).click();
    await identityGate.waitFor({ state: 'hidden', timeout: 15_000 });
  }
  if (!await workbenchHeading.isVisible()) await page.getByRole('button', { name: '工作台', exact: true }).click();
}

async function waitForServer(url) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try { const response = await fetch(url); if (response.ok) return; } catch { /* Vite is starting. */ }
    await delay(250);
  }
  throw new Error(`Vite did not become reachable at ${url}`);
}
