import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron as electron } from 'playwright';
import { configureInternalValidationDisplay } from './support/configure-e2e-engine.mjs';

const root = process.cwd();
const spikeRoot = resolve(root, 'spikes/m5d-tool-registry');
const workspace = resolve(spikeRoot, 'workspace');
const dataDirectory = resolve(spikeRoot, 'facts');
const profileDirectory = resolve(spikeRoot, 'profile');
const wireLogPath = resolve(spikeRoot, 'tool-registry-wire.jsonl');
const evidencePath = resolve(spikeRoot, 'tool-registry-evidence.json');
const screenshotPath = resolve(root, 'dist/hummer-m5d-tool-registry.png');
const baseUrl = 'http://127.0.0.1:4192';
const codexPath = resolve(process.env.LOCALAPPDATA ?? '', 'hermes/node/codex.cmd');

if (!existsSync(codexPath)) throw new Error(`Real Codex CLI is unavailable at ${codexPath}`);
mkdirSync(workspace, { recursive: true });
writeFileSync(resolve(workspace, 'input.txt'), 'HUMMER tools must be real, tenant-scoped, approval-aware, and auditable.\n', 'utf8');
for (const target of [dataDirectory, profileDirectory]) {
  if (!target.startsWith(spikeRoot)) throw new Error('Refusing to clean outside the M5-D tool spike directory');
  if (existsSync(target)) rmSync(target, { recursive: true, force: true });
}
for (const target of [wireLogPath, evidencePath]) if (existsSync(target)) rmSync(target);

const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4192', '--strictPort'], {
  cwd: root,
  stdio: 'pipe',
  windowsHide: true,
  env: { ...process.env, VITE_HUMMER_RUNTIME_ADAPTER: 'codex', VITE_HUMMER_CODEX_PROTOCOL: 'app-server-jsonrpc' },
});

let app;
try {
  await waitForServer(baseUrl);
  app = await electron.launch({
    args: [resolve(root, 'apps/desktop/dist/main.js'), '--disable-gpu', `--user-data-dir=${profileDirectory}`],
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
  const token = await ensureIdentity(page);
  await configureInternalValidationDisplay(page);
  const verifiedTool = await page.evaluate(async ({ token }) => {
    if (!window.hummerToolRegistry) throw new Error('Tool registry bridge is unavailable');
    return window.hummerToolRegistry.verifyLocalMcp(token);
  }, { token });
  if (verifiedTool.capabilityId !== 'fs.read' || verifiedTool.status !== 'verified') {
    throw new Error(`MCP handshake did not verify fs.read: ${JSON.stringify(verifiedTool)}`);
  }

  await page.getByRole('button', { name: '工作台', exact: true }).click();
  await page.getByRole('heading', { name: '工作台' }).waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByLabel('选择模型').selectOption({ label: '旗舰' });
  const composer = page.getByRole('textbox', { name: '任务描述' });
  await composer.fill('Use the HUMMER fs.read capability, specifically the hummer_local fs_read MCP tool, to read input.txt. Do not use shell commands. Return one sentence summarizing the file.');
  await composer.press('Enter');
  await page.getByText('我理解你要做的是：', { exact: true }).waitFor({ state: 'visible', timeout: 120_000 });
  await page.getByText('模型生成计划', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
  await page.getByRole('button', { name: '开始干' }).click();
  await page.locator('[data-runtime-event-kind="tool"][data-runtime-tool="fs.read"]').waitFor({ state: 'visible', timeout: 120_000 });
  await page.getByText('任务运行完成', { exact: true }).waitFor({ state: 'visible', timeout: 120_000 });

  const evidence = await page.evaluate(async ({ token }) => {
    if (!window.hummerPersistence || !window.hummerOutcomes || !window.hummerToolRegistry) throw new Error('Required desktop bridges are unavailable');
    const sessions = await window.hummerPersistence.listSessions(token);
    const session = sessions.find((candidate) => candidate.events.some((event) => event.type === 'tool' && event.tool === 'fs.read'));
    if (!session) throw new Error('No persisted fs.read runtime event was found');
    const toolEvent = session.events.find((event) => event.type === 'tool' && event.tool === 'fs.read');
    const definition = await window.hummerOutcomes.define({ token, input: {
      actionPattern: 'fs.read', title: '工作区事实读取验收', acceptanceCriteria: '读取结果包含内容寻址证据', riskLevel: 'low', idempotencyKey: 'm5d-tool-result-definition',
    } });
    const outcome = await window.hummerOutcomes.record({ token, input: {
      outcomeDefinitionId: definition.id, sessionId: session.handle.sessionId, verdict: 'accepted',
      evidenceRef: toolEvent?.evidenceRefs.find((ref) => ref.startsWith('evidence://sha256/')),
      occurredAt: new Date().toISOString(), idempotencyKey: 'm5d-tool-result',
    } });
    const receipt = await window.hummerOutcomes.receipt({ token, input: { outcomeEventId: outcome.id } });
    const definitions = await window.hummerToolRegistry.list(token);
    const integrity = await window.hummerPersistence.verifyIntegrity(token);
    return { session, toolEvent, definition, outcome, receipt, definitions, integrity };
  }, { token });

  if (!evidence.toolEvent.evidenceRefs.some((ref) => ref.startsWith('evidence://sha256/'))) throw new Error('fs.read event lacks content-addressed evidence');
  if (!evidence.receipt.tools.some((tool) => tool.capabilityId === 'fs.read' && tool.evidenceRefs.some((ref) => ref.startsWith('evidence://sha256/')))) {
    throw new Error('Outcome receipt lacks fs.read invocation details');
  }
  if (!evidence.integrity.valid) throw new Error(`Domain event chain is invalid: ${JSON.stringify(evidence.integrity)}`);
  const wire = readWireMessages(wireLogPath);
  const mcpReady = wire.some(({ raw }) => raw?.method === 'mcpServer/startupStatus/updated'
    && raw.params?.name === 'hummer_local' && raw.params?.status === 'ready');
  const fsReadCall = wire.some(({ raw }) => raw?.method === 'item/started'
    && raw.params?.item?.type === 'mcpToolCall' && raw.params.item.server === 'hummer_local'
    && raw.params.item.tool === 'fs_read');
  const elicitationAccepted = wire.some(({ channel, raw }) => channel === 'outbound'
    && raw?.result?.action === 'accept' && raw.result.content && Object.keys(raw.result.content).length === 0);
  if (!mcpReady || !fsReadCall || !elicitationAccepted) {
    throw new Error(`Wire log lacks MCP proof: ${JSON.stringify({ mcpReady, fsReadCall, elicitationAccepted })}`);
  }
  const output = { generatedAt: new Date().toISOString(), verifiedTool, wireLogPath, wireProof: { mcpReady, fsReadCall, elicitationAccepted }, ...evidence };
  writeFileSync(evidencePath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(JSON.stringify({ evidencePath, screenshotPath, sessionId: evidence.session.handle.sessionId, tool: evidence.toolEvent, receiptTools: evidence.receipt.tools, integrity: evidence.integrity }, null, 2));
} finally {
  if (app) {
    const child = app.process();
    await Promise.race([app.close(), delay(5_000)]);
    if (!child.killed) child.kill();
  }
  vite.kill();
}

async function ensureIdentity(page) {
  await page.waitForFunction(() => [...document.querySelectorAll('h1, h2')].some((node) => ['进入 HUMMER', '工作台'].includes(node.textContent?.trim() ?? '')), undefined, { timeout: 30_000 });
  if (await page.getByRole('heading', { name: '进入 HUMMER' }).isVisible()) {
    await page.getByLabel('公司名称').fill('M5-D 工具验收企业');
    await page.getByLabel('你的姓名').fill('工具验收人');
    await page.getByLabel('邮箱或手机').fill('m5d-tools@example.test');
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

function readWireMessages(path) {
  return readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => {
    const envelope = JSON.parse(line);
    return { ...envelope, raw: typeof envelope.raw === 'string' ? JSON.parse(envelope.raw) : envelope.raw };
  });
}
