import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron as electron } from 'playwright';

const root = process.cwd();
const baseUrl = 'http://127.0.0.1:4182';
const spikeRoot = resolve(root, 'spikes/m4-approval-rejection');
const dataDirectory = resolve(spikeRoot, 'facts');
const profileDirectory = resolve(spikeRoot, 'profile');
const evidencePath = resolve(spikeRoot, 'rejection-evidence.json');
const screenshotPath = resolve(root, 'dist/hummer-m4-approval-rejection.png');

for (const directory of [dataDirectory, profileDirectory]) {
  if (!directory.startsWith(spikeRoot)) throw new Error('Refusing to clean data outside the M4 approval spike directory');
  if (existsSync(directory)) rmSync(directory, { recursive: true, force: true });
}
mkdirSync(spikeRoot, { recursive: true });

const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4182', '--strictPort'], {
  cwd: root,
  stdio: 'pipe',
  windowsHide: true,
  env: { ...process.env, VITE_HUMMER_RUNTIME_ADAPTER: 'mock' },
});

let app;
try {
  await waitForServer(baseUrl);
  app = await electron.launch({
    args: [resolve(root, 'apps/desktop/dist/main.js'), '--disable-gpu', `--user-data-dir=${profileDirectory}`],
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      HUMMER_RENDERER_URL: baseUrl,
      HUMMER_CODEX_CWD: spikeRoot,
      HUMMER_DATA_DIR: dataDirectory,
    },
  });
  const page = await app.firstWindow();
  await ensureIdentity(page);
  await configureLocalTestEngine(page);
  await page.getByRole('heading', { name: '工作台' }).waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByRole('textbox', { name: '任务描述' }).fill('整理本周线索，写回客户管理系统前先给我确认');
  await page.getByRole('textbox', { name: '任务描述' }).press('Enter');
  await page.getByRole('button', { name: '开始干' }).click();
  await page.getByRole('button', { name: '拒绝本次操作' }).waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByText('审批策略').waitFor({ state: 'visible', timeout: 5_000 });
  await page.getByRole('button', { name: '拒绝本次操作' }).click();
  await page.getByText('已被拒绝', { exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByRole('button', { name: '查看审批证据' }).click();
  const dialog = page.getByRole('dialog', { name: '审批证据' });
  await dialog.waitFor({ state: 'visible', timeout: 10_000 });
  await dialog.getByText('approval.rejected', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
  const integrity = await page.evaluate(() => window.hummerPersistence?.verifyIntegrity(localStorage.getItem('hummer.auth.session') ?? ''));
  if (!integrity?.valid) throw new Error(`Domain event hash-chain integrity failed: ${JSON.stringify(integrity)}`);
  const evidenceText = (await dialog.textContent())?.replace(/\s+/g, ' ').trim() ?? '';
  if (!evidenceText.includes('approval.rejected')) throw new Error(`Approval evidence was not rendered: ${evidenceText}`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  const output = { generatedAt: new Date().toISOString(), dataDirectory, integrity, evidenceText, screenshotPath };
  writeFileSync(evidencePath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(output, null, 2));
} finally {
  if (app) {
    const process = app.process();
    await Promise.race([app.close(), delay(5_000)]);
    if (!process.killed) process.kill();
  }
  vite.kill();
}

async function ensureIdentity(page) {
  await page.waitForFunction(() => [...document.querySelectorAll('h1, h2')].some((node) => ['进入 HUMMER', '工作台'].includes(node.textContent?.trim() ?? '')), undefined, { timeout: 30_000 });
  if (await page.getByRole('heading', { name: '工作台' }).isVisible()) return;
  await page.getByLabel('公司名称').fill('HUMMER 审批拒绝验收企业');
  await page.getByLabel('你的姓名').fill('审批验收人');
  await page.getByLabel('邮箱或手机').fill('approval-rejection@example.test');
  await page.getByRole('button', { name: '创建并进入' }).click();
  const created = await Promise.race([
    page.getByRole('heading', { name: '进入 HUMMER' }).waitFor({ state: 'hidden', timeout: 15_000 }).then(() => 'created'),
    page.getByRole('alert').waitFor({ state: 'visible', timeout: 15_000 }).then(async () => `error:${await page.getByRole('alert').textContent()}`),
  ]);
  if (created !== 'created') throw new Error(`Identity creation failed: ${created}`);
}

async function configureLocalTestEngine(page) {
  await page.evaluate(async () => {
    const token = localStorage.getItem('hummer.auth.session');
    if (!token || !window.hummerEngineCredentials) throw new Error('Encrypted credential bridge or session is missing');
    await window.hummerEngineCredentials.configure({
      token,
      engineProfileId: 'deepseek-standard',
      credential: 'local-approval-test-placeholder',
    });
  });
  await page.reload();
}

async function waitForServer(url) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Vite is still starting.
    }
    await delay(250);
  }
  throw new Error(`Vite did not become reachable at ${url}`);
}
