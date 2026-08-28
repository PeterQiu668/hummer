import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron as electron } from 'playwright';

const root = process.cwd();
const protocol = process.argv.find((argument) => argument.startsWith('--protocol='))?.split('=')[1] ?? 'exec-jsonl';
const approvalFlow = process.argv.includes('--approval');
if (!['exec-jsonl', 'app-server-jsonrpc'].includes(protocol)) throw new Error(`Unsupported test protocol ${protocol}`);
if (approvalFlow && protocol !== 'app-server-jsonrpc') throw new Error('Approval smoke requires app-server-jsonrpc');
const workspace = resolve(root, 'spikes/codex-runtime');
const output = resolve(workspace, approvalFlow ? 'summary-approved.md' : 'summary.md');
const baseUrl = 'http://127.0.0.1:4176';
const codexPath = resolve(process.env.LOCALAPPDATA, 'hermes/node/codex.cmd');
const wireLogPath = resolve(workspace, approvalFlow ? 'app-server-approval-wire.jsonl' : `${protocol}-wire.jsonl`);
const dataDirectory = resolve(workspace, `.facts-${approvalFlow ? 'approval' : protocol}`);

if (!existsSync(codexPath)) throw new Error(`npm Codex shim not found at ${codexPath}`);
if (existsSync(output)) rmSync(output);
if (existsSync(wireLogPath)) rmSync(wireLogPath);
if (existsSync(dataDirectory)) rmSync(dataDirectory, { recursive: true, force: true });

const vite = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4176', '--strictPort'],
  {
    cwd: root,
    stdio: 'pipe',
    windowsHide: true,
    env: { ...process.env, VITE_HUMMER_RUNTIME_ADAPTER: 'codex', VITE_HUMMER_CODEX_PROTOCOL: protocol },
  },
);

let app;
try {
  await waitForServer(baseUrl);
  console.log(`stage=vite-ready protocol=${protocol}`);
  app = await electron.launch({
    args: [resolve(root, 'apps/desktop/dist/main.js'), '--disable-gpu'],
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      HUMMER_RENDERER_URL: baseUrl,
      HUMMER_CODEX_CWD: workspace,
      HUMMER_CODEX_PATH: codexPath,
      HUMMER_CODEX_WIRE_LOG_PATH: wireLogPath,
      HUMMER_DATA_DIR: dataDirectory,
      ...(approvalFlow ? { HUMMER_CODEX_SANDBOX: 'read-only' } : {}),
    },
  });
  app.process().stderr?.on('data', (chunk) => process.stderr.write(`[electron] ${chunk}`));
  console.log('stage=electron-launched');
  const page = await app.firstWindow();
  page.on('console', (message) => { if (message.type() === 'error') console.error(`[renderer] ${message.text()}`); });
  await page.getByRole('heading', { name: '工作台' }).waitFor({ state: 'visible', timeout: 30_000 });
  console.log('stage=workbench-visible');
  const node = page.getByLabel('执行节点状态');
  await node.getByText('Codex 运行时', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
  if (!(await node.textContent())?.includes(workspace)) throw new Error('Workbench did not show the real Codex working directory');
  console.log('stage=codex-node-visible');

  const composer = page.getByRole('textbox', { name: '任务描述' });
  await composer.fill(approvalFlow
    ? 'Read input.txt. Do not use apply_patch. Run a PowerShell Set-Content command to create summary-approved.md with one concise sentence summarizing the file. Do not modify any other file.'
    : 'Read input.txt with a local command. Then use apply_patch to create summary.md containing one concise sentence that summarizes the file. Do not modify any other file.');
  await composer.press('Enter');
  await page.getByText('我理解你要做的是：', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
  await page.getByRole('button', { name: '开始干' }).click();
  console.log('stage=session-started');

  try {
    if (approvalFlow) {
      const approve = page.getByRole('button', { name: '确认更新' });
      await approve.waitFor({ state: 'visible', timeout: 120_000 });
      if (existsSync(output)) throw new Error('Protected output existed before HUMMER approval');
      console.log('stage=approval-visible');
      await approve.click();
      console.log('stage=approval-accepted');
    }
    await page.locator('[data-runtime-event-kind="tool"][data-runtime-tool="shell.command"]').last().waitFor({ state: 'visible', timeout: 120_000 });
    console.log('stage=command-event-visible');
    if (!approvalFlow) {
      await page.locator('[data-runtime-tool="workspace.patch"]').waitFor({ state: 'visible', timeout: 120_000 });
      console.log('stage=file-change-visible');
    }
    await page.getByText('Codex 运行完成', { exact: true }).waitFor({ state: 'visible', timeout: 120_000 });
  } catch (error) {
    await page.screenshot({ path: resolve(root, 'dist/hummer-m1-codex-failure.png'), fullPage: true });
    console.error(`page-state=${(await page.locator('body').innerText()).slice(0, 6000)}`);
    if (existsSync(wireLogPath)) console.error(`wire-log=${readFileSync(wireLogPath, 'utf8').slice(-20_000)}`);
    throw error;
  }
  if (!existsSync(output)) throw new Error('Codex trajectory reported a file change but summary.md does not exist');

  const persistedSessions = await page.evaluate(() => window.hummerPersistence?.listSessions() ?? []);
  const persistedEvents = persistedSessions.flatMap((session) => session.events);
  const persistedFileChange = persistedEvents.find((event) => event.type === 'tool' && event.tool === 'workspace.patch');
  if (!approvalFlow && !persistedFileChange?.evidenceRefs.some((ref) => ref.startsWith('evidence://sha256/'))) {
    throw new Error('Persisted file change did not contain content-addressed evidence');
  }

  const trajectory = await page.locator('[data-runtime-event-kind]').evaluateAll((nodes) => nodes.map((node) => ({
    sequence: Number(node.getAttribute('data-runtime-sequence')),
    kind: node.getAttribute('data-runtime-event-kind'),
    tool: node.getAttribute('data-runtime-tool') || undefined,
    text: node.textContent?.replace(/\s+/g, ' ').trim(),
  })));
  const artifactStem = approvalFlow ? 'app-server-approval-trajectory' : protocol === 'app-server-jsonrpc' ? 'app-server-trajectory' : 'desktop-trajectory';
  if (approvalFlow) assertApprovalSequence(trajectory);
  writeFileSync(resolve(workspace, `${artifactStem}.json`), `${JSON.stringify(trajectory, null, 2)}\n`, 'utf8');
  await page.screenshot({ path: resolve(root, `dist/hummer-m1-codex-${protocol}.png`), fullPage: true });
  console.log(JSON.stringify({ protocol, approvalFlow, workspace, output, persistedFileChange, trajectory }, null, 2));
} finally {
  if (app) {
    const electronProcess = app.process();
    await Promise.race([app.close(), delay(5_000)]);
    if (!electronProcess.killed) electronProcess.kill();
  }
  vite.kill();
}

async function waitForServer(url) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await delay(250);
  }
  throw new Error(`Vite did not become reachable at ${url}`);
}

function assertApprovalSequence(trajectory) {
  const required = trajectory.findIndex((event) => event.kind === 'approval');
  const resolved = trajectory.findIndex((event) => event.kind === 'human_to_ai' && event.text?.includes('真人批准'));
  const continuedTool = trajectory.findIndex((event, index) => index > resolved && event.kind === 'tool');
  const completed = trajectory.findIndex((event, index) => index > continuedTool && event.kind === 'result');
  if (!(required >= 0 && resolved > required && continuedTool > resolved && completed > continuedTool)) {
    throw new Error('Approval trajectory did not prove required -> human approval -> continued tool -> completed');
  }
}
