import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron as electron } from 'playwright';

const root = process.cwd();
const executablePath = resolve(process.env.HUMMER_PACKAGED_EXE ?? 'release/m5c/win-unpacked/HUMMER.exe');
const spikeDirectory = resolve(root, 'spikes/m5c-installer');
const dataDirectory = resolve(spikeDirectory, 'facts');
const profileDirectory = resolve(spikeDirectory, 'profile');
const codexPath = resolve(process.env.LOCALAPPDATA, 'hermes/node/codex.cmd');
if (!existsSync(executablePath)) throw new Error(`Packaged HUMMER executable not found: ${executablePath}`);
mkdirSync(spikeDirectory, { recursive: true });
for (const path of [dataDirectory, profileDirectory]) if (existsSync(path)) rmSync(path, { recursive: true, force: true });

const app = await electron.launch({
  executablePath,
  args: ['--disable-gpu', `--user-data-dir=${profileDirectory}`],
  env: {
    ...process.env,
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    HUMMER_DATA_DIR: dataDirectory,
    ...(existsSync(codexPath) ? { HUMMER_CODEX_PATH: codexPath } : {}),
  },
});

try {
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForFunction(() => Boolean(window.hummerEnvironmentDoctor && window.hummerIdentity), undefined, { timeout: 30_000 });
  const environment = await page.evaluate(() => window.hummerEnvironmentDoctor?.check());
  await delay(1_000);
  const companyField = page.getByLabel('公司名称');
  if (await companyField.count()) {
    await companyField.fill('HUMMER Packaged Smoke');
    await page.getByLabel('你的姓名').fill('Package Tester');
    await page.getByLabel('邮箱或手机').fill('package-e2e@example.test');
    await page.getByRole('button', { name: '创建并进入' }).click();
  }
  try {
    await page.getByText('真实工作环境已连接').waitFor({ timeout: 30_000 });
  } catch {
    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ').trim();
    throw new Error(`Packaged UI did not reach the real runtime state (url=${page.url()}, errors=${errors.join(' | ') || 'none'}, body=${body.slice(0, 500) || 'empty'})`);
  }
  const identity = await page.evaluate(() => {
    const token = localStorage.getItem('hummer.auth.session');
    return token ? window.hummerIdentity?.resumeSession(token) : null;
  });
  if (!identity?.tenant?.id) throw new Error('Packaged persistence bridge could not create a tenant');
  if (await page.getByText('产品演示 · 当前使用示例数据').count()) {
    throw new Error('Packaged desktop silently selected the mock runtime');
  }
  if (errors.length) throw new Error(`Packaged renderer errors: ${errors.join(' | ')}`);
  console.log(JSON.stringify({
    executablePath,
    rendererLoaded: true,
    sqliteNativeModuleLoaded: true,
    desktopRuntimeVisible: true,
    tenantId: identity.tenant.id,
    environment,
  }, null, 2));
} finally {
  const process = app.process();
  await Promise.race([app.close(), delay(5_000)]);
  if (!process.killed) process.kill();
}
