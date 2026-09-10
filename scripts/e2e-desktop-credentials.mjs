import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron as electron } from 'playwright';

const root = process.cwd();
const credential = process.env.DEEPSEEK_API_KEY;
if (!credential) throw new Error('DEEPSEEK_API_KEY is required for the real encrypted-credential E2E');

const spikeDirectory = resolve(root, 'spikes/m5c-credentials');
const dataDirectory = resolve(spikeDirectory, 'facts');
const profileDirectory = resolve(spikeDirectory, 'profile');
const wireLogPath = resolve(spikeDirectory, 'deepseek-wire.jsonl');
const evidencePath = resolve(spikeDirectory, 'credential-evidence.json');
const codexPath = resolve(process.env.LOCALAPPDATA, 'hermes/node/codex.cmd');
const baseUrl = 'http://127.0.0.1:4184';

if (!existsSync(codexPath)) throw new Error(`Codex npm shim not found at ${codexPath}`);
mkdirSync(spikeDirectory, { recursive: true });
for (const path of [dataDirectory, profileDirectory]) if (existsSync(path)) rmSync(path, { recursive: true, force: true });
for (const path of [wireLogPath, evidencePath]) if (existsSync(path)) rmSync(path);

const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4184', '--strictPort'], {
  cwd: root,
  stdio: 'pipe',
  windowsHide: true,
  env: { ...process.env, VITE_HUMMER_RUNTIME_ADAPTER: 'codex', VITE_HUMMER_CODEX_PROTOCOL: 'app-server-jsonrpc' },
});

let desktop;
try {
  await waitForServer(baseUrl);
  desktop = await launchDesktop();
  let page = await desktop.firstWindow();
  await ensureIdentity(page);
  await openSettings(page);
  const credentialInput = page.getByLabel('\u6807\u51c6\u5bc6\u94a5');
  await credentialInput.fill(credential);
  await page.getByRole('button', { name: '\u4fdd\u5b58\u6807\u51c6\u5bc6\u94a5' }).click();
  await page.getByText('\u5df2\u914d\u7f6e · api.deepseek.com', { exact: true }).waitFor({ timeout: 15_000 });
  if (await credentialInput.inputValue()) throw new Error('Credential input retained plaintext after save');
  await closeDesktop(desktop);
  desktop = undefined;

  desktop = await launchDesktop();
  page = await desktop.firstWindow();
  await ensureIdentity(page);
  const status = await page.evaluate(async () => {
    const token = localStorage.getItem('hummer.auth.session');
    return window.hummerEngineProfiles?.list(token);
  });
  const standard = status?.find((profile) => profile.id === 'deepseek-standard');
  if (!standard?.available || standard.credentialStatus !== 'configured') throw new Error('Encrypted credential was not available after restart');

  const composer = page.getByRole('textbox', { name: '\u4efb\u52a1\u63cf\u8ff0' });
  await composer.fill('\u8bfb\u53d6\u5f53\u524d\u76ee\u5f55\u7684 README\uff0c\u751f\u6210\u4e09\u6761\u4e0a\u7ebf\u524d\u6458\u8981');
  await composer.press('Enter');
  const planBadge = page.getByText('\u6a21\u578b\u751f\u6210\u8ba1\u5212', { exact: true });
  await planBadge.waitFor({ state: 'visible', timeout: 150_000 });
  const planCard = planBadge.locator('xpath=ancestor::form');
  const understanding = await planCard.locator('ol li').allTextContents();
  const evidence = {
    generatedAt: new Date().toISOString(),
    evidenceClass: 'real-product-deepseek-encrypted-credential',
    credentialStatusAfterRestart: standard.credentialStatus,
    engineProfile: standard.id,
    dataDomain: standard.dataDomain,
    planningSucceeded: true,
    understanding,
  };
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');

  const persistedBytes = readFileSync(resolve(dataDirectory, 'hummer.sqlite3'));
  if (persistedBytes.includes(Buffer.from(credential))) throw new Error('SQLite contains the plaintext credential');
  const scan = [readFileSync(evidencePath, 'utf8'), existsSync(wireLogPath) ? readFileSync(wireLogPath, 'utf8') : ''].join('\n');
  if (scan.includes(credential) || /\bsk-[A-Za-z0-9_-]{12,}\b/.test(scan)) throw new Error('Credential leaked into evidence or wire log');
  console.log(JSON.stringify({ evidencePath, wireLogPath, planningSucceeded: true, credentialStatusAfterRestart: standard.credentialStatus }, null, 2));
} finally {
  if (desktop) await closeDesktop(desktop);
  vite.kill();
}

function launchDesktop() {
  const { DEEPSEEK_API_KEY: _removed, ...environmentWithoutCredential } = process.env;
  return electron.launch({
    args: [resolve(root, 'apps/desktop/dist/main.js'), '--disable-gpu', `--user-data-dir=${profileDirectory}`],
    env: {
      ...environmentWithoutCredential,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      HUMMER_RENDERER_URL: baseUrl,
      HUMMER_CODEX_CWD: root,
      HUMMER_CODEX_PATH: codexPath,
      HUMMER_CODEX_WIRE_LOG_PATH: wireLogPath,
      HUMMER_DATA_DIR: dataDirectory,
      HUMMER_ENGINE_PROFILE: 'deepseek-standard',
    },
  });
}

async function openSettings(page) {
  await page.getByRole('button', { name: '\u6253\u5f00\u4e2a\u4eba\u83dc\u5355' }).click();
  await page.getByRole('button', { name: '\u6211\u7684\u8bbe\u7f6e' }).click();
  await page.getByRole('heading', { name: '\u6211\u7684\u8bbe\u7f6e' }).waitFor({ state: 'visible' });
}

async function ensureIdentity(page) {
  const gate = page.getByRole('heading', { name: '\u8fdb\u5165 HUMMER' });
  const workbench = page.getByRole('heading', { name: '\u5de5\u4f5c\u53f0' });
  await Promise.race([gate.waitFor({ state: 'visible', timeout: 30_000 }), workbench.waitFor({ state: 'visible', timeout: 30_000 })]);
  if (await gate.isVisible()) {
    await page.getByLabel('\u516c\u53f8\u540d\u79f0').fill('HUMMER M5-C \u51ed\u636e\u9a8c\u6536');
    await page.getByLabel('\u4f60\u7684\u59d3\u540d').fill('\u51ed\u636e\u9a8c\u6536\u5458');
    await page.getByLabel('\u90ae\u7bb1\u6216\u624b\u673a').fill('credential-e2e@example.test');
    await page.getByRole('button', { name: '\u521b\u5efa\u5e76\u8fdb\u5165' }).click();
    await gate.waitFor({ state: 'hidden', timeout: 15_000 });
  }
  if (!await workbench.isVisible()) await page.getByRole('button', { name: '\u5de5\u4f5c\u53f0', exact: true }).click();
}

async function closeDesktop(app) {
  const process = app.process();
  await Promise.race([app.close(), delay(5_000)]);
  if (!process.killed) process.kill();
}

async function waitForServer(url) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try { const response = await fetch(url); if (response.ok) return; } catch { /* Vite is starting. */ }
    await delay(250);
  }
  throw new Error(`Vite did not become reachable at ${url}`);
}
