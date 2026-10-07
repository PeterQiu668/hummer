import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron as electron, chromium } from 'playwright';
import { createServer as createViteTransformer } from 'vite';
import { HummerNodeAgent } from '../apps/node-agent/src/node-agent.mjs';
import { MemoryExecutionJournal } from '../apps/node-agent/src/execution-journal.mjs';
import { RelayHttpClient } from '../apps/node-agent/src/relay-http-client.mjs';

const root = process.cwd();
const rendererUrl = 'http://127.0.0.1:4187';
const nodeId = 'node-hitl-codex';
const desktopBadge = 'desktop-hitl-control-badge-never-persist';
const webBadge = 'web-hitl-control-badge-never-persist';
const nodeBadge = 'node-hitl-badge-never-persist';
const startedAt = new Date();
const evidenceRoot = resolve(root, 'evidence');
const round = parseRound(process.argv.slice(2), startedAt);
const evidenceDir = resolve(evidenceRoot, round);
const screenshotsDir = resolve(evidenceDir, 'screenshots');
const gatePath = resolve(evidenceDir, 'gate.json');
const failurePath = resolve(evidenceDir, 'failure.json');
const codexProbeRoot = 'F:\\AgentWorkspace\\10_Working\\hummer\\codex';
const runtimeDir = resolve(codexProbeRoot, `hitl-runtime-${round}`);
const profileDir = resolve(runtimeDir, 'desktop-profile');
const dataDir = resolve(runtimeDir, 'desktop-data');
const codexProbe = resolve(codexProbeRoot, `hitl-codex-0.153.4-${round}.cmd`);
const viteOutput = [];
let assertions = 0;

if (!isWithin(evidenceRoot, evidenceDir)) throw new Error('evidence round must stay under evidence/');
if (existsSync(evidenceDir)) throw new Error(`evidence round already exists: ${round}`);
mkdirSync(screenshotsDir, { recursive: true });
mkdirSync(profileDir, { recursive: true });
mkdirSync(dataDir, { recursive: true });
mkdirSync(codexProbeRoot, { recursive: true });
writeFileSync(codexProbe, '@echo off\r\necho codex-cli 0.153.4\r\n', { encoding: 'utf8', flag: 'wx' });

const vite = spawn(process.execPath, [
  'node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4187', '--strictPort',
], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
vite.stdout.on('data', (chunk) => viteOutput.push(chunk.toString()));
vite.stderr.on('data', (chunk) => viteOutput.push(chunk.toString()));

let desktop;
let browser;
let relayApp;
let relayEvents;
let relayStore;
let transformer;
let nodeStream;

try {
  await waitForServer(rendererUrl);

  desktop = await launchDesktop();
  let desktopPage = await desktop.firstWindow();
  await createDesktopCompany(desktopPage);
  const identity = await readDesktopIdentity(desktopPage);
  check(identity.tenant?.id, 'Desktop bootstrap did not create a tenant');
  check(identity.membership?.humanUserId, 'Desktop bootstrap did not create a human identity');
  await closeDesktop(desktop);
  desktop = undefined;

  const relay = await startRelay(identity);
  ({ app: relayApp, events: relayEvents, store: relayStore, transformer } = relay);

  desktop = await launchDesktop({
    HUMMER_RELAY_BASE_URL: relay.baseUrl,
    HUMMER_RELAY_BADGE_TOKEN: desktopBadge,
    HUMMER_RELAY_TENANT_ID: identity.tenant.id,
    HUMMER_RELAY_ACTOR_REF: `account:${identity.account.id}`,
  });
  desktopPage = await desktop.firstWindow();
  await waitForWorkbench(desktopPage);

  const contract = await transformer.ssrLoadModule('/packages/contracts/src/index.ts');
  const client = new RelayHttpClient({ baseUrl: relay.baseUrl, badgeToken: nodeBadge, reconnect: { initialDelayMs: 5, maxDelayMs: 30 } });
  await client.registerNode(nodeManifest(identity.tenant.id), { nodeId, tenantId: identity.tenant.id });
  const executions = [];
  const states = [];
  const agent = createAgent({ client, tenantId: identity.tenant.id, contract, executions });
  nodeStream = client.connectAgent(agent, { onState: (state) => states.push(state) });
  await nodeStream.ready;

  browser = await chromium.launch({ headless: true, ...(existsSync(chromium.executablePath()) ? {} : { channel: 'chrome' }) });
  const webContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await webContext.addInitScript(({ baseUrl, badge, seededIdentity }) => {
    window.hummerRemoteRelayDeployment = { baseUrl, getBadge: () => badge };
    localStorage.setItem('hummer.auth.session', seededIdentity.session.token);
    localStorage.setItem('hummer.auth.session.browser', JSON.stringify(seededIdentity));
  }, {
    baseUrl: relay.baseUrl,
    badge: webBadge,
    seededIdentity: browserIdentity(identity.tenant.id),
  });
  const webPage = await webContext.newPage();
  await webPage.goto(rendererUrl, { waitUntil: 'domcontentloaded' });
  await waitForWorkbench(webPage);

  const approvedTitle = '网页派活后由桌面明确批准';
  await webPage.getByRole('button', { name: '开始做' }).click();
  await dispatchFromUi(webPage, approvedTitle);
  const approvedTask = await waitForTask(relayStore, identity.tenant.id, approvedTitle);
  await waitForState(states, approvedTask.taskId, 'pending_confirmation');
  const approvedRequest = approvalRequest(approvedTask, identity.tenant.id, 'approved');
  await agent.requestApproval(approvedTask.taskId, approvedRequest);
  await waitForApprovalButton(desktopPage, approvedRequest, '批准并继续');
  const approveShot = resolve(screenshotsDir, 'desktop-approval-pending.png');
  await desktopPage.screenshot({ path: approveShot, fullPage: true });
  await desktopPage.getByRole('button', { name: new RegExp(`批准并继续：.*${escapeRegex(approvedTask.taskId)}`) }).click();
  await waitForDecision(relayStore, identity.tenant.id, approvedRequest.requestId, 'approved');
  check(executions.length === 0, 'executor ran before Node consumed the approved decision');
  const approvedResult = await agent.confirmAndExecute(approvedTask.taskId);
  check(approvedResult.state === 'completed', `approved task ended as ${approvedResult.state}`);
  check(executions.length === 1, 'approved task did not execute exactly once');
  check((await relayStore.getTask(identity.tenant.id, approvedTask.taskId, now())).status === 'completed', 'approved Relay task is not completed');
  const webShot = resolve(screenshotsDir, 'web-dispatch-same-relay.png');
  await webPage.screenshot({ path: webShot, fullPage: true });

  await desktopPage.getByRole('button', { name: '开始做' }).click();
  const deniedTitle = '桌面派活后明确拒绝且零执行';
  await dispatchFromUi(desktopPage, deniedTitle);
  const deniedTask = await waitForTask(relayStore, identity.tenant.id, deniedTitle);
  await waitForState(states, deniedTask.taskId, 'pending_confirmation');
  const deniedRequest = approvalRequest(deniedTask, identity.tenant.id, 'denied');
  await agent.requestApproval(deniedTask.taskId, deniedRequest);
  await waitForApprovalButton(desktopPage, deniedRequest, '拒绝并停止本次任务');
  const denyShot = resolve(screenshotsDir, 'desktop-denial-pending.png');
  await desktopPage.screenshot({ path: denyShot, fullPage: true });
  await desktopPage.getByRole('button', { name: new RegExp(`拒绝并停止本次任务：.*${escapeRegex(deniedTask.taskId)}`) }).click();
  await waitForDecision(relayStore, identity.tenant.id, deniedRequest.requestId, 'denied');
  const deniedResult = await agent.confirmAndExecute(deniedTask.taskId);
  check(deniedResult.state === 'rejected', `denied task ended as ${deniedResult.state}`);
  check(executions.length === 1, 'denied task reached the executor');
  check((await relayStore.getTask(identity.tenant.id, deniedTask.taskId, now())).status === 'failed', 'denied Relay task is not terminal failed');

  const stoppedTitle = '桌面派活后由操作者停止';
  await desktopPage.getByRole('button', { name: '返回工作台' }).click();
  await waitForWorkbench(desktopPage);
  await desktopPage.getByRole('button', { name: '开始做' }).click();
  await desktopPage.getByText('当前没有待审批动作。', { exact: true }).waitFor({ state: 'visible', timeout: 20_000 });
  check(await desktopPage.getByRole('button', { name: /批准并继续：/ }).count() === 0, 'decided approvals resurfaced after the control panel remounted');
  await dispatchFromUi(desktopPage, stoppedTitle);
  const stoppedTask = await waitForTask(relayStore, identity.tenant.id, stoppedTitle);
  await waitForState(states, stoppedTask.taskId, 'pending_confirmation');
  const stopButton = desktopPage.getByRole('button', { name: `停止远程任务：${stoppedTitle}` });
  await stopButton.waitFor({ state: 'visible', timeout: 15_000 });
  await stopButton.click();
  await waitForState(states, stoppedTask.taskId, 'stopped');
  check((await agent.confirmAndExecute(stoppedTask.taskId)).state === 'stopped', 'late execution did not remain stopped');
  check(executions.length === 1, 'stopped task reached the executor');
  check((await relayStore.getTask(identity.tenant.id, stoppedTask.taskId, now())).status === 'blocked', 'stopped Relay task is not blocked');
  await desktopPage.getByText(`停止命令已由 Relay 记录：${stoppedTask.taskId}`, { exact: true }).waitFor({ state: 'visible' });
  const stopShot = resolve(screenshotsDir, 'desktop-task-stopped.png');
  await desktopPage.screenshot({ path: stopShot, fullPage: true });

  const terminalStop = await fetch(`${relay.baseUrl}/v1/tasks/${encodeURIComponent(approvedTask.taskId)}/stop`, {
    method: 'POST', headers: { authorization: `Bearer ${desktopBadge}`, 'content-type': 'application/json' }, body: '{}',
  });
  check(terminalStop.status === 409, `completed task stop returned ${terminalStop.status}, expected 409`);
  check((await relayStore.getTask(identity.tenant.id, approvedTask.taskId, now())).status === 'completed', 'terminal stop mutated the completed task');

  const leakText = await desktopPage.locator('body').innerText();
  const localStorageDump = await desktopPage.evaluate(() => JSON.stringify({ ...localStorage }));
  const serializedPublicEvidence = JSON.stringify({ leakText, localStorageDump });
  for (const secret of [desktopBadge, webBadge, nodeBadge]) check(!serializedPublicEvidence.includes(secret), 'Relay badge leaked into renderer-visible state');

  const gate = {
    schema: 'hummer.executable-gate-result', version: 1,
    gate: 'desktop-web-same-relay-hitl-matrix', status: 'passed',
    mode: 'electron-main-ipc-browser-fastify-memory-node-agent',
    capturedAt: new Date().toISOString(), assertions,
    checks: [
      'Web explicit confirmation enqueued a production TaskEnvelope into the shared Relay.',
      'Desktop main-process Relay bridge displayed and approved the Web task; Node executed exactly once.',
      'Desktop explicit confirmation enqueued through the same Relay; Desktop denial produced Node rejected with zero new execution.',
      'Desktop explicit stop reached Node over Relay SSE and a later execution attempt remained stopped.',
      'Stopping a completed task failed closed with 409 and no state mutation.',
      'Relay badges were absent from renderer-visible text, localStorage, screenshots metadata, and this gate.',
    ],
    taskIds: { approved: approvedTask.taskId, denied: deniedTask.taskId, stopped: stoppedTask.taskId },
    screenshots: [approveShot, webShot, denyShot, stopShot].map(receipt),
    limitations: [
      'Single Windows host with loopback HTTP, MemoryFleetStore and static test badges; no external TLS, production IdP or two-machine proof.',
      'The Node executor is deterministic and synthetic; this gate proves dispatch/approval/stop protocol behavior, not a real expert workflow.',
      'Electron is launched from the built development main process, not a clean-installed NSIS package.',
    ],
  };
  const serializedGate = JSON.stringify(gate, null, 2);
  for (const secret of [desktopBadge, webBadge, nodeBadge]) check(!serializedGate.includes(secret), 'gate leaked a Relay badge');
  gate.assertions = assertions;
  writeFileSync(gatePath, `${JSON.stringify(gate, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(`${JSON.stringify(gate)}\n`);
} catch (error) {
  const failure = {
    schema: 'hummer.executable-gate-result', version: 1,
    gate: 'desktop-web-same-relay-hitl-matrix', status: 'failed',
    capturedAt: new Date().toISOString(), assertions,
    error: safeError(error),
    limitations: ['Failed evidence round is preserved and is not passing evidence.'],
  };
  writeFileSync(failurePath, `${JSON.stringify(failure, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  throw error;
} finally {
  nodeStream?.close();
  await nodeStream?.done.catch(() => undefined);
  await browser?.close().catch(() => undefined);
  if (desktop) await closeDesktop(desktop);
  relayEvents?.close();
  await relayApp?.close().catch(() => undefined);
  relayStore?.close();
  await transformer?.close().catch(() => undefined);
  vite.kill();
}

async function startRelay(identity) {
  const viteTransformer = await createViteTransformer({
    root, configFile: false, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] },
    resolve: { alias: {
      '@hummer/contracts': resolve(root, 'packages/contracts/src/index.ts'),
      '@hummer/capability-runtime': resolve(root, 'packages/capability-runtime/src/index.ts'),
    } },
    server: { middlewareMode: true },
  });
  const relay = await viteTransformer.ssrLoadModule('/apps/relay/src/index.ts');
  const store = new relay.MemoryFleetStore();
  const service = new relay.FleetService(store, relay.createSharedFleetValidators());
  const future = '2099-01-01T00:00:00.000Z';
  const tenantId = identity.tenant.id;
  const authenticator = relay.createStaticBadgeTokenAuthenticator([
    { token: desktopBadge, tokenId: 'badge-desktop-hitl', tenantId, actorRef: `account:${identity.account.id}`, scopes: ['node.read', 'task.read', 'approval.read', 'task.enqueue', 'task.stop', 'approval.decide'], expiresAt: future },
    { token: webBadge, tokenId: 'badge-web-hitl', tenantId, actorRef: 'human:web-owner', scopes: ['node.read', 'task.read', 'approval.read', 'task.enqueue'], expiresAt: future },
    { token: nodeBadge, tokenId: 'badge-node-hitl', tenantId, actorRef: `system:${nodeId}`, nodeId, scopes: ['node.register', 'node.heartbeat', 'task.claim', 'task.event', 'stream.connect', 'approval.request', 'approval.consume'], expiresAt: future },
  ]);
  const { app, events } = relay.createFleetRelayServer(service, { authenticator });
  app.addHook('onRequest', async (request, reply) => {
    if (request.method === 'OPTIONS') {
      cors(reply);
      return reply.status(204).send();
    }
  });
  app.addHook('onSend', async (_request, reply, payload) => { cors(reply); return payload; });
  const baseUrl = await app.listen({ host: '127.0.0.1', port: 0 });
  return { app, events, store, transformer: viteTransformer, baseUrl };
}

function cors(reply) {
  reply.header('access-control-allow-origin', rendererUrl);
  reply.header('access-control-allow-headers', 'accept, authorization, content-type');
  reply.header('access-control-allow-methods', 'GET, POST, OPTIONS');
  reply.header('vary', 'origin');
}

function createAgent({ client, tenantId, contract, executions }) {
  const validate = (name, value) => {
    const result = contract.validateFleetContract(name, value);
    return result.issues ? { ok: false, errors: result.issues.map((issue) => issue.message) } : { ok: true, value: result.value };
  };
  return new HummerNodeAgent({
    nodeId, tenantId, heartbeatIntervalMs: 20_000,
    grant: { token: 'local-grant-not-a-relay-badge', nodeId, tenantId, expiresAt: '2099-01-01T00:00:00.000Z', scopes: ['node.heartbeat', 'task.claim', 'approval.request', 'task.execute'] },
    transport: client,
    contractValidator: {
      validateNodeManifest: (value) => validate('NodeManifest', value),
      validateTaskEnvelope: (value) => validate('TaskEnvelope', value),
      validateApprovalRequest: (value) => validate('ApprovalRequest', value),
      validateApprovalDecision: (value) => validate('ApprovalDecision', value),
      validateRunEvent: (value) => validate('RunEvent', value),
      validateOutcomeReceipt: (value) => ({ ok: true, value }),
    },
    executor: {
      execute: async ({ envelope, approval }) => {
        executions.push({ taskId: envelope.idempotencyKey, approvalId: approval.decisionId });
        return executionOutcome(envelope, approval);
      },
    },
    journal: new MemoryExecutionJournal(), clock: () => new Date(),
  });
}

function executionOutcome(envelope, approval) {
  const occurredAt = now();
  const common = (seq) => ({
    schema: 'hummer.run-event', version: 1, eventId: `event-${envelope.idempotencyKey}-${seq}`,
    tenantId: envelope.tenantId, workOrderId: envelope.originRef, nodeId, seq, occurredAt,
    actorRef: 'employee:hitl-worker', idempotencyKey: `event-key-${envelope.idempotencyKey}-${seq}`,
  });
  const events = [
    { ...common(1), type: 'started', payload: { runId: `run-${envelope.idempotencyKey}` } },
    { ...common(2), type: 'artifact', payload: { artifactId: `artifact-${envelope.idempotencyKey}`, sha256: 'a'.repeat(64), bytes: 12, relPath: envelope.workOrderTask.expectedDeliverable } },
    { ...common(3), type: 'completed', payload: { summary: 'done' } },
  ];
  const outcomeDefinitionId = `outcome-definition-${envelope.idempotencyKey}`;
  const receiptValue = {
    schema: 'hummer.outcome-receipt', version: 1,
    receipt: {
      generatedAt: occurredAt, tenantId: envelope.tenantId,
      outcome: { id: `outcome-${envelope.idempotencyKey}`, tenantId: envelope.tenantId, outcomeDefinitionId, workOrderId: envelope.originRef, sessionId: `session-${envelope.idempotencyKey}`, approvalId: approval.decisionId, verdict: 'accepted', acceptedBy: approval.deciderActorRef, evidenceRef: null, occurredAt },
      definition: { id: outcomeDefinitionId, tenantId: envelope.tenantId, actionPattern: 'workspace.exec', title: 'HITL completion', acceptanceCriteria: 'Approved task completed', unitPriceCny: null, riskLevel: 'high', enabled: true, createdAt: occurredAt, updatedAt: occurredAt },
      costs: [], tools: [], totalCostCny: 0, approval: null, chainIntegrity: { valid: true, checked: 0 },
    }, domainEvents: [], manifest: { algorithm: 'SHA-256', rootHash: 'a'.repeat(64), fieldHashes: {} },
  };
  return { events, receipt: receiptValue };
}

function approvalRequest(task, tenantId, suffix) {
  return {
    schema: 'hummer.approval-request', version: 1,
    requestId: `request-${suffix}-${task.taskId}`, tenantId, workOrderId: task.envelope.originRef,
    nodeId, runId: `run-${task.taskId}`, riskClass: 'write', action: 'task.execute', target: task.taskId,
    redactedPreview: `Execute ${task.envelope.workOrderTask.title}`,
    requestedScope: { capabilities: ['task.execute'], paths: [task.envelope.workOrderTask.expectedDeliverable], maxUses: 1 },
    expiresAt: task.expiresAt, requestedBy: `system:${nodeId}`,
  };
}

function nodeManifest(tenantId) {
  return {
    schema: 'hummer.node-manifest', version: 1, nodeId, tenantIds: [tenantId], platform: 'win32', agentVersion: '0.1.0',
    runtimes: [{ kind: 'codex', available: true, pinnedVersion: '0.153.4' }], capabilities: ['workspace.exec'],
    mcp: { endpoint: 'stdio://hummer-local', tools: ['workspace_exec'] }, load: { running: 0, queued: 0 },
  };
}

async function dispatchFromUi(page, title) {
  const input = page.getByRole('textbox', { name: '你想完成什么' });
  await input.waitFor({ state: 'visible', timeout: 20_000 });
  await input.fill(title);
  await page.getByRole('button', { name: '生成待确认计划' }).click();
  await page.getByText('等待你的确认', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByRole('button', { name: '确认计划' }).click();
  await page.getByLabel('派发回执').waitFor({ state: 'visible', timeout: 20_000 });
}

async function waitForTask(store, tenantId, title) {
  return waitForValue(async () => (await store.listTasks(tenantId, now())).find((task) => task.envelope?.workOrderTask?.title === title), `task ${title}`);
}

async function waitForState(states, claimId, state) {
  await waitForValue(() => states.find((entry) => entry?.claimId === claimId && entry?.state === state), `${claimId} state ${state}`);
}

async function waitForDecision(store, tenantId, requestId, decision) {
  await waitForValue(async () => {
    const record = await store.getApprovalDecision(tenantId, requestId);
    return record?.decision === decision ? record : undefined;
  }, `${requestId} decision ${decision}`);
}

async function waitForApprovalButton(page, request, prefix) {
  try {
    await page.getByRole('button', { name: new RegExp(`${prefix}：.*${escapeRegex(request.target)}`) }).waitFor({ state: 'visible', timeout: 20_000 });
  } catch (error) {
    const body = await page.locator('body').innerText().catch(() => '[body unavailable]');
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nVisible UI:\n${body.slice(0, 6_000)}`);
  }
}

async function waitForValue(read, label, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function launchDesktop(extraEnv = {}) {
  return electron.launch({
    args: [resolve(root, 'apps/desktop/dist/main.js'), '--disable-gpu', `--user-data-dir=${profileDir}`],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', HUMMER_RENDERER_URL: rendererUrl, HUMMER_CODEX_CWD: evidenceDir, HUMMER_CODEX_PATH: codexProbe, HUMMER_DATA_DIR: dataDir, ...extraEnv },
  });
}

async function createDesktopCompany(page) {
  const gate = page.getByRole('heading', { name: '进入 HUMMER' });
  await gate.waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByLabel('公司名称').fill('HUMMER HITL E2E');
  await page.getByLabel('你的姓名').fill('桌面验收员');
  await page.getByLabel('邮箱或手机').fill('desktop-hitl@example.test');
  await page.getByRole('button', { name: '创建并进入' }).click();
  await gate.waitFor({ state: 'hidden', timeout: 15_000 });
  await waitForWorkbench(page);
}

async function waitForWorkbench(page) {
  try {
    await page.getByRole('heading', { name: '工作台' }).waitFor({ state: 'visible', timeout: 30_000 });
  } catch (error) {
    const body = await page.locator('body').innerText().catch(() => '[body unavailable]');
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nVisible UI:\n${body.slice(0, 4_000)}`);
  }
}

async function readDesktopIdentity(page) {
  return page.evaluate(async () => {
    const token = localStorage.getItem('hummer.auth.session');
    if (!token || !window.hummerIdentity) throw new Error('Desktop identity bridge or session is missing');
    return window.hummerIdentity.resumeSession(token);
  });
}

function browserIdentity(tenantId) {
  return {
    account: { id: 'account-web-hitl', email: 'web-hitl@example.test', phone: null, displayName: '网页派活员' },
    tenant: { id: tenantId, name: 'HUMMER HITL E2E', slug: 'hummer-hitl-e2e' },
    membership: { id: 'membership-web-hitl', tenantId, accountId: 'account-web-hitl', humanUserId: 'human-web-hitl', role: 'owner' },
    session: { id: 'auth-web-hitl', token: 'browser-session-hitl', accountId: 'account-web-hitl', currentTenantId: tenantId, expiresAt: '2099-01-01T00:00:00.000Z' },
  };
}

async function closeDesktop(app) {
  const child = app.process();
  await Promise.race([app.close(), delay(5_000)]).catch(() => undefined);
  if (!child.killed) child.kill();
}

async function waitForServer(url) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (vite.exitCode !== null) throw new Error(`Vite exited ${vite.exitCode}:\n${viteOutput.join('')}`);
    try { if ((await fetch(url)).ok) return; } catch { /* starting */ }
    await delay(200);
  }
  throw new Error(`Vite did not become ready:\n${viteOutput.join('')}`);
}

function receipt(path) {
  const bytes = readFileSync(path);
  return { path: relative(root, path).replaceAll('\\', '/'), sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
}

function check(condition, message) {
  assertions += 1;
  if (!condition) throw new Error(message);
}

function now() { return new Date().toISOString(); }
function escapeRegex(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function safeError(error) {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of [desktopBadge, webBadge, nodeBadge]) message = message.replaceAll(secret, '[REDACTED]');
  return { name: error instanceof Error ? error.name : 'Error', message };
}

function parseRound(args, date) {
  const roundArgs = args.filter((arg) => arg.startsWith('--round='));
  if (roundArgs.length > 1 || args.some((arg) => !arg.startsWith('--round='))) throw new Error('usage: e2e-desktop-web-relay-hitl.mjs [--round=round-id]');
  const value = roundArgs[0]?.slice('--round='.length) || `round-p1-desktop-web-hitl-${date.toISOString().replace(/[-:.]/g, '')}-${process.pid}`;
  if (!/^round-[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(value)) throw new Error('invalid evidence round');
  return value;
}

function isWithin(parent, child) {
  const value = relative(parent, child);
  return value.length > 0 && value !== '..' && !value.startsWith(`..${sep}`) && !isAbsolute(value);
}
