import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron as electron } from 'playwright';
import { configureInternalValidationDisplay } from './support/configure-e2e-engine.mjs';

const root = process.cwd();
const spikeRoot = resolve(root, 'spikes/m5g-workspace-exec');
const dataDirectory = resolve(spikeRoot, 'facts');
const profileDirectory = resolve(spikeRoot, 'profile');
const executionRoot = resolve(spikeRoot, 'order-workspaces');
const wireLogPath = resolve(spikeRoot, 'workspace-exec-wire.jsonl');
const evidencePath = resolve(spikeRoot, 'workspace-exec-evidence.json');
const screenshotPath = resolve(spikeRoot, 'workspace-exec-ui.png');
const codexPath = resolve(process.env.LOCALAPPDATA ?? '', 'hermes/node/codex.cmd');
const baseUrl = 'http://127.0.0.1:4195';
const task = [
  'Use only the HUMMER workspace.exec capability (hummer_local workspace_exec).',
  'Stage a Python file named build.py and execute it with python /workspace/build.py.',
  'The script must create deliverable.txt containing exactly: HUMMER_M5G_REAL_OUTPUT',
  'Do not use shell commands, apply_patch, direct file writes, web search, or any network access.',
].join(' ');

if (!existsSync(codexPath)) throw new Error(`Real Codex CLI is unavailable at ${codexPath}`);
for (const target of [dataDirectory, profileDirectory, executionRoot]) {
  if (!target.startsWith(spikeRoot)) throw new Error('Refusing to clean outside the M5-G workspace.exec spike');
  if (existsSync(target)) rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
}
for (const target of [wireLogPath, evidencePath, screenshotPath]) if (existsSync(target)) rmSync(target, { force: true });

const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4195', '--strictPort'], {
  cwd: root, stdio: 'pipe', windowsHide: true,
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
      HUMMER_CODEX_CWD: root,
      HUMMER_CODEX_PATH: codexPath,
      HUMMER_CODEX_WIRE_LOG_PATH: wireLogPath,
      HUMMER_DATA_DIR: dataDirectory,
      HUMMER_EXEC_WORKSPACE_ROOT: executionRoot,
      HUMMER_SANDBOX_IMAGE: 'hummer-office-sandbox:m5g',
      HUMMER_ENGINE_PROFILE: 'openai-codex-validation',
    },
  });
  const page = await app.firstWindow({ timeout: 120_000 });
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
  await composer.fill(task);
  await composer.press('Enter');
  const planBadge = page.getByText('模型生成计划', { exact: true });
  await planBadge.waitFor({ state: 'visible', timeout: 150_000 });
  const planText = (await planBadge.locator('xpath=ancestor::form').innerText()).replace(/\s+/g, ' ');
  if (!planText.includes('workspace.exec')) throw new Error(`Real plan omitted workspace.exec: ${planText}`);
  await page.getByRole('button', { name: '开始干' }).click();
  await page.locator('[data-runtime-event-kind="tool"][data-runtime-tool="workspace.exec"]').waitFor({ state: 'visible', timeout: 180_000 });
  await page.getByText('任务运行完成', { exact: true }).waitFor({ state: 'visible', timeout: 180_000 });

  const product = await page.evaluate(async ({ token, task }) => {
    if (!window.hummerPersistence || !window.hummerOutcomes || !window.hummerToolRegistry || !window.hummerEnvironmentDoctor) throw new Error('Required desktop bridge is unavailable');
    const sessions = await window.hummerPersistence.listSessions(token);
    const session = sessions.find((candidate) => candidate.plan?.prompt === task);
    if (!session) throw new Error('workspace.exec session was not persisted');
    const tool = session.events.findLast((event) => event.type === 'tool' && event.tool === 'workspace.exec' && event.status === 'completed');
    if (!tool) throw new Error('workspace.exec runtime event was not persisted');
    const definition = await window.hummerOutcomes.define({ token, input: {
      actionPattern: 'workspace.exec', title: '隔离工作区产物验收',
      acceptanceCriteria: '产物来自禁网容器且包含内容哈希', riskLevel: 'low', idempotencyKey: 'm5g-workspace-definition',
    } });
    const accepted = await window.hummerOutcomes.record({ token, input: {
      outcomeDefinitionId: definition.id, workOrderId: session.plan.workOrderId, sessionId: session.handle.sessionId,
      verdict: 'accepted', evidenceRef: tool.evidenceRefs.find((ref) => ref.startsWith('evidence://sha256/')),
      occurredAt: new Date().toISOString(), idempotencyKey: 'm5g-workspace-outcome',
    } });
    const receipt = await window.hummerOutcomes.receipt({ token, input: { outcomeEventId: accepted.id } });
    return {
      session, tool, receipt,
      definitions: await window.hummerToolRegistry.list(token),
      integrity: await window.hummerPersistence.verifyIntegrity(token),
      environment: await window.hummerEnvironmentDoctor.check(false),
    };
  }, { token, task });

  const sessionId = product.session.handle.sessionId;
  const workOrderId = product.session.plan.workOrderId;
  const deliverablePath = resolve(executionRoot, workOrderId, 'deliverable.txt');
  if (!existsSync(deliverablePath) || readFileSync(deliverablePath, 'utf8') !== 'HUMMER_M5G_REAL_OUTPUT') throw new Error('Real workspace artifact is missing or invalid');
  if (!product.environment.workspaceExec?.available || product.environment.workspaceExec.passed !== 5) throw new Error('Startup isolation self-check was not 5/5');
  if (product.session.events.some((event) => event.type === 'tool' && event.tool === 'shell.command')) throw new Error('Codex received or used the forbidden host shell');
  if (!product.tool.evidenceRefs.some((ref) => ref.startsWith('evidence://sha256/'))) throw new Error('workspace.exec lacks content-addressed evidence');
  if (!product.receipt.tools.some((tool) => tool.capabilityId === 'workspace.exec')) throw new Error('Receipt omitted workspace.exec invocation');
  if (!product.integrity.valid) throw new Error(`Hash chain is invalid: ${JSON.stringify(product.integrity)}`);
  const capabilities = product.definitions.map((tool) => tool.capabilityId).sort();
  if (capabilities.join(',') !== 'doc.extract,external.send.draft,fs.read,workspace.exec') throw new Error(`Unexpected capability catalog: ${capabilities.join(',')}`);

  const wire = readWireMessages(wireLogPath);
  const workspaceExecCall = wire.some(({ raw }) => raw?.method === 'item/started' && raw.params?.item?.type === 'mcpToolCall'
    && raw.params.item.server === 'hummer_local' && raw.params.item.tool === 'workspace_exec');
  const shellCall = wire.some(({ raw }) => raw?.method === 'item/started' && raw.params?.item?.type === 'commandExecution');
  if (!workspaceExecCall || shellCall) throw new Error(`Wire proof failed: ${JSON.stringify({ workspaceExecCall, shellCall })}`);
  const evidence = {
    generatedAt: new Date().toISOString(), evidenceClass: 'real-codex-runtime-and-local-product-chain',
    task, planText, sessionId, workOrderId, deliverablePath, tool: product.tool,
    startupIsolation: product.environment.workspaceExec, wireProof: { workspaceExecCall, shellCall },
    receiptTools: product.receipt.tools, chainIntegrity: product.integrity,
  };
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(JSON.stringify({ evidencePath, screenshotPath, sessionId, workOrderId, deliverablePath, startupIsolation: product.environment.workspaceExec, chainIntegrity: product.integrity }, null, 2));
} finally {
  if (app) {
    const child = app.process();
    await Promise.race([app.close(), delay(5_000)]);
    if (!child.killed) child.kill();
  }
  vite.kill();
}

async function ensureIdentity(page) {
  const gate = page.getByRole('heading', { name: '进入 HUMMER' });
  const workbench = page.getByRole('heading', { name: '工作台' });
  await Promise.race([gate.waitFor({ state: 'visible', timeout: 120_000 }), workbench.waitFor({ state: 'visible', timeout: 120_000 })]);
  if (await gate.isVisible()) {
    await page.getByLabel('公司名称').fill('HUMMER M5-G 执行沙箱验收');
    await page.getByLabel('你的姓名').fill('沙箱验收人');
    await page.getByLabel('邮箱或手机').fill('m5g-workspace@example.test');
    await page.getByRole('button', { name: '创建并进入' }).click();
    await gate.waitFor({ state: 'hidden', timeout: 15_000 });
  }
  const token = await page.evaluate(() => localStorage.getItem('hummer.auth.session'));
  if (!token) throw new Error('Authentication token was not created');
  return token;
}

function readWireMessages(path) {
  return readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => {
    const envelope = JSON.parse(line);
    return { ...envelope, raw: typeof envelope.raw === 'string' ? JSON.parse(envelope.raw) : envelope.raw };
  });
}

async function waitForServer(url) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return; } catch { /* Vite is starting. */ }
    await delay(250);
  }
  throw new Error(`Vite did not become reachable at ${url}`);
}
