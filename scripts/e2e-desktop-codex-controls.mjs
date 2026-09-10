import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron as electron } from 'playwright';
import { configureInternalValidationDisplay, ensureE2eIdentity } from './support/configure-e2e-engine.mjs';

const mode = process.argv.includes('--interrupt') ? 'interrupt' : 'steer';
const root = process.cwd();
const workspace = resolve(root, 'spikes/codex-runtime');
const codexPath = resolve(process.env.LOCALAPPDATA, 'hermes/node/codex.cmd');
const baseUrl = 'http://127.0.0.1:4177';
const output = resolve(workspace, mode === 'steer' ? 'steered-summary.md' : 'interrupted-output.md');
const forbidden = resolve(workspace, 'original-summary.md');
const wireLogPath = resolve(workspace, `app-server-${mode}-wire.jsonl`);
const trajectoryPath = resolve(workspace, `app-server-${mode}-trajectory.json`);
const dataDirectory = resolve(workspace, `.facts-${mode}`);

for (const path of [output, forbidden, wireLogPath, trajectoryPath]) if (existsSync(path)) rmSync(path);
if (existsSync(dataDirectory)) rmSync(dataDirectory, { recursive: true, force: true });
if (!existsSync(codexPath)) throw new Error(`npm Codex shim not found at ${codexPath}`);

const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4177', '--strictPort'], {
  cwd: root,
  stdio: 'pipe',
  windowsHide: true,
  env: { ...process.env, VITE_HUMMER_RUNTIME_ADAPTER: 'codex', VITE_HUMMER_CODEX_PROTOCOL: 'app-server-jsonrpc' },
});

let app;
try {
  await waitForServer(baseUrl);
  app = await electron.launch({
    args: [resolve(root, 'apps/desktop/dist/main.js'), '--disable-gpu'],
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      HUMMER_RENDERER_URL: baseUrl,
      HUMMER_CODEX_CWD: workspace,
      HUMMER_CODEX_PATH: codexPath,
      HUMMER_CODEX_WIRE_LOG_PATH: wireLogPath,
      HUMMER_DATA_DIR: dataDirectory,
      HUMMER_ENGINE_PROFILE: 'openai-codex-validation',
    },
  });
  const page = await app.firstWindow();
  await ensureE2eIdentity(page, `control-${mode}`);
  await page.getByRole('heading', { name: '工作台' }).waitFor({ state: 'visible', timeout: 30_000 });
  await configureInternalValidationDisplay(page);
  await page.getByRole('heading', { name: '工作台' }).waitFor({ state: 'visible', timeout: 30_000 });
  const composer = page.getByRole('textbox', { name: '任务描述' });
  await composer.fill(mode === 'steer'
    ? 'First run PowerShell Start-Sleep -Seconds 20. Only after that, read input.txt and use apply_patch to create original-summary.md with one sentence. Do not create any file before the wait finishes.'
    : 'Run PowerShell Start-Sleep -Seconds 60 before doing anything else. Only after the wait, create interrupted-output.md.');
  await composer.press('Enter');
  await page.getByText('模型生成计划', { exact: true }).waitFor({ state: 'visible', timeout: 150_000 });
  await page.getByRole('button', { name: '开始干' }).click();
  await page.getByLabel('当前执行会话').waitFor({ state: 'visible', timeout: 30_000 });

  if (mode === 'steer') {
    const followUp = page.getByRole('textbox', { name: '在当前会话补充要求' });
    await followUp.fill('Change of plan: do not create original-summary.md. Instead read input.txt and use apply_patch to create steered-summary.md with the exact text STEER_ACCEPTED.');
    await followUp.press('Enter');
    await page.getByText('你补充了要求', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
    await page.getByText('任务运行完成', { exact: true }).waitFor({ state: 'visible', timeout: 180_000 });
    if (!existsSync(output)) throw new Error('Steer did not produce steered-summary.md');
    if (existsSync(forbidden)) throw new Error('Steer failed: original-summary.md was still produced');
    if (!readFileSync(output, 'utf8').includes('STEER_ACCEPTED')) throw new Error('Steered output did not contain the requested marker');
  } else {
    await page.getByRole('button', { name: '停止当前会话' }).click();
    await page.getByText(/Codex turn was interrupted\./).waitFor({ state: 'visible', timeout: 60_000 });
    if (existsSync(output)) throw new Error('Interrupted run still produced interrupted-output.md');
  }

  const trajectory = await readTrajectory(page);
  const wire = existsSync(wireLogPath) ? readFileSync(wireLogPath, 'utf8') : '';
  const outbound = wire.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)).filter((entry) => entry.channel === 'outbound').map((entry) => entry.raw);
  if (mode === 'steer' && !outbound.some((raw) => raw.includes('"method":"turn/steer"'))) throw new Error('Wire log did not contain turn/steer');
  if (mode === 'interrupt' && !outbound.some((raw) => raw.includes('"method":"turn/interrupt"'))) throw new Error('Wire log did not contain turn/interrupt');
  writeFileSync(trajectoryPath, `${JSON.stringify(trajectory, null, 2)}\n`, 'utf8');
  await page.screenshot({ path: resolve(root, `dist/hummer-m1-codex-${mode}.png`), fullPage: true });
  console.log(JSON.stringify({ mode, outputExists: existsSync(output), wireLogPath, trajectory }, null, 2));
} catch (error) {
  if (app) {
    const page = await app.firstWindow();
    await page.screenshot({ path: resolve(root, `dist/hummer-m1-codex-${mode}-failure.png`), fullPage: true });
    console.error(`page-state=${(await page.locator('body').innerText()).slice(0, 6000)}`);
  }
  if (existsSync(wireLogPath)) console.error(`wire-log=${readFileSync(wireLogPath, 'utf8').slice(-20_000)}`);
  throw error;
} finally {
  if (app) {
    const electronProcess = app.process();
    await Promise.race([app.close(), delay(5_000)]);
    if (!electronProcess.killed) electronProcess.kill();
  }
  vite.kill();
}

async function readTrajectory(page) {
  return page.locator('[data-runtime-event-kind]').evaluateAll((nodes) => nodes.map((node) => ({
    sequence: Number(node.getAttribute('data-runtime-sequence')),
    kind: node.getAttribute('data-runtime-event-kind'),
    tool: node.getAttribute('data-runtime-tool') || undefined,
    text: node.textContent?.replace(/\s+/g, ' ').trim(),
  })));
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
