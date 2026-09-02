import { spawn } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron as electron } from 'playwright';

const root = process.cwd();
const baseUrl = 'http://127.0.0.1:4179';
const spikeRoot = resolve(root, 'spikes/m4c-projects');
const dataDirectory = resolve(spikeRoot, 'facts');
const profileDirectory = resolve(spikeRoot, 'profile');
const evidencePath = resolve(spikeRoot, 'restart-evidence.json');
for (const directory of [dataDirectory, profileDirectory]) {
  if (!directory.startsWith(spikeRoot)) throw new Error('Refusing to clean outside M4-C evidence directory');
  if (existsSync(directory)) rmSync(directory, { recursive: true, force: true });
}
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4179', '--strictPort'], { cwd: root, stdio: 'pipe', windowsHide: true });
let app;
try {
  await waitForServer(baseUrl);
  app = await launch();
  let page = await app.firstWindow();
  const first = await ensureIdentity(page);
  const created = await page.evaluate(async ({ token }) => {
    const members = await window.hummerIdentity?.listMembers(token);
    const owner = members?.[0];
    if (!owner) throw new Error('Active responsibility pair is unavailable');
    return window.hummerProjects?.create({ token, input: {
      title: 'M4-C 重启验收项目', goal: '验证项目事实跨桌面重启保留', coordinatorTwinId: owner.twinId,
      collaborators: [], assignments: [], idempotencyKey: 'm4c-electron-restart-001',
    } });
  }, { token: first.token });
  if (!created?.id) throw new Error('Project was not created through Electron IPC');
  const beforeRestart = await page.evaluate(async ({ token }) => window.hummerProjects?.list(token), { token: first.token });
  await close(app); app = undefined;

  app = await launch();
  page = await app.firstWindow();
  const resumed = await ensureIdentity(page);
  const afterRestart = await page.evaluate(async ({ token }) => {
    const projects = await window.hummerProjects?.list(token);
    const integrity = await window.hummerPersistence?.verifyIntegrity(token);
    return { projects, integrity };
  }, { token: resumed.token });
  const retained = afterRestart.projects?.find((project) => project.id === created.id);
  if (!retained || retained.memberCount !== 2 || retained.activeAssignmentCount !== 0) throw new Error('Project responsibility pair did not survive desktop restart');
  if (!afterRestart.integrity?.valid) throw new Error('Project restart invalidated the domain event hash chain');
  const evidence = { generatedAt: new Date().toISOString(), created, beforeRestart, afterRestart, dataDirectory };
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  if (app) await close(app);
  vite.kill();
}
function launch() { return electron.launch({ args: [resolve(root, 'apps/desktop/dist/main.js'), '--disable-gpu', `--user-data-dir=${profileDirectory}`], env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', HUMMER_RENDERER_URL: baseUrl, HUMMER_DATA_DIR: dataDirectory, HUMMER_CODEX_CWD: spikeRoot } }); }
async function close(desktop) { const process = desktop.process(); await Promise.race([desktop.close(), delay(5_000)]); if (!process.killed) process.kill(); }
async function ensureIdentity(page) {
  await page.waitForFunction(() => [...document.querySelectorAll('h1, h2')].some((node) => node.textContent?.trim() === '进入 HUMMER' || node.textContent?.trim() === '工作台'), undefined, { timeout: 30_000 });
  const existing = await page.evaluate(() => localStorage.getItem('hummer.auth.session'));
  if (existing) return { token: existing };
  await page.getByLabel('公司名称').fill('M4-C 验收企业');
  await page.getByLabel('你的姓名').fill('项目验收员');
  await page.getByLabel('邮箱或手机').fill('m4c-projects@example.test');
  await page.getByRole('button', { name: '创建并进入' }).click();
  await delay(500);
  const alert = page.getByRole('alert');
  if (await alert.count()) throw new Error('Identity creation failed: ' + await alert.textContent());
  await page.getByRole('heading', { name: '进入 HUMMER' }).waitFor({ state: 'hidden', timeout: 15_000 });
  const token = await page.evaluate(() => localStorage.getItem('hummer.auth.session'));
  if (!token) throw new Error('Authentication token was not created');
  return { token };
}
async function waitForServer(url) { const deadline = Date.now() + 30_000; while (Date.now() < deadline) { try { if ((await fetch(url)).ok) return; } catch {} await delay(250); } throw new Error(`Vite did not become reachable at ${url}`); }