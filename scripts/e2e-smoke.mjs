import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const baseUrl = 'http://127.0.0.1:4175';
const vite = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4175', '--strictPort'],
  { cwd: process.cwd(), stdio: 'pipe', windowsHide: true },
);

let browserServer;

try {
  await waitForServer(baseUrl);
  browserServer = await chromium.launchServer({ headless: true });
  const browser = await chromium.connect(browserServer.wsEndpoint());
  const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
  const browserErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });

  await page.addInitScript(() => {
    localStorage.removeItem('hummer-v6');
  });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 });
  await page.getByRole('heading', { name: '工作台' }).waitFor({ state: 'visible', timeout: 15_000 });
  const composer = page.getByRole('textbox', { name: '任务描述' });
  await composer.waitFor({ state: 'visible', timeout: 5_000 });
  if (await page.getByText('预算', { exact: true }).count()) throw new Error('V5 empty state leaked execution budget');
  if (await page.getByText('桌面操作预览', { exact: true }).count()) throw new Error('V5 empty state leaked desktop preview');
  await page.getByText('公司本季重点').waitFor({ state: 'visible', timeout: 5_000 });
  await page.getByText('分身建议').waitFor({ state: 'visible', timeout: 5_000 });
  await page.getByLabel('选择模型').waitFor({ state: 'visible', timeout: 5_000 });
  await page.screenshot({ path: 'dist/hummer-v5-workbench-empty.png', fullPage: true });

  await page.getByRole('button', { name: /填入示例：整理本周线索/ }).click();
  await composer.press('Enter');
  await page.getByText('我理解你要做的是：', { exact: true }).waitFor({ state: 'visible', timeout: 5_000 });
  await page.screenshot({ path: 'dist/hummer-v5-workbench-plan.png', fullPage: true });
  await page.getByRole('button', { name: '开始干' }).click();
  await page.getByText(/目标下达：/).waitFor({ state: 'visible', timeout: 5_000 });

  const followUp = page.getByRole('textbox', { name: '在当前会话补充要求' });
  await followUp.fill('等一下，先只做华东的');
  await followUp.press('Enter');
  await page.getByText('等一下，先只做华东的', { exact: true }).first().waitFor({ state: 'visible', timeout: 5_000 });

  await page.getByRole('button', { name: '确认更新' }).waitFor({ state: 'visible', timeout: 5_000 });
  await page.getByRole('button', { name: '确认更新' }).click();
  await page.getByText(/已交付：任务结果/).first().waitFor({ state: 'visible', timeout: 5_000 });

  await page.screenshot({ path: 'dist/hummer-v5-workbench-delivered.png', fullPage: true });
  await page.getByRole('button', { name: '打开个人菜单' }).click();
  await page.getByRole('button', { name: '我的设置' }).click();
  await page.getByRole('heading', { name: '我的设置' }).waitFor({ state: 'visible', timeout: 5_000 });
  await page.getByLabel('关闭我的设置').click();
  await page.getByRole('button', { name: /能力与连接/ }).click();
  await page.getByRole('heading', { name: '能力与连接' }).waitFor({ state: 'visible', timeout: 5_000 });
  await page.getByRole('button', { name: /技能/ }).click();
  await page.getByText('线索整理与跟进', { exact: true }).waitFor({ state: 'visible', timeout: 5_000 });

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 });
  await mobile.getByRole('heading', { name: '工作台' }).waitFor({ state: 'visible', timeout: 5_000 });
  await delay(800);
  await mobile.screenshot({ path: 'dist/hummer-v5-mobile-workbench.png', fullPage: true });
  await mobile.getByRole('button', { name: '团队协作' }).click();
  await mobile.getByRole('heading', { name: '团队协作' }).waitFor({ state: 'visible', timeout: 5_000 });
  await mobile.getByRole('button', { name: '添加数字同事' }).click();
  await mobile.getByRole('heading', { name: '添加数字同事' }).waitFor({ state: 'visible', timeout: 5_000 });
  await mobile.getByRole('button', { name: '开始 7 天试用' }).first().click();
  await mobile.getByText('当前环境没有可写的组织事实源，未创建数字同事。', { exact: true }).waitFor({ state: 'visible', timeout: 5_000 });
  await mobile.screenshot({ path: 'dist/hummer-v5-mobile-smoke.png', fullPage: true });
  await mobile.close();
  if (browserErrors.length) throw new Error(`Browser console errors:\n${browserErrors.join('\n')}`);
  await browser.close();
  console.log('E2E smoke passed: V5 workday context -> plan -> execution -> approval -> settings -> capabilities -> browser organization write refusal.');
} finally {
  browserServer?.process()?.kill();
  vite.kill();
}

async function waitForServer(url) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The Vite child is still starting.
    }
    await delay(200);
  }
  throw new Error(`Vite did not become reachable at ${url}.`);
}
