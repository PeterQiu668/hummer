import { spawn } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron as electron } from 'playwright';

const root = process.cwd();
const baseUrl = 'http://127.0.0.1:4178';
const dataDirectory = resolve(root, 'spikes/m2-persistence/facts');
const evidencePath = resolve(root, 'spikes/m2-persistence/restart-evidence.json');
const screenshotPath = resolve(root, 'dist/hummer-m2-restart.png');
if (!dataDirectory.startsWith(resolve(root, 'spikes/m2-persistence'))) throw new Error('Refusing to clean persistence data outside the M2 spike directory');
if (existsSync(dataDirectory)) rmSync(dataDirectory, { recursive: true, force: true });

const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4178', '--strictPort'], {
  cwd: root,
  stdio: 'pipe',
  windowsHide: true,
});

let app;
try {
  await waitForServer(baseUrl);
  app = await launchDesktop();
  let page = await app.firstWindow();
  await page.getByRole('heading', { name: '工作台' }).waitFor({ state: 'visible', timeout: 30_000 });
  const composer = page.getByRole('textbox', { name: '任务描述' });
  await composer.fill('整理本周线索并生成跟进清单，写回客户管理系统前先给我确认');
  await composer.press('Enter');
  await page.getByRole('button', { name: '开始干' }).click();
  await page.getByRole('button', { name: '确认更新' }).waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByRole('button', { name: '确认更新' }).click();
  await page.getByText(/已交付：任务结果/).first().waitFor({ state: 'visible', timeout: 15_000 });
  const beforeRestart = await readState(page);
  const integrityBefore = await page.evaluate(() => window.hummerPersistence?.verifyIntegrity());
  await closeDesktop(app);
  app = undefined;

  app = await launchDesktop();
  page = await app.firstWindow();
  await page.getByRole('heading', { name: '工作台' }).waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByText(/整理本周线索并生成跟进清单/).first().waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByText(/已交付：任务结果/).first().waitFor({ state: 'visible', timeout: 15_000 });
  const afterRestart = await readState(page);
  const integrityAfter = await page.evaluate(() => window.hummerPersistence?.verifyIntegrity());
  assertRestart(beforeRestart, afterRestart, integrityBefore, integrityAfter);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  const evidence = { dataDirectory, integrityBefore, integrityAfter, beforeRestart, afterRestart, screenshotPath };
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  if (app) await closeDesktop(app);
  vite.kill();
}

function launchDesktop() {
  return electron.launch({
    args: [resolve(root, 'apps/desktop/dist/main.js'), '--disable-gpu'],
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      HUMMER_RENDERER_URL: baseUrl,
      HUMMER_CODEX_CWD: resolve(root, 'spikes/m2-persistence'),
      HUMMER_DATA_DIR: dataDirectory,
    },
  });
}

async function closeDesktop(desktop) {
  const process = desktop.process();
  await Promise.race([desktop.close(), delay(5_000)]);
  if (!process.killed) process.kill();
}

async function readState(page) {
  return page.locator('[data-runtime-event-kind]').evaluateAll((nodes) => nodes.map((node) => ({
    sequence: Number(node.getAttribute('data-runtime-sequence')),
    kind: node.getAttribute('data-runtime-event-kind'),
    tool: node.getAttribute('data-runtime-tool') || undefined,
    text: node.textContent?.replace(/\s+/g, ' ').trim(),
  })));
}

function assertRestart(before, after, integrityBefore, integrityAfter) {
  if (!integrityBefore?.valid || !integrityAfter?.valid) throw new Error('Domain event hash-chain integrity check failed');
  if (after.length !== before.length || after.length < 5) throw new Error(`Restart changed trajectory length: ${before.length} -> ${after.length}`);
  for (const kind of ['approval', 'human_to_ai', 'result']) {
    if (!after.some((event) => event.kind === kind)) throw new Error(`Restarted trajectory is missing ${kind}`);
  }
}

async function waitForServer(url) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await delay(250);
  }
  throw new Error(`Vite did not become reachable at ${url}`);
}
