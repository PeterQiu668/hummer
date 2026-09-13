import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron as electron } from 'playwright';
import ExcelJS from 'exceljs';
import { configureInternalValidationDisplay } from './support/configure-e2e-engine.mjs';

const root = process.cwd();
const spikeRoot = resolve(root, 'spikes/m5e-doc-extract');
const workspace = resolve(spikeRoot, 'workspace');
const dataDirectory = resolve(spikeRoot, 'facts');
const profileDirectory = resolve(spikeRoot, 'profile');
const outsideDirectory = resolve(spikeRoot, 'outside');
const wireLogPath = resolve(spikeRoot, 'doc-extract-wire.jsonl');
const evidencePath = resolve(spikeRoot, 'doc-extract-evidence.json');
const screenshotPath = resolve(spikeRoot, 'doc-extract.png');
const baseUrl = 'http://127.0.0.1:4193';
const codexPath = resolve(process.env.LOCALAPPDATA ?? '', 'hermes/node/codex.cmd');

if (!existsSync(codexPath)) throw new Error(`Real Codex CLI is unavailable at ${codexPath}`);
for (const target of [workspace, dataDirectory, profileDirectory, outsideDirectory]) {
  if (!target.startsWith(spikeRoot)) throw new Error('Refusing to clean outside the M5-E doc.extract spike directory');
  if (existsSync(target)) rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
}
for (const target of [wireLogPath, evidencePath]) if (existsSync(target)) rmSync(target);

const workbook = new ExcelJS.Workbook();
const sheet = workbook.addWorksheet('九月订单');
sheet.addRow(['客户', '金额', '交付日']);
sheet.addRow(['华东系统集成', 128000, '2026-09-30']);
await workbook.xlsx.writeFile(resolve(workspace, '真实订单.xlsx'));

const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4193', '--strictPort'], {
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
  await page.evaluate(async ({ token }) => {
    if (!window.hummerToolRegistry) throw new Error('Tool registry bridge is unavailable');
    await window.hummerToolRegistry.verifyLocalMcp(token);
  }, { token });

  await page.getByRole('button', { name: '工作台', exact: true }).click();
  await page.getByRole('heading', { name: '工作台' }).waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByLabel('选择模型').selectOption({ label: '旗舰' });
  const composer = page.getByRole('textbox', { name: '任务描述' });
  await composer.fill('Use the HUMMER doc.extract capability, specifically hummer_local doc_extract, to read 真实订单.xlsx. Do not use shell commands. Report the sheet name, customer, amount, and delivery date.');
  await composer.press('Enter');
  await page.getByText('模型生成计划', { exact: true }).waitFor({ state: 'visible', timeout: 120_000 });
  await page.getByRole('button', { name: '开始干' }).click();
  await page.locator('[data-runtime-event-kind="tool"][data-runtime-tool="doc.extract"]').waitFor({ state: 'visible', timeout: 120_000 });
  await page.getByText('任务运行完成', { exact: true }).waitFor({ state: 'visible', timeout: 120_000 });

  const evidence = await page.evaluate(async ({ token }) => {
    if (!window.hummerPersistence || !window.hummerOutcomes || !window.hummerToolRegistry) throw new Error('Required desktop bridges are unavailable');
    const sessions = await window.hummerPersistence.listSessions(token);
    const session = sessions.find((candidate) => candidate.events.some((event) => event.type === 'tool' && event.tool === 'doc.extract'));
    if (!session) throw new Error('No persisted doc.extract runtime event was found');
    const toolEvent = session.events.find((event) => event.type === 'tool' && event.tool === 'doc.extract');
    const definition = await window.hummerOutcomes.define({ token, input: {
      actionPattern: 'doc.extract', title: '真实订单文档提取验收', acceptanceCriteria: '结果包含 sheet、单元格坐标和内容寻址证据', riskLevel: 'low', idempotencyKey: 'm5e-doc-definition',
    } });
    const outcome = await window.hummerOutcomes.record({ token, input: {
      outcomeDefinitionId: definition.id, sessionId: session.handle.sessionId, verdict: 'accepted',
      evidenceRef: toolEvent?.evidenceRefs.find((ref) => ref.startsWith('evidence://sha256/')),
      occurredAt: new Date().toISOString(), idempotencyKey: 'm5e-doc-outcome',
    } });
    const receipt = await window.hummerOutcomes.receipt({ token, input: { outcomeEventId: outcome.id } });
    return {
      session, toolEvent, receipt,
      definitions: await window.hummerToolRegistry.list(token),
      integrity: await window.hummerPersistence.verifyIntegrity(token),
    };
  }, { token });

  if (!evidence.toolEvent.evidenceRefs.some((ref) => ref.startsWith('evidence://sha256/'))) throw new Error('doc.extract event lacks content-addressed evidence');
  if (!evidence.receipt.tools.some((tool) => tool.capabilityId === 'doc.extract' && tool.evidenceRefs.some((ref) => ref.startsWith('evidence://sha256/')))) {
    throw new Error('Outcome receipt lacks doc.extract invocation details');
  }
  if (evidence.definitions.map((tool) => tool.capabilityId).join(',') !== 'doc.extract,external.send.draft,fs.read,workspace.exec') {
    throw new Error(`Capability catalog is not fail-closed to four tools: ${JSON.stringify(evidence.definitions)}`);
  }
  if (!evidence.integrity.valid) throw new Error(`Domain event chain is invalid: ${JSON.stringify(evidence.integrity)}`);

  const failures = await verifyFailureModes();
  const wire = readWireMessages(wireLogPath);
  const mcpReady = wire.some(({ raw }) => raw?.method === 'mcpServer/startupStatus/updated' && raw.params?.name === 'hummer_local' && raw.params?.status === 'ready');
  const docExtractCall = wire.some(({ raw }) => raw?.method === 'item/started' && raw.params?.item?.type === 'mcpToolCall'
    && raw.params.item.server === 'hummer_local' && raw.params.item.tool === 'doc_extract');
  const elicitationAccepted = wire.some(({ channel, raw }) => channel === 'outbound' && raw?.result?.action === 'accept');
  if (!mcpReady || !docExtractCall || !elicitationAccepted) throw new Error(`Wire log lacks doc.extract MCP proof: ${JSON.stringify({ mcpReady, docExtractCall, elicitationAccepted })}`);

  const output = {
    generatedAt: new Date().toISOString(),
    wireLogPath,
    wireProof: { mcpReady, docExtractCall, elicitationAccepted },
    failureModes: failures,
    ...evidence,
  };
  writeFileSync(evidencePath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(JSON.stringify({ evidencePath, screenshotPath, sessionId: evidence.session.handle.sessionId, tool: evidence.toolEvent, failures, integrity: evidence.integrity }, null, 2));
} finally {
  if (app) {
    const child = app.process();
    await Promise.race([app.close(), delay(5_000)]);
    if (!child.killed) child.kill();
  }
  vite.kill();
}

async function verifyFailureModes() {
  const { handleMcpRequest } = await import('../apps/desktop/dist/hummer-mcp-server.js');
  writeFileSync(resolve(workspace, 'encrypted.xlsx'), Buffer.from('d0cf11e0a1b11ae1', 'hex'));
  writeFileSync(resolve(workspace, 'corrupt.xlsx'), 'not an xlsx');
  writeFileSync(resolve(workspace, 'oversized.xlsx'), Buffer.alloc(25 * 1024 * 1024 + 1));
  writeFileSync(resolve(outsideDirectory, 'outside.xlsx'), 'outside');
  symlinkSync(outsideDirectory, resolve(workspace, 'linked'), 'junction');
  const cases = [
    ['encrypted', 'encrypted.xlsx', /encrypted/i],
    ['corrupt', 'corrupt.xlsx', /corrupt/i],
    ['oversized', 'oversized.xlsx', /larger than/i],
    ['outside', '../outside/outside.xlsx', /outside the workspace/i],
    ['symbolicLink', 'linked/outside.xlsx', /symbolic link/i],
  ];
  const results = {};
  for (const [name, path, expected] of cases) {
    const response = await handleMcpRequest({ jsonrpc: '2.0', id: name, method: 'tools/call', params: { name: 'doc_extract', arguments: { path } } }, workspace);
    const message = response?.error?.message ?? '';
    if (!expected.test(message)) throw new Error(`${name} did not fail explicitly: ${JSON.stringify(response)}`);
    results[name] = message;
  }
  return results;
}

async function ensureIdentity(page) {
  await page.waitForFunction(() => [...document.querySelectorAll('h1, h2')].some((node) => ['进入 HUMMER', '工作台'].includes(node.textContent?.trim() ?? '')), undefined, { timeout: 30_000 });
  if (await page.getByRole('heading', { name: '进入 HUMMER' }).isVisible()) {
    await page.getByLabel('公司名称').fill('M5-E 文档验收企业');
    await page.getByLabel('你的姓名').fill('订单验收人');
    await page.getByLabel('邮箱或手机').fill('m5e-doc@example.test');
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
