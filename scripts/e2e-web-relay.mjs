import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const appUrl = 'http://127.0.0.1:4186';
const relayBaseUrl = 'https://relay.web-e2e.test';
const relayBadge = 'web-e2e-opaque-badge-never-persist';
const screenshotDir = 'dist/web-relay-e2e';
const viteOutput = [];

const vite = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4186', '--strictPort'],
  { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
);
vite.stdout.on('data', (chunk) => viteOutput.push(chunk.toString()));
vite.stderr.on('data', (chunk) => viteOutput.push(chunk.toString()));

let browser;
let browserChannel;

try {
  await waitForServer(appUrl);
  const bundledChromium = chromium.executablePath();
  browserChannel = existsSync(bundledChromium) ? 'playwright-chromium' : 'system-chrome';
  browser = await chromium.launch({
    headless: true,
    ...(browserChannel === 'system-chrome' ? { channel: 'chrome' } : {}),
  });

  const configured = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const relayRequests = [];
  const enqueueRequests = [];
  const consoleEntries = [];
  const pageErrors = [];

  // This is the only deployment injection in the configured browser context.
  // The application consumes the object before React renders and retains the
  // badge provider only in memory; neither value is inferred from storage/URL.
  await configured.addInitScript(
    ({ baseUrl, badge }) => {
      window.hummerRemoteRelayDeployment = { baseUrl, getBadge: () => badge };
    },
    { baseUrl: relayBaseUrl, badge: relayBadge },
  );
  await configured.route(`${relayBaseUrl}/**`, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders() });
      return;
    }
    const record = {
      method: request.method(),
      url: request.url(),
      authorization: request.headers().authorization ?? '',
      body: request.postDataJSON?.() ?? null,
    };
    relayRequests.push(record);
    if (request.method() === 'GET' && request.url() === `${relayBaseUrl}/v1/control/nodes`) {
      await json(route, 200, {
        nodes: [{
          nodeId: 'node-mobile-codex',
          tenantId: 'tenant-browser-e2e',
          status: 'online',
          lastSeenAt: '2026-10-07T09:00:00.000Z',
          manifest: {
            runtimes: [{ kind: 'codex', available: true }],
            capabilities: ['workspace.exec'],
          },
        }],
      });
      return;
    }
    if (request.method() === 'POST' && request.url() === `${relayBaseUrl}/v1/tasks/enqueue`) {
      enqueueRequests.push(record);
      if (enqueueRequests.length === 3) {
        await json(route, 403, {
          error: { code: 'scope_denied', message: 'badge does not grant task.enqueue' },
        });
      } else {
        await json(route, 200, {
          task: { taskId: `task-web-e2e-${enqueueRequests.length}`, status: 'queued' },
          inserted: true,
        });
      }
      return;
    }
    await json(route, 404, { error: { code: 'not_found', message: 'not found' } });
  });

  const page = await configured.newPage();
  page.on('console', (message) => consoleEntries.push(message.text()));
  page.on('pageerror', (error) => pageErrors.push(error.message));
  // A cold Vite dependency transform can take more than 20 seconds on the
  // Windows CI disk even after the health probe has answered.
  await page.goto(appUrl, { waitUntil: 'domcontentloaded', timeout: 40_000 });
  await ensureIdentity(page, 'configured');
  await page.getByRole('heading', { name: '工作台' }).waitFor({ state: 'visible', timeout: 20_000 });

  await page.getByRole('button', { name: '开始做' }).click();
  await page.getByRole('heading', { name: '先看计划，再决定是否继续' }).waitFor({ state: 'visible' });
  await page.getByRole('option', { name: 'node-mobile-codex · codex' }).first().waitFor({ state: 'attached' });

  await page.getByRole('textbox', { name: '你想完成什么' }).fill('整理本周客户资料并生成摘要');
  await page.getByRole('button', { name: '生成待确认计划' }).click();
  await page.getByText('等待你的确认', { exact: true }).waitFor({ state: 'visible' });
  await page.getByRole('button', { name: '确认计划' }).click();
  await page.getByLabel('派发回执').waitFor({ state: 'visible' });
  await expectText(page.getByLabel('派发回执'), '任务已提交到 Relay');

  const first = page.getByRole('group', { name: '批量任务 1' });
  const second = page.getByRole('group', { name: '批量任务 2' });
  await first.getByRole('textbox', { name: '第 1 条目标' }).fill('生成客户 A 跟进摘要');
  await first.getByRole('textbox', { name: '第 1 条交付物' }).fill('outputs/customer-a.md');
  await first.getByRole('combobox', { name: '第 1 条目标节点' }).selectOption('node-mobile-codex');
  await second.getByRole('textbox', { name: '第 2 条目标' }).fill('生成客户 B 跟进摘要');
  await second.getByRole('textbox', { name: '第 2 条交付物' }).fill('outputs/customer-b.md');
  await second.getByRole('combobox', { name: '第 2 条目标节点' }).selectOption('node-mobile-codex');

  const sendBatch = page.getByRole('button', { name: '发送 2 条任务' });
  assert(await sendBatch.isDisabled(), 'batch send must stay disabled before explicit confirmation');
  await page.getByRole('checkbox', { name: '我确认发送这 2 条任务' }).check();
  assert(await sendBatch.isEnabled(), 'batch send must become enabled after explicit confirmation');
  await sendBatch.click();
  await first.getByText('已派发', { exact: true }).waitFor({ state: 'visible' });
  await expectText(second, '失败（403）scope_denied');
  await expectText(second, 'badge does not grant task.enqueue');
  await delay(500);

  assert(enqueueRequests.length === 3, `expected one start-work and two batch POSTs, got ${enqueueRequests.length}`);
  assert(relayRequests.length >= 4, 'expected node-list and enqueue Relay requests');
  assert(relayRequests.every((entry) => entry.authorization === `Bearer ${relayBadge}`), 'every Relay request must carry the in-memory badge');
  assert(enqueueRequests[0].body?.schema === 'hummer.task-envelope', 'start-work must POST a TaskEnvelope');
  assert(enqueueRequests[1].body?.schema === 'hummer.task-envelope', 'batch item 1 must POST a TaskEnvelope');
  assert(enqueueRequests[2].body?.schema === 'hummer.task-envelope', 'batch item 2 must POST a TaskEnvelope');
  assert(enqueueRequests[1].body?.idempotencyKey !== enqueueRequests[2].body?.idempotencyKey, 'batch items need distinct idempotency keys');

  const leakSurface = await page.evaluate(() => ({
    localStorage: Object.fromEntries(Object.entries(localStorage)),
    visibleText: document.body.innerText,
    injectionConsumed: window.hummerRemoteRelayDeployment === undefined,
    width: { viewport: window.innerWidth, document: document.documentElement.scrollWidth },
  }));
  assert(leakSurface.injectionConsumed, 'deployment injection must be consumed once before rendering');
  assert(!JSON.stringify(leakSurface.localStorage).includes(relayBadge), 'badge leaked into localStorage');
  assert(!leakSurface.visibleText.includes(relayBadge), 'badge leaked into visible UI');
  assert(!consoleEntries.join('\n').includes(relayBadge), 'badge leaked into console output');
  assert(pageErrors.length === 0, `browser page errors:\n${pageErrors.join('\n')}`);
  assert(leakSurface.width.document <= leakSurface.width.viewport + 1, `390px page has horizontal overflow (${leakSurface.width.document}px)`);
  await page.screenshot({ path: `${screenshotDir}/configured-mobile.png`, fullPage: true });

  const unconfigured = await browser.newContext({ viewport: { width: 390, height: 844 } });
  let unconfiguredRelayRequests = 0;
  await unconfigured.route(`${relayBaseUrl}/**`, async (route) => {
    unconfiguredRelayRequests += 1;
    await route.abort('blockedbyclient');
  });
  const readOnlyPage = await unconfigured.newPage();
  await readOnlyPage.goto(appUrl, { waitUntil: 'domcontentloaded', timeout: 40_000 });
  await ensureIdentity(readOnlyPage, 'unconfigured');
  await readOnlyPage.getByRole('heading', { name: '工作台' }).waitFor({ state: 'visible', timeout: 20_000 });
  await readOnlyPage.getByRole('button', { name: '开始做' }).click();
  await readOnlyPage.getByText('Relay 未配置，当前只读，不能发送批量任务。', { exact: true }).waitFor({ state: 'visible' });
  assert(await readOnlyPage.getByRole('button', { name: '发送 2 条任务' }).isDisabled(), 'unconfigured batch send must be disabled');
  await readOnlyPage.getByRole('textbox', { name: '你想完成什么' }).fill('验证未配置页面只读');
  await readOnlyPage.getByRole('button', { name: '生成待确认计划' }).click();
  await readOnlyPage.getByText('Relay 未配置，当前只读，不能发送任务。', { exact: true }).waitFor({ state: 'visible' });
  assert(await readOnlyPage.getByRole('button', { name: '确认计划' }).isDisabled(), 'unconfigured start-work confirmation must be disabled');
  assert(unconfiguredRelayRequests === 0, 'unconfigured page must not contact the Relay');
  await readOnlyPage.screenshot({ path: `${screenshotDir}/unconfigured-mobile.png`, fullPage: true });

  await unconfigured.close();
  await configured.close();
  console.log([
    'Web Relay browser-client integration gate passed.',
    `- Playwright Chromium viewport: 390x844 (${browserChannel})`,
    '- HTTPS Relay route mock: node list + 3 authenticated TaskEnvelope POSTs',
    '- Batch: explicit confirmation, per-item success/403, no 403 retry',
    '- Unconfigured page: read-only, no Relay request',
    '- Badge: absent from localStorage, console, and visible UI',
    `- Screenshots (ignored): ${screenshotDir}`,
    'Scope: browser-client integration only; this is not external Relay or two-machine evidence.',
  ].join('\n'));
} finally {
  await browser?.close().catch(() => undefined);
  vite.kill();
}

function corsHeaders() {
  return {
    'access-control-allow-origin': appUrl,
    'access-control-allow-headers': 'accept, authorization, content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
  };
}

async function json(route, status, body) {
  await route.fulfill({
    status,
    headers: { ...corsHeaders(), 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });
}

async function expectText(locator, expected) {
  await locator.getByText(expected, { exact: false }).waitFor({ state: 'visible' });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function ensureIdentity(page, suffix) {
  const gate = page.getByRole('heading', { name: '进入 HUMMER' });
  if (!await gate.count()) return;
  await page.getByLabel('公司名称').fill(`HUMMER Web E2E ${suffix}`);
  await page.getByLabel('你的姓名').fill('浏览器门禁验收员');
  await page.getByLabel('邮箱或手机').fill(`web-e2e-${suffix}@example.test`);
  await page.getByRole('button', { name: '创建并进入' }).click();
  await gate.waitFor({ state: 'hidden', timeout: 8_000 });
}

async function waitForServer(url) {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    if (vite.exitCode !== null) {
      throw new Error(`Vite exited before becoming ready (${vite.exitCode}):\n${viteOutput.join('')}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await delay(200);
  }
  throw new Error(`Vite did not become reachable at ${url}:\n${viteOutput.join('')}`);
}
