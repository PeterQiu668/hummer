import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { createServer as createViteTransformer } from 'vite';
import { RelayHttpClient } from '../apps/node-agent/src/relay-http-client.mjs';

const repository = process.cwd();
const appUrl = 'http://127.0.0.1:4186';
const tenantId = 'tenant-browser-e2e';
const nodeId = 'node-mobile-codex';
const relayBadge = 'web-e2e-opaque-badge-never-persist';
const nodeBadge = 'web-e2e-node-badge-never-persist';
const underScopedBadge = 'web-e2e-under-scoped-badge-never-persist';
const invalidBadge = 'web-e2e-invalid-badge-never-persist';
const startedAt = new Date();
const evidenceRoot = resolve(repository, 'evidence');
const evidenceRound = parseEvidenceRound(process.argv.slice(2), startedAt);
const evidenceDir = resolve(evidenceRoot, evidenceRound);
const screenshotDir = resolve(evidenceDir, 'screenshots');
const gatePath = resolve(evidenceDir, 'gate.json');
const failurePath = resolve(evidenceDir, 'failure.json');
const viteOutput = [];
const relayRequestMetrics = new Map();
let assertionCount = 0;

if (!isWithin(evidenceRoot, evidenceDir)) throw new Error('evidence round must stay under evidence/');
if (existsSync(evidenceDir)) throw new Error(`evidence round already exists and will not be overwritten: ${evidenceRound}`);
mkdirSync(screenshotDir, { recursive: true });

const vite = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4186', '--strictPort'],
  { cwd: repository, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
);
vite.stdout.on('data', (chunk) => viteOutput.push(chunk.toString()));
vite.stderr.on('data', (chunk) => viteOutput.push(chunk.toString()));

let browser;
let browserChannel;
let relayApp;
let relayEvents;
let relayStore;
let transformer;

try {
  await waitForServer(appUrl);
  const relay = await startRealLoopbackRelay();
  ({ app: relayApp, events: relayEvents, store: relayStore, transformer } = relay);
  const relayBaseUrl = relay.baseUrl;
  check(/^http:\/\/127\.0\.0\.1:\d+$/.test(relayBaseUrl), `Relay did not listen on loopback: ${relayBaseUrl}`);

  const nodeClient = new RelayHttpClient({ baseUrl: relayBaseUrl, badgeToken: nodeBadge });
  await nodeClient.registerNode(nodeManifest(), { nodeId, tenantId });
  check((await relayStore.listNodes(tenantId, new Date().toISOString())).some((node) => node.nodeId === nodeId), 'production Node client did not register the node in the real Relay store');

  const bundledChromium = chromium.executablePath();
  browserChannel = existsSync(bundledChromium) ? 'playwright-chromium' : 'system-chrome';
  browser = await chromium.launch({
    headless: true,
    ...(browserChannel === 'system-chrome' ? { channel: 'chrome' } : {}),
  });

  const happy = await newConfiguredContext(relayBaseUrl, relayBadge);
  const relayRequests = [];
  const consoleEntries = [];
  const pageErrors = [];
  const page = await happy.newPage();
  page.on('request', (request) => {
    if (request.url().startsWith(relayBaseUrl)) relayRequests.push({ method: request.method(), url: request.url() });
  });
  page.on('console', (message) => consoleEntries.push(message.text()));
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await openWorkbench(page);

  await page.getByRole('button', { name: '开始做' }).click();
  await page.getByRole('heading', { name: '先看计划，再决定是否继续' }).waitFor({ state: 'visible' });
  await page.getByRole('option', { name: `${nodeId} · codex` }).first().waitFor({ state: 'attached' });

  await page.getByRole('textbox', { name: '你想完成什么' }).fill('整理本周客户资料并生成摘要');
  await page.getByRole('button', { name: '生成待确认计划' }).click();
  await page.getByText('等待你的确认', { exact: true }).waitFor({ state: 'visible' });
  check(await page.getByRole('button', { name: '确认计划' }).isEnabled(), 'explicit start-work confirmation must be enabled only after a pending plan exists');
  check((await relayStore.listTasks(tenantId, new Date().toISOString())).length === 0, 'a task reached Relay before explicit start-work confirmation');
  await page.getByRole('button', { name: '确认计划' }).click();
  await page.getByLabel('派发回执').waitFor({ state: 'visible' });
  await expectText(page.getByLabel('派发回执'), '任务已提交到 Relay');

  const first = page.getByRole('group', { name: '批量任务 1' });
  const second = page.getByRole('group', { name: '批量任务 2' });
  await first.getByRole('textbox', { name: '第 1 条目标' }).fill('生成客户 A 跟进摘要');
  await first.getByRole('textbox', { name: '第 1 条交付物' }).fill('outputs/customer-a.md');
  await first.getByRole('combobox', { name: '第 1 条目标节点' }).selectOption(nodeId);
  await second.getByRole('textbox', { name: '第 2 条目标' }).fill('生成客户 B 跟进摘要');
  await second.getByRole('textbox', { name: '第 2 条交付物' }).fill('outputs/customer-b.md');
  await second.getByRole('combobox', { name: '第 2 条目标节点' }).selectOption(nodeId);

  const sendBatch = page.getByRole('button', { name: '发送 2 条任务' });
  check(await sendBatch.isDisabled(), 'batch send must stay disabled before explicit confirmation');
  await page.getByRole('checkbox', { name: '我确认发送这 2 条任务' }).check();
  check(await sendBatch.isEnabled(), 'batch send must become enabled after explicit confirmation');
  await sendBatch.click();
  await first.getByText('已派发', { exact: true }).waitFor({ state: 'visible' });
  await second.getByText('已派发', { exact: true }).waitFor({ state: 'visible' });

  const storedTasks = await relayStore.listTasks(tenantId, new Date().toISOString());
  check(storedTasks.length === 3, `expected 3 tasks in the real Relay store, got ${storedTasks.length}`);
  check(storedTasks.every((task) => task.envelope.schema === 'hummer.task-envelope'), 'real Relay persisted a non-TaskEnvelope browser submission');
  check(new Set(storedTasks.map((task) => task.taskId)).size === 3, 'browser submissions did not preserve distinct idempotency keys');
  check(relayRequests.filter((entry) => entry.method === 'POST' && entry.url === `${relayBaseUrl}/v1/tasks/enqueue`).length === 3, 'happy-path browser must issue exactly 3 real enqueue POSTs');

  const claimed = await nodeClient.claimTask({ nodeId, tenantId });
  check(claimed?.envelope?.schema === 'hummer.task-envelope', 'production Node client did not read a browser-enqueued TaskEnvelope from the same Relay state');
  check((await relayStore.listTasks(tenantId, new Date().toISOString())).filter((task) => task.status === 'leased').length === 1, 'Node production client claim was not reflected in the shared Relay store');

  const leakSurface = await inspectLeakSurface(page);
  check(leakSurface.injectionConsumed, 'deployment injection must be consumed once before rendering');
  check(!JSON.stringify(leakSurface.localStorage).includes(relayBadge), 'badge leaked into localStorage');
  check(!leakSurface.visibleText.includes(relayBadge), 'badge leaked into visible UI');
  check(!consoleEntries.join('\n').includes(relayBadge), 'badge leaked into console output');
  check(pageErrors.length === 0, `browser page errors:\n${pageErrors.join('\n')}`);
  check(leakSurface.width.document <= leakSurface.width.viewport + 1, `390px page has horizontal overflow (${leakSurface.width.document}px)`);
  const configuredScreenshot = resolve(screenshotDir, 'configured-mobile.png');
  await page.screenshot({ path: configuredScreenshot, fullPage: true });
  await happy.close();

  const forbiddenScreenshot = await proveTerminalAuthorizationFailure({
    relayBaseUrl,
    badgeAfterNodeRead: underScopedBadge,
    expectedStatus: 403,
    expectedMessage: 'badge does not grant task.enqueue',
    suffix: 'forbidden',
  });
  const unauthorizedScreenshot = await proveTerminalAuthorizationFailure({
    relayBaseUrl,
    badgeAfterNodeRead: invalidBadge,
    expectedStatus: 401,
    expectedMessage: 'Bearer badge token is invalid or expired',
    suffix: 'unauthorized',
  });

  const unconfigured = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await unconfigured.addInitScript(seedBrowserIdentity, browserIdentity('unconfigured'));
  const readOnlyRelayRequests = [];
  const readOnlyPage = await unconfigured.newPage();
  readOnlyPage.on('request', (request) => {
    if (request.url().startsWith(relayBaseUrl)) readOnlyRelayRequests.push(request.url());
  });
  await openWorkbench(readOnlyPage);
  await readOnlyPage.getByRole('button', { name: '开始做' }).click();
  await readOnlyPage.getByText('Relay 未配置，当前只读，不能发送批量任务。', { exact: true }).waitFor({ state: 'visible' });
  check(await readOnlyPage.getByRole('button', { name: '发送 2 条任务' }).isDisabled(), 'unconfigured batch send must be disabled');
  await readOnlyPage.getByRole('textbox', { name: '你想完成什么' }).fill('验证未配置页面只读');
  await readOnlyPage.getByRole('button', { name: '生成待确认计划' }).click();
  await readOnlyPage.getByText('Relay 未配置，当前只读，不能发送任务。', { exact: true }).waitFor({ state: 'visible' });
  check(await readOnlyPage.getByRole('button', { name: '确认计划' }).isDisabled(), 'unconfigured start-work confirmation must be disabled');
  check(readOnlyRelayRequests.length === 0, 'unconfigured page must not contact the Relay');
  const unconfiguredScreenshot = resolve(screenshotDir, 'unconfigured-mobile.png');
  await readOnlyPage.screenshot({ path: unconfiguredScreenshot, fullPage: true });
  await unconfigured.close();

  const screenshots = [configuredScreenshot, forbiddenScreenshot, unauthorizedScreenshot, unconfiguredScreenshot].map(artifactReceipt);
  const gate = {
    schema: 'hummer.executable-gate-result',
    version: 1,
    gate: 'real-web-relay-e2e',
    mode: 'loopback-fastify-memory-browser-node',
    status: 'passed',
    capturedAt: new Date().toISOString(),
    toolchain: { node: process.version, platform: process.platform, arch: process.arch, browser: browserChannel },
    assertions: assertionCount,
    negativeCases: 7,
    checks: [{
      id: 'real-loopback-relay-browser-node',
      status: 'passed',
      evidence: [
        'formal createFleetRelayServer + FleetService + MemoryFleetStore listened on 127.0.0.1',
        'production RelayHttpClient registered the node and claimed a browser-enqueued TaskEnvelope from the same store',
        'production browser RemoteRelayClient read the real node and persisted 3 distinct TaskEnvelopes',
        '390x844 start-work and batch actions required explicit confirmation',
        'real 401 and 403 responses were terminal and each enqueue was attempted once',
        'unconfigured browser remained read-only and sent zero Relay requests',
        'opaque Relay badges were absent from localStorage, visible UI, console output, screenshots metadata, and gate output',
      ],
      requestMetrics: Object.fromEntries([...relayRequestMetrics.entries()].sort(([left], [right]) => left.localeCompare(right))),
      screenshots,
    }],
    limitations: [
      'Loopback Fastify with MemoryFleetStore only; this is not an external Relay, TLS termination, production IdP, deployment, or two-machine evidence.',
      'The test uses synthetic browser identity and static in-memory badges; it does not prove production badge issuance or revocation.',
      'Node and browser production clients share one local Relay process; no external device delivery is claimed.',
      'Electron IPC/Desktop host integration remains covered by its separate gates and is not exercised here.',
    ],
  };
  const serializedGate = `${JSON.stringify(gate, null, 2)}\n`;
  for (const secret of [relayBadge, nodeBadge, underScopedBadge, invalidBadge]) {
    check(!serializedGate.includes(secret), 'machine-readable gate leaked a badge');
  }
  gate.assertions = assertionCount;
  writeFileSync(gatePath, `${JSON.stringify(gate, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(`${JSON.stringify(gate)}\n`);
} catch (error) {
  const screenshots = existingScreenshotReceipts();
  const failure = {
    schema: 'hummer.executable-gate-result',
    version: 1,
    gate: 'real-web-relay-e2e',
    mode: 'loopback-fastify-memory-browser-node',
    status: 'failed',
    capturedAt: new Date().toISOString(),
    toolchain: { node: process.version, platform: process.platform, arch: process.arch, ...(browserChannel ? { browser: browserChannel } : {}) },
    assertions: assertionCount,
    error: safeError(error),
    screenshots,
    limitations: ['Failed attempt preserved without overwrite; it is not passing evidence.'],
  };
  writeFileSync(failurePath, `${JSON.stringify(failure, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  throw error;
} finally {
  await browser?.close().catch(() => undefined);
  relayEvents?.close();
  await relayApp?.close().catch(() => undefined);
  relayStore?.close();
  await transformer?.close().catch(() => undefined);
  vite.kill();
}

async function startRealLoopbackRelay() {
  const viteTransformer = await createViteTransformer({
    root: repository,
    configFile: false,
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
    resolve: {
      alias: {
        '@hummer/contracts': resolve(repository, 'packages/contracts/src/index.ts'),
        '@hummer/capability-runtime': resolve(repository, 'packages/capability-runtime/src/index.ts'),
      },
    },
    server: { middlewareMode: true },
  });
  const relayModule = await viteTransformer.ssrLoadModule('/apps/relay/src/index.ts');
  const store = new relayModule.MemoryFleetStore();
  const service = new relayModule.FleetService(store, relayModule.createSharedFleetValidators());
  const future = '2099-01-01T00:00:00.000Z';
  const authenticator = relayModule.createStaticBadgeTokenAuthenticator([
    {
      token: nodeBadge, tokenId: 'badge-web-e2e-node', tenantId, actorRef: `system:${nodeId}`, nodeId,
      scopes: ['node.register', 'node.heartbeat', 'task.claim', 'task.event', 'stream.connect', 'approval.request', 'approval.consume'],
      expiresAt: future,
    },
    {
      token: relayBadge, tokenId: 'badge-web-e2e-browser', tenantId, actorRef: 'human:web-e2e',
      scopes: ['node.read', 'task.read', 'approval.read', 'task.enqueue'], expiresAt: future,
    },
    {
      token: underScopedBadge, tokenId: 'badge-web-e2e-under-scoped', tenantId, actorRef: 'human:web-e2e',
      scopes: ['node.read'], expiresAt: future,
    },
  ]);
  const { app, events } = relayModule.createFleetRelayServer(service, { authenticator });
  app.addHook('onRequest', async (request, reply) => {
    if (request.method === 'OPTIONS') {
      setCorsHeaders(reply);
      return reply.status(204).send();
    }
  });
  app.addHook('onSend', async (request, reply, payload) => {
    setCorsHeaders(reply);
    const route = request.routeOptions?.url ?? new URL(request.url, 'http://loopback.invalid').pathname;
    const key = `${request.method} ${route} ${reply.statusCode}`;
    relayRequestMetrics.set(key, (relayRequestMetrics.get(key) ?? 0) + 1);
    return payload;
  });
  const baseUrl = await app.listen({ host: '127.0.0.1', port: 0 });
  return { app, events, store, transformer: viteTransformer, baseUrl };
}

function setCorsHeaders(reply) {
  reply.header('access-control-allow-origin', appUrl);
  reply.header('access-control-allow-headers', 'accept, authorization, content-type');
  reply.header('access-control-allow-methods', 'GET, POST, OPTIONS');
  reply.header('vary', 'origin');
}

async function newConfiguredContext(relayBaseUrl, badge) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(
    ({ baseUrl, initialBadge, identity }) => {
      let currentBadge = initialBadge;
      Object.defineProperty(window, '__hummerSetWebRelayBadgeForTest', {
        configurable: true,
        value: (nextBadge) => { currentBadge = nextBadge; },
      });
      window.hummerRemoteRelayDeployment = { baseUrl, getBadge: () => currentBadge };
      localStorage.setItem('hummer.auth.session', identity.session.token);
      localStorage.setItem('hummer.auth.session.browser', JSON.stringify(identity));
    },
    { baseUrl: relayBaseUrl, initialBadge: badge, identity: browserIdentity('configured') },
  );
  return context;
}

async function proveTerminalAuthorizationFailure({ relayBaseUrl, badgeAfterNodeRead, expectedStatus, expectedMessage, suffix }) {
  const context = await newConfiguredContext(relayBaseUrl, relayBadge);
  const page = await context.newPage();
  const enqueueRequests = [];
  const consoleEntries = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url() === `${relayBaseUrl}/v1/tasks/enqueue`) enqueueRequests.push(request.url());
  });
  page.on('console', (message) => consoleEntries.push(message.text()));
  await openWorkbench(page);
  await page.getByRole('button', { name: '开始做' }).click();
  await page.getByRole('option', { name: `${nodeId} · codex` }).first().waitFor({ state: 'attached' });
  await page.getByRole('textbox', { name: '你想完成什么' }).fill(`验证 ${expectedStatus} 不重试`);
  await page.getByRole('button', { name: '生成待确认计划' }).click();
  await page.getByText('等待你的确认', { exact: true }).waitFor({ state: 'visible' });
  await page.evaluate((nextBadge) => window.__hummerSetWebRelayBadgeForTest(nextBadge), badgeAfterNodeRead);
  await page.getByRole('button', { name: '确认计划' }).click();
  await page.getByRole('alert').getByText(expectedMessage, { exact: false }).waitFor({ state: 'visible' });
  await delay(400);
  check(enqueueRequests.length === 1, `${expectedStatus} enqueue must be attempted once without retry; got ${enqueueRequests.length}`);
  check(await page.getByRole('button', { name: '确认计划' }).isEnabled(), `${expectedStatus} failure must return the plan to pending confirmation`);
  check(await page.getByLabel('派发回执').count() === 0, `${expectedStatus} failure must not display a success receipt`);
  const leakSurface = await inspectLeakSurface(page);
  check(!JSON.stringify(leakSurface.localStorage).includes(badgeAfterNodeRead), `${expectedStatus} badge leaked into localStorage`);
  check(!leakSurface.visibleText.includes(badgeAfterNodeRead), `${expectedStatus} badge leaked into visible UI`);
  check(!consoleEntries.join('\n').includes(badgeAfterNodeRead), `${expectedStatus} badge leaked into console output`);
  const screenshot = resolve(screenshotDir, `auth-${suffix}-mobile.png`);
  await page.screenshot({ path: screenshot, fullPage: true });
  await context.close();
  return screenshot;
}

async function openWorkbench(page) {
  await page.goto(appUrl, { waitUntil: 'domcontentloaded', timeout: 40_000 });
  await ensureIdentity(page);
  await page.getByRole('heading', { name: '工作台' }).waitFor({ state: 'visible', timeout: 20_000 });
}

function browserIdentity(suffix) {
  const accountId = `account-web-e2e-${suffix}`;
  const humanUserId = `human-web-e2e-${suffix}`;
  return {
    account: { id: accountId, email: `web-e2e-${suffix}@example.test`, phone: null, displayName: '浏览器门禁验收员' },
    tenant: { id: tenantId, name: 'HUMMER Web E2E', slug: 'hummer-web-e2e' },
    membership: { id: `membership-web-e2e-${suffix}`, tenantId, accountId, humanUserId, role: 'owner' },
    session: { id: `auth-web-e2e-${suffix}`, token: `browser-session-${suffix}`, accountId, currentTenantId: tenantId, expiresAt: '2099-01-01T00:00:00.000Z' },
  };
}

function seedBrowserIdentity(identity) {
  localStorage.setItem('hummer.auth.session', identity.session.token);
  localStorage.setItem('hummer.auth.session.browser', JSON.stringify(identity));
}

function nodeManifest() {
  return {
    schema: 'hummer.node-manifest', version: 1, nodeId, tenantIds: [tenantId],
    platform: 'win32', agentVersion: '0.1.0',
    runtimes: [{ kind: 'codex', available: true, pinnedVersion: '0.153.4' }],
    capabilities: ['workspace.exec'],
    mcp: { endpoint: 'stdio://hummer-local', tools: ['workspace_exec'] },
    load: { running: 0, queued: 0 },
  };
}

async function inspectLeakSurface(page) {
  return page.evaluate(() => ({
    localStorage: Object.fromEntries(Object.entries(localStorage)),
    visibleText: document.body.innerText,
    injectionConsumed: window.hummerRemoteRelayDeployment === undefined,
    width: { viewport: window.innerWidth, document: document.documentElement.scrollWidth },
  }));
}

function artifactReceipt(path) {
  const bytes = readFileSync(path);
  return {
    path: relative(repository, path).replaceAll('\\', '/'),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.byteLength,
    viewport: { width: 390, height: 844 },
  };
}

function existingScreenshotReceipts() {
  return ['configured-mobile.png', 'auth-forbidden-mobile.png', 'auth-unauthorized-mobile.png', 'unconfigured-mobile.png']
    .map((name) => resolve(screenshotDir, name))
    .filter((path) => existsSync(path))
    .map(artifactReceipt);
}

function parseEvidenceRound(args, date) {
  const roundArgs = args.filter((argument) => argument.startsWith('--round='));
  if (roundArgs.length > 1 || args.some((argument) => !argument.startsWith('--round='))) {
    throw new Error('usage: e2e-web-relay.mjs [--round=round-safe-attempt-id]');
  }
  const generated = `round-p1-real-web-relay-e2e-${date.toISOString().replace(/[-:.]/g, '')}-${process.pid}`;
  const round = roundArgs[0]?.slice('--round='.length) || generated;
  if (!/^round-[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(round)) {
    throw new Error('evidence round must match round-[A-Za-z0-9][A-Za-z0-9._-]{0,95}');
  }
  return round;
}

function isWithin(parent, child) {
  const rel = relative(parent, child);
  return rel.length > 0 && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function safeError(error) {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of [relayBadge, nodeBadge, underScopedBadge, invalidBadge]) message = message.replaceAll(secret, '[REDACTED]');
  return { name: error instanceof Error ? error.name : 'Error', message };
}

async function expectText(locator, expected) {
  await locator.getByText(expected, { exact: false }).waitFor({ state: 'visible' });
}

function check(condition, message) {
  assertionCount += 1;
  if (!condition) throw new Error(message);
}

async function ensureIdentity(page) {
  const gate = page.getByRole('heading', { name: '进入 HUMMER' });
  if (!await gate.count()) return;
  await page.getByLabel('公司名称').fill('HUMMER Web E2E fallback');
  await page.getByLabel('你的姓名').fill('浏览器门禁验收员');
  await page.getByLabel('邮箱或手机').fill('web-e2e-fallback@example.test');
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
