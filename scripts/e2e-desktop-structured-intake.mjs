// ADR-014 端到端：结构化派活文件经真实 Electron 文件夹接单落成 pending 工单。
// 只验证接单链路，不确认、不规划、不调用任何模型，因此运行时使用 mock。
// 执行环境准入关卡仍然生效：需要 HUMMER_CODEX_PATH 指向 0.153.4，且容器自检通过。
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron as electron } from 'playwright';

const root = process.cwd();
const spikeRoot = resolve(root, 'spikes/m5i-structured-intake');
const workspace = resolve(spikeRoot, 'workspace');
const inbox = resolve(workspace, 'inbox');
const dataDirectory = resolve(spikeRoot, 'facts');
const profileDirectory = resolve(spikeRoot, 'profile');
const evidencePath = resolve(spikeRoot, 'structured-intake-evidence.json');
const screenshotPath = resolve(spikeRoot, 'structured-intake.png');
const baseUrl = 'http://127.0.0.1:4196';
const codexPath = process.env.HUMMER_CODEX_PATH ?? resolve(process.env.LOCALAPPDATA ?? '', 'hermes/node/codex.cmd');

if (!existsSync(codexPath)) throw new Error(`Codex CLI for the runtime setup gate is unavailable at ${codexPath}`);
for (const target of [workspace, dataDirectory, profileDirectory]) {
  if (!target.startsWith(spikeRoot)) throw new Error('Refusing to clean outside the structured intake spike directory');
  if (existsSync(target)) rmSync(target, { recursive: true, force: true });
}
mkdirSync(inbox, { recursive: true });

const validTask = {
  schema: 'hummer.work-order-task',
  version: 1,
  title: '整理九月华东订单',
  target: '汇总订单并标出逾期项',
  expectedDeliverable: '订单汇总表与逾期清单',
  assignee: '销售运营分身',
  dueAt: '2026-10-10T18:00:00+08:00',
  attachmentNames: [],
  origin: { system: 'agent-hub', device: 'desktop-37dld71', taskId: 'task-20261006-001' },
};

const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4196', '--strictPort'], {
  cwd: root, stdio: 'pipe', windowsHide: true, env: { ...process.env, VITE_HUMMER_RUNTIME_ADAPTER: 'mock' },
});

let app;
try {
  await waitForServer(baseUrl);
  app = await electron.launch({
    args: [resolve(root, 'apps/desktop/dist/main.js'), '--disable-gpu', `--user-data-dir=${profileDirectory}`],
    env: {
      ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', HUMMER_RENDERER_URL: baseUrl,
      HUMMER_CODEX_CWD: workspace, HUMMER_CODEX_PATH: codexPath, HUMMER_DATA_DIR: dataDirectory,
    },
  });
  const page = await app.firstWindow();
  const token = await ensureIdentity(page);
  await page.evaluate(async ({ token, inbox }) => {
    if (!window.hummerWorkOrderIntake) throw new Error('Work order intake bridge is unavailable');
    await window.hummerWorkOrderIntake.configureInbox(token, inbox);
  }, { token, inbox });

  // agent-hub 的投递约定：先写临时名再原子改名，避免被读到半截（HUMMER-INTERFACE.md ①）。
  deliver('20261006-desktop-37dld71-orders.hummer-task.json', JSON.stringify(validTask));
  deliver('20261006-desktop-37dld71-broken.hummer-task.json', '{ "schema": "hummer.work-order-task", ');

  await page.getByText('待处理工单', { exact: true }).waitFor({ state: 'visible', timeout: 20_000 });
  await page.getByText('整理九月华东订单', { exact: true }).waitFor({ state: 'visible', timeout: 20_000 });
  await page.getByText(/无法解析的结构化任务/).first().waitFor({ state: 'visible', timeout: 20_000 });

  const state = await page.evaluate(async ({ token }) => ({
    pending: await window.hummerWorkOrderIntake.list(token),
    sessions: await window.hummerPersistence.listSessions(token),
    integrity: await window.hummerPersistence.verifyIntegrity(token),
  }), { token });

  const accepted = state.pending.find((record) => record.payload.title === '整理九月华东订单');
  const broken = state.pending.find((record) => String(record.payload.title).startsWith('无法解析的结构化任务'));
  assert(state.pending.length === 2, `expected 2 pending intakes, got ${state.pending.length}`);
  assert(accepted?.status === 'pending' && accepted.workOrderId === null, 'structured task must stay pending until a human confirms');
  assert(accepted.payload.assignee === '销售运营分身', 'assignee was not taken from the task file');
  assert(accepted.payload.dueAt === '2026-10-10T10:00:00.000Z', 'dueAt was not taken from the task file');
  assert(accepted.payload.origin?.device === 'desktop-37dld71', 'origin was not preserved');
  assert(broken?.payload.executable === false && String(broken.payload.preReadError).includes('结构化任务文件无效'), 'invalid task must be visible and non-executable');
  assert(state.sessions.length === 0, 'an unconfirmed intake started a runtime session');
  assert(state.integrity?.valid === true, 'domain event hash chain is not valid');

  const brokenConfirm = await page.evaluate(async ({ token, id }) => {
    try { await window.hummerWorkOrderIntake.confirm({ token, input: { id } }); return 'confirmed'; }
    catch (error) { return `rejected: ${error instanceof Error ? error.message : String(error)}`; }
  }, { token, id: broken.id });
  assert(brokenConfirm.startsWith('rejected'), 'an invalid structured task could be confirmed for execution');

  await page.screenshot({ path: screenshotPath, fullPage: true });
  const evidence = {
    generatedAt: new Date().toISOString(),
    accepted: { id: accepted.id, externalRef: accepted.externalRef, payload: accepted.payload, payloadEvidenceRef: accepted.payloadEvidenceRef },
    broken: { id: broken.id, preReadError: broken.payload.preReadError, confirmAttempt: brokenConfirm },
    sessionsBeforeConfirmation: state.sessions.length,
    integrity: state.integrity,
    screenshotPath,
  };
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  if (app) {
    const child = app.process();
    await Promise.race([app.close(), delay(5_000)]);
    if (!child.killed) child.kill();
  }
  vite.kill();
}

function deliver(name, content) {
  const temporary = resolve(inbox, `${name}.part`);
  writeFileSync(temporary, content, 'utf8');
  renameSync(temporary, resolve(inbox, name));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function ensureIdentity(page) {
  await page.waitForFunction(() => [...document.querySelectorAll('h1, h2')].some((node) => ['进入 HUMMER', '工作台'].includes(node.textContent?.trim() ?? '')), undefined, { timeout: 30_000 });
  if (await page.getByRole('heading', { name: '进入 HUMMER' }).isVisible()) {
    await page.getByLabel('公司名称').fill('结构化派活验收企业');
    await page.getByLabel('你的姓名').fill('派活责任人');
    await page.getByLabel('邮箱或手机').fill('structured-intake@example.test');
    await page.getByRole('button', { name: '创建并进入' }).click();
    await page.getByRole('heading', { name: '进入 HUMMER' }).waitFor({ state: 'hidden', timeout: 15_000 });
  }
  const token = await page.evaluate(() => localStorage.getItem('hummer.auth.session'));
  if (!token) throw new Error('Authentication token was not created');
  return token;
}

async function waitForServer(url) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return; } catch { /* Vite is still starting. */ }
    await delay(250);
  }
  throw new Error(`Vite did not become reachable at ${url}`);
}
