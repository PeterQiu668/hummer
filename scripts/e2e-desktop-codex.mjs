import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron as electron } from 'playwright';
import { configureInternalValidationDisplay } from './support/configure-e2e-engine.mjs';

const root = process.cwd();
const protocol = process.argv.find((argument) => argument.startsWith('--protocol='))?.split('=')[1] ?? 'app-server-jsonrpc';
const approvalFlow = process.argv.includes('--approval');
const forkFlow = process.argv.includes('--fork');
if (!['exec-jsonl', 'app-server-jsonrpc'].includes(protocol)) throw new Error(`Unsupported test protocol ${protocol}`);
const engineProfile = process.argv.find((argument) => argument.startsWith('--engine-profile='))?.split('=')[1] ?? 'openai-codex-validation';
if (approvalFlow && protocol !== 'app-server-jsonrpc') throw new Error('Approval smoke requires app-server-jsonrpc');
const workspace = resolve(root, engineProfile === 'openai-codex-validation' ? 'spikes/codex-runtime' : 'spikes/' + engineProfile);
const output = resolve(workspace, approvalFlow ? 'summary-approved.md' : 'summary.md');
const branchOutput = resolve(workspace, 'branch-summary.md');
const baseUrl = 'http://127.0.0.1:4176';
const codexPath = resolve(process.env.LOCALAPPDATA, 'hermes/node/codex.cmd');
const wireLogPath = resolve(workspace, forkFlow ? 'app-server-fork-wire.jsonl' : approvalFlow ? 'app-server-approval-wire.jsonl' : `${protocol}-wire.jsonl`);
const dataDirectory = resolve(workspace, `.facts-${forkFlow ? 'fork' : approvalFlow ? 'approval' : protocol}`);
const profileDirectory = resolve(workspace, `profile-${forkFlow ? 'fork' : approvalFlow ? 'approval' : protocol}`);

if (!existsSync(codexPath)) throw new Error(`npm Codex shim not found at ${codexPath}`);
if (existsSync(output)) rmSync(output);
if (existsSync(wireLogPath)) rmSync(wireLogPath);
if (forkFlow && existsSync(branchOutput)) rmSync(branchOutput);
if (existsSync(dataDirectory)) rmSync(dataDirectory, { recursive: true, force: true });
if (existsSync(profileDirectory)) rmSync(profileDirectory, { recursive: true, force: true });

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
    args: [resolve(root, 'apps/desktop/dist/main.js'), '--disable-gpu', `--user-data-dir=${profileDirectory}`],
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      HUMMER_RENDERER_URL: baseUrl,
      HUMMER_CODEX_CWD: workspace,
      HUMMER_CODEX_PATH: codexPath,
      HUMMER_CODEX_WIRE_LOG_PATH: wireLogPath,
      HUMMER_DATA_DIR: dataDirectory,
      HUMMER_ENGINE_PROFILE: engineProfile,
      ...(approvalFlow ? { HUMMER_CODEX_SANDBOX: 'read-only' } : {}),
    },
  });
  app.process().stderr?.on('data', (chunk) => process.stderr.write(`[electron] ${chunk}`));
  console.log('stage=electron-launched');
  const page = await app.firstWindow();
  page.on('console', (message) => { if (message.type() === 'error') console.error(`[renderer] ${message.text()}`); });
  await page.evaluate(() => localStorage.removeItem('hummer-v6'));
  const identityGate = page.getByRole('heading', { name: '进入 HUMMER' });
  const workbenchHeading = page.getByRole('heading', { name: '工作台' });
  await Promise.race([
    identityGate.waitFor({ state: 'visible', timeout: 30_000 }),
    workbenchHeading.waitFor({ state: 'visible', timeout: 30_000 }),
  ]);
  if (await identityGate.isVisible()) {
    await page.getByLabel('公司名称').fill('HUMMER Runtime 验收企业');
    await page.getByLabel('你的姓名').fill('运行时验收人');
    await page.getByLabel('邮箱或手机').fill('runtime-e2e@example.test');
    await page.getByRole('button', { name: '创建并进入' }).click();
    await identityGate.waitFor({ state: 'hidden', timeout: 15_000 });
  }
  if (!(await workbenchHeading.isVisible())) {
    await page.getByRole('button', { name: '工作台', exact: true }).click();
  }
  try {
    await workbenchHeading.waitFor({ state: 'visible', timeout: 30_000 });
  } catch (error) {
    await page.screenshot({ path: resolve(root, 'dist/hummer-desktop-startup-failure.png'), fullPage: true });
    console.error('startup-url=' + page.url());
    console.error('startup-title=' + await page.title());
    console.error('startup-body=' + (await page.locator('body').innerText()).slice(0, 6000));
    throw error;
  }
  console.log('stage=workbench-visible');
  const node = page.getByLabel('执行节点状态');
  await node.getByText('HUMMER 执行内核', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
  if (!(await node.textContent())?.includes(workspace)) throw new Error('Workbench did not show the real Codex working directory');
  console.log('stage=codex-node-visible');

  if (engineProfile === 'openai-codex-validation') {
    await configureInternalValidationDisplay(page);
    await page.getByRole('heading', { name: '工作台' }).waitFor({ state: 'visible', timeout: 30_000 });
    await page.getByLabel('选择模型').selectOption({ label: '旗舰' });
  }
  const composer = page.getByRole('textbox', { name: '任务描述' });
  const runtimeTask = approvalFlow
    ? 'Read input.txt, then use apply_patch to create summary-approved.md with one concise sentence summarizing the file. This is an explicit write-gate test: request approval for the file change and do not modify any other file.'
    : 'Read input.txt with a local command and return one concise sentence that summarizes it. Do not create or modify any file.';
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await composer.fill(runtimeTask);
    await composer.press('Enter');
    const planHeading = page.getByText('我理解你要做的是：', { exact: true });
    await planHeading.waitFor({ state: 'visible', timeout: 150_000 });
    if (await page.getByText('模型生成计划', { exact: true }).count()) break;
    if (attempt === 2) throw new Error('Runtime planning fell back twice during the Codex execution E2E');
    console.log('stage=planner-fallback-retry');
    await page.getByRole('button', { name: '改一下' }).click();
    await planHeading.waitFor({ state: 'hidden', timeout: 10_000 });
  }
  await page.getByText('模型生成计划', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
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
      await page.locator('[data-runtime-tool="workspace.patch"]').waitFor({ state: 'visible', timeout: 120_000 });
      console.log('stage=file-change-visible');
    } else {
      await page.locator('[data-runtime-event-kind="tool"][data-runtime-tool="shell.command"]').last().waitFor({ state: 'visible', timeout: 120_000 });
      console.log('stage=command-event-visible');
    }
    await page.getByText('任务运行完成', { exact: true }).waitFor({ state: 'visible', timeout: 120_000 });
  } catch (error) {
    await page.screenshot({ path: resolve(root, 'dist/hummer-m1-codex-failure.png'), fullPage: true });
    console.error(`page-state=${(await page.locator('body').innerText()).slice(0, 6000)}`);
    if (existsSync(wireLogPath)) console.error(`wire-log=${readFileSync(wireLogPath, 'utf8').slice(-20_000)}`);
    throw error;
  }
  if (approvalFlow && !existsSync(output)) throw new Error('Codex trajectory reported an approved file change but summary-approved.md does not exist');
  if (!approvalFlow && existsSync(output)) throw new Error('Read-only Codex smoke unexpectedly created an output file');
  let forkEvidence;
  if (forkFlow) {
    if (!approvalFlow) throw new Error('Fork E2E requires the approval flow');
    const sourceSessions = await page.evaluate(() => window.hummerPersistence?.listSessions(localStorage.getItem('hummer.auth.session') ?? '') ?? []);
    const sourceSession = sourceSessions.find((session) => session.events.some((event) => event.type === 'result'));
    const sourceResults = sourceSession?.events.filter((event) => event.type === 'result') ?? [];
    const sourceCheckpoint = sourceResults.at(-1)?.sequence;
    if (!sourceSession?.handle.nativeSessionId || !sourceCheckpoint) {
      throw new Error('Fork source session did not persist a native thread id and completed checkpoint');
    }
    if (existsSync(branchOutput)) rmSync(branchOutput);
    await page.getByRole('button', { name: '展开协作与能力' }).click();
    await page.getByRole('button', { name: '工作方法', exact: true }).click();
    await page.getByLabel('本次工作方法').fill('Read input.txt again. Use apply_patch to create branch-summary.md with exactly six words. This is an explicit write-gate test: request approval and do not modify summary-approved.md or any other file.');
    await page.getByRole('button', { name: '保存并重新尝试' }).click();
    console.log('stage=fork-requested');
    const branchApprove = page.getByRole('button', { name: '确认更新' });
    await branchApprove.waitFor({ state: 'visible', timeout: 120_000 });
    if (existsSync(branchOutput)) throw new Error('Fork output existed before HUMMER approval');
    await branchApprove.click();
    console.log('stage=fork-approval-accepted');
    await waitForFile(branchOutput, 120_000);
    await delay(1_000);
    const forkSessions = await page.evaluate(() => window.hummerPersistence?.listSessions(localStorage.getItem('hummer.auth.session') ?? '') ?? []);
    const nativeSessionIds = forkSessions.map((session) => session.handle.nativeSessionId).filter(Boolean);
    if (new Set(nativeSessionIds).size < 2) throw new Error('Fork did not persist two distinct native Codex thread ids');
    const integrity = await page.evaluate(() => window.hummerPersistence?.verifyIntegrity(localStorage.getItem('hummer.auth.session') ?? ''));
    if (!integrity?.valid) throw new Error('Fork persistence hash chain is invalid');
    forkEvidence = {
      occurredAt: new Date().toISOString(),
      checkpointSequence: sourceCheckpoint,
      sourceNativeSessionId: sourceSession.handle.nativeSessionId,
      sourceOutput: readFileSync(output, 'utf8').trim(),
      branchOutput: readFileSync(branchOutput, 'utf8').trim(),
      nativeSessionIds,
      persistedSessionCount: forkSessions.length,
      integrity,
    };
    if (forkEvidence.sourceOutput === forkEvidence.branchOutput) throw new Error('Fork outputs are not different');
    writeFileSync(resolve(workspace, 'fork-evidence.json'), JSON.stringify(forkEvidence, null, 2) + '\n', 'utf8');
    console.log('stage=fork-completed');
  }


  const persistedSessions = await page.evaluate(() => window.hummerPersistence?.listSessions(localStorage.getItem('hummer.auth.session') ?? '') ?? []);
  const persistedEvents = persistedSessions.flatMap((session) => session.events);
  const persistedFileChange = persistedEvents.find((event) => event.type === 'tool' && event.tool === 'workspace.patch');
  if (approvalFlow && !persistedFileChange?.evidenceRefs.some((ref) => ref.startsWith('evidence://sha256/'))) {
    throw new Error('Persisted file change did not contain content-addressed evidence');
  }

  const trajectory = await page.locator('[data-runtime-event-kind]').evaluateAll((nodes) => nodes.map((node) => ({
    sequence: Number(node.getAttribute('data-runtime-sequence')),
    kind: node.getAttribute('data-runtime-event-kind'),
    tool: node.getAttribute('data-runtime-tool') || undefined,
    text: node.textContent?.replace(/\s+/g, ' ').trim(),
  })));
  const artifactStem = forkFlow ? 'app-server-fork-trajectory' : approvalFlow ? 'app-server-approval-trajectory' : protocol === 'app-server-jsonrpc' ? 'app-server-trajectory' : 'desktop-trajectory';
  if (approvalFlow) assertApprovalSequence(trajectory);
  writeFileSync(resolve(workspace, `${artifactStem}.json`), `${JSON.stringify(trajectory, null, 2)}\n`, 'utf8');
  await page.screenshot({ path: resolve(root, `dist/hummer-m1-codex-${protocol}.png`), fullPage: true });
  console.log(JSON.stringify({ protocol, approvalFlow, forkFlow, engineProfile, workspace, output, branchOutput: forkFlow ? branchOutput : undefined, forkEvidence, persistedFileChange, trajectory }, null, 2));
} finally {
  if (app) {
    const electronProcess = app.process();
    await Promise.race([app.close(), delay(5_000)]);
    if (!electronProcess.killed) electronProcess.kill();
  }
  vite.kill();
}

async function waitForFile(path, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) return;
    await delay(250);
  }
  throw new Error('Timed out waiting for file ' + path);
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
