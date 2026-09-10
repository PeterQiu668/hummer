import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron as electron } from 'playwright';
import { configureInternalValidationDisplay, ensureE2eIdentity } from './support/configure-e2e-engine.mjs';

const root = process.cwd();
const workspace = resolve(root, 'spikes/codex-runtime');
const evidenceDirectory = resolve(root, 'spikes/m3-real-restart');
const dataDirectory = resolve(evidenceDirectory, 'facts');
const evidencePath = resolve(evidenceDirectory, 'restart-evidence.json');
const wireLogPath = resolve(evidenceDirectory, 'codex-restart-wire.jsonl');
const screenshotPath = resolve(root, 'dist/hummer-m3-real-restart.png');
const codexPath = resolve(process.env.LOCALAPPDATA, 'hermes/node/codex.cmd');
const baseUrl = 'http://127.0.0.1:4179';
const prompt = 'Read input.txt with a local command. Then run PowerShell Start-Sleep -Seconds 60. Do not write any files and do not finish before the wait.';

mkdirSync(evidenceDirectory, { recursive: true });
if (existsSync(dataDirectory)) rmSync(dataDirectory, { recursive: true, force: true });
for (const path of [evidencePath, wireLogPath]) if (existsSync(path)) rmSync(path);
if (!existsSync(codexPath)) throw new Error(`npm Codex shim not found at ${codexPath}`);

const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4179', '--strictPort'], {
  cwd: root,
  stdio: 'pipe',
  windowsHide: true,
  env: { ...process.env, VITE_HUMMER_RUNTIME_ADAPTER: 'codex', VITE_HUMMER_CODEX_PROTOCOL: 'app-server-jsonrpc' },
});

let app;
try {
  await waitForServer(baseUrl);
  app = await launchDesktop();
  let page = await app.firstWindow();
  await ensureE2eIdentity(page, 'restart-acceptance');
  await page.getByRole('heading', { name: '工作台' }).waitFor({ state: 'visible', timeout: 30_000 });
  await configureInternalValidationDisplay(page);
  await page.getByRole('heading', { name: '工作台' }).waitFor({ state: 'visible', timeout: 30_000 });
  const composer = page.getByRole('textbox', { name: '任务描述' });
  await composer.fill(prompt);
  await composer.press('Enter');
  await page.getByRole('button', { name: '开始干' }).click();
  await page.locator('[data-runtime-event-kind="tool"]').first().waitFor({ state: 'visible', timeout: 120_000 });
  await delay(750);

  const before = await readPersistedState(page);
  const active = before.sessions.find((session) => session.plan?.prompt === prompt);
  const beforeTerminal = active?.events.find((event) => event.type === 'status' && ['blocked', 'delivered', 'cancelled', 'interrupted'].includes(event.status));
  if (!active || beforeTerminal || active.events.length < 2) {
    throw new Error(`Expected an active real session before restart, got ${JSON.stringify(active)}`);
  }
  const sessionId = active.handle.sessionId;
  const preservedSequences = active.events.map((event) => event.sequence);
  await closeDesktop(app);
  app = undefined;

  app = await launchDesktop();
  page = await app.firstWindow();
  await ensureE2eIdentity(page, 'restart-acceptance');
  await page.getByRole('heading', { name: '工作台' }).waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByText('已中断', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
  const after = await readPersistedState(page);
  const recovered = after.sessions.find((session) => session.handle.sessionId === sessionId);
  if (!recovered) throw new Error(`Restart lost real session ${sessionId}`);
  if (!preservedSequences.every((sequence) => recovered.events.some((event) => event.sequence === sequence))) {
    throw new Error('Restart lost one or more previously persisted runtime events');
  }
  const terminal = recovered.events.at(-1);
  if (terminal?.type !== 'status' || terminal.status !== 'interrupted') throw new Error('Restart did not append a deterministic interrupted terminal event');
  if (!after.integrity?.valid) throw new Error(`Restart hash chain failed: ${JSON.stringify(after.integrity)}`);
  if (await page.getByRole('button', { name: '停止当前会话' }).isEnabled()) throw new Error('Dead runtime handle still exposes an enabled stop control');
  if (await page.getByRole('textbox', { name: '在当前会话补充要求' }).isEnabled()) throw new Error('Dead runtime handle still accepts steer input');

  const evidence = {
    occurredAt: new Date().toISOString(),
    sessionId,
    nativeSessionId: recovered.handle.nativeSessionId,
    before: { status: 'running', eventCount: active.events.length, sequences: preservedSequences },
    after: {
      status: 'interrupted',
      eventCount: recovered.events.length,
      events: recovered.events.map((event) => ({ sequence: event.sequence, type: event.type, status: event.status ?? null, tool: event.tool ?? null })),
    },
    integrity: after.integrity,
    screenshotPath,
    wireLogPath,
  };
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  await page.screenshot({ path: screenshotPath, fullPage: true });
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
      HUMMER_CODEX_CWD: workspace,
      HUMMER_CODEX_PATH: codexPath,
      HUMMER_CODEX_WIRE_LOG_PATH: wireLogPath,
      HUMMER_DATA_DIR: dataDirectory,
      HUMMER_ENGINE_PROFILE: 'openai-codex-validation',
    },
  });
}

async function closeDesktop(desktop) {
  const process = desktop.process();
  await Promise.race([desktop.close(), delay(5_000)]);
  if (!process.killed) process.kill();
}

async function readPersistedState(page) {
  return page.evaluate(async () => {
    const token = localStorage.getItem('hummer.auth.session');
    if (!token || !window.hummerPersistence) throw new Error('Authenticated persistence bridge is unavailable');
    return {
      sessions: await window.hummerPersistence.listSessions(token),
      integrity: await window.hummerPersistence.verifyIntegrity(token),
    };
  });
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
