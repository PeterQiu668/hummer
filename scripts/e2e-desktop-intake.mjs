import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron as electron } from 'playwright';
import ExcelJS from 'exceljs';
import { configureInternalValidationDisplay } from './support/configure-e2e-engine.mjs';

const root = process.cwd();
const spikeRoot = resolve(root, 'spikes/m5e-intake');
const workspace = resolve(spikeRoot, 'workspace');
const inbox = resolve(workspace, 'inbox');
const dataDirectory = resolve(spikeRoot, 'facts');
const profileDirectory = resolve(spikeRoot, 'profile');
const wireLogPath = resolve(spikeRoot, 'intake-wire.jsonl');
const evidencePath = resolve(spikeRoot, 'intake-evidence.json');
const screenshotPath = resolve(spikeRoot, 'intake.png');
const draftPath = resolve(workspace, 'deliverables/order-summary-draft.md');
const baseUrl = 'http://127.0.0.1:4194';
const codexPath = resolve(process.env.LOCALAPPDATA ?? '', 'hermes/node/codex.cmd');

if (!existsSync(codexPath)) throw new Error(`Real Codex CLI is unavailable at ${codexPath}`);
for (const target of [workspace, dataDirectory, profileDirectory]) {
  if (!target.startsWith(spikeRoot)) throw new Error('Refusing to clean outside the M5-E intake spike directory');
  if (existsSync(target)) rmSync(target, { recursive: true, force: true });
}
mkdirSync(inbox, { recursive: true });
for (const target of [wireLogPath, evidencePath]) {
  if (existsSync(target)) rmSync(target);
}

const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4194', '--strictPort'], {
  cwd: root, stdio: 'pipe', windowsHide: true,
  env: { ...process.env, VITE_HUMMER_RUNTIME_ADAPTER: 'codex', VITE_HUMMER_CODEX_PROTOCOL: 'app-server-jsonrpc' },
});

let app;
try {
  await waitForServer(baseUrl);
  app = await launchDesktop();
  let page = await app.firstWindow();
  const token = await ensureIdentity(page);
  await configureInternalValidationDisplay(page);
  await page.evaluate(async ({ token, inbox }) => {
    if (!window.hummerWorkOrderIntake) throw new Error('Work order intake bridge is unavailable');
    await window.hummerWorkOrderIntake.configureInbox(token, inbox);
  }, { token, inbox });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('订单明细');
  sheet.addRow(['订单号', '客户', '金额', '交付要求']);
  sheet.addRow(['SO-2026-0912', '华东制造集团', 268000, '9 月 30 日前交付月报']);
  await workbook.xlsx.writeFile(resolve(inbox, 'SO-2026-0912.xlsx'));

  await page.getByText('待处理工单', { exact: true }).waitFor({ state: 'visible', timeout: 20_000 });
  const orderTitle = '处理新订单：inbox\\SO-2026-0912.xlsx';
  await page.getByText(orderTitle, { exact: true }).waitFor({ state: 'visible' });
  const preConfirm = await page.evaluate(async ({ token }) => {
    if (!window.hummerWorkOrderIntake || !window.hummerPersistence) throw new Error('Required bridges are unavailable');
    return {
      pending: await window.hummerWorkOrderIntake.list(token),
      sessions: await window.hummerPersistence.listSessions(token),
      integrity: await window.hummerPersistence.verifyIntegrity(token),
    };
  }, { token });
  if (preConfirm.pending.length !== 1 || preConfirm.sessions.length !== 0) throw new Error(`Unconfirmed intake triggered execution: ${JSON.stringify(preConfirm)}`);
  if (!preConfirm.pending[0]?.payload?.preReadSummary?.includes('华东制造集团') || preConfirm.pending[0]?.payload?.sourceSha256?.length !== 64) {
    throw new Error(`Inbox attachment was not locally pre-read into the pending work order: ${JSON.stringify(preConfirm.pending[0])}`);
  }

  await page.getByRole('button', { name: `确认工单：${orderTitle}` }).click();
  await page.getByText('模型生成计划', { exact: true }).waitFor({ state: 'visible', timeout: 120_000 });
  await page.getByRole('button', { name: '开始干' }).click();
  await page.locator('[data-runtime-event-kind="tool"][data-runtime-tool="doc.extract"]').waitFor({ state: 'visible', timeout: 120_000 });
  await page.getByText('任务运行完成', { exact: true }).waitFor({ state: 'visible', timeout: 120_000 });

  const productChain = await page.evaluate(async ({ token }) => {
    if (!window.hummerPersistence || !window.hummerWorkOrderIntake || !window.hummerApprovalPolicy || !window.hummerToolRegistry || !window.hummerOutcomes) {
      throw new Error('M5-E desktop bridges are unavailable');
    }
    const sessions = await window.hummerPersistence.listSessions(token);
    const session = sessions.find((candidate) => candidate.events.some((event) => event.type === 'tool' && event.tool === 'doc.extract'));
    if (!session) throw new Error('Confirmed intake did not create the real doc.extract session');
    const sequence = Math.max(...session.events.map((event) => event.sequence));
    const sessionId = session.handle.sessionId;
    const approvalId = `approval_intake_${sessionId}`;
    const requestedBy = 'employee:order-delivery-assistant';
    const occurredAt = new Date().toISOString();
    await window.hummerPersistence.appendEvent({ token, plan: session.plan, handle: session.handle, event: {
      sessionId, sequence: sequence + 1, occurredAt, actorRef: requestedBy, type: 'approval_required', approvalId,
      title: '确认生成客户外发草稿', message: '只生成本地草稿，不执行投递。', tool: 'external.send.draft',
      args: { relativePath: 'deliverables/order-summary-draft.md' }, result: 'pending', durationMs: null, costCny: null, evidenceRefs: [],
    } });
    const authorization = await window.hummerApprovalPolicy.authorize({ token, input: {
      sessionId, approvalId, action: 'external.send.draft', requestedBy, estimatedCostCny: null, approved: true,
      occurredAt: new Date(Date.parse(occurredAt) + 1).toISOString(),
    } });
    if (!authorization.approved) throw new Error(`Named approval was not accepted: ${JSON.stringify(authorization)}`);
    const draft = await window.hummerToolRegistry.createExternalSendDraft({ token, input: {
      sessionId, approvalId, requestedBy, relativePath: 'deliverables/order-summary-draft.md',
      content: '订单 SO-2026-0912：华东制造集团，金额 268000 元，9 月 30 日前交付月报。此文件仅为外发草稿，尚未投递。',
      occurredAt: new Date(Date.parse(occurredAt) + 2).toISOString(), idempotencyKey: `m5e-intake-draft:${sessionId}`,
    } });
    await window.hummerPersistence.appendEvent({ token, plan: session.plan, handle: session.handle, event: {
      sessionId, sequence: sequence + 2, occurredAt: new Date(Date.parse(occurredAt) + 3).toISOString(), actorRef: `account:${authorization.decisionActorRef ?? 'owner'}`,
      type: 'approval_resolved', approvalId, approved: true, result: '已批准生成本地外发草稿。', evidenceRefs: [draft.evidenceRef],
    } });
    await window.hummerPersistence.appendEvent({ token, plan: session.plan, handle: session.handle, event: {
      sessionId, sequence: sequence + 3, occurredAt: new Date(Date.parse(occurredAt) + 4).toISOString(), actorRef: requestedBy,
      type: 'result', title: '订单交付完成', summary: '已读取真实订单并生成经批准的外发草稿。',
      deliverables: [{ name: '订单摘要外发草稿', kind: 'draft', uri: draft.evidenceRef }], durationMs: null, costCny: null,
      evidenceRefs: [draft.evidenceRef],
    } });
    const definition = await window.hummerOutcomes.define({ token, input: {
      actionPattern: 'order.intake.deliver', title: '真实订单交付', acceptanceCriteria: '订单被读取，草稿经具名审批，回执可验链', riskLevel: 'high',
      idempotencyKey: 'm5e-intake-outcome-definition',
    } });
    const outcome = await window.hummerOutcomes.record({ token, input: {
      outcomeDefinitionId: definition.id, workOrderId: session.plan.workOrderId, sessionId, approvalId, verdict: 'accepted',
      evidenceRef: draft.evidenceRef, occurredAt: new Date(Date.parse(occurredAt) + 5).toISOString(), idempotencyKey: `m5e-intake-outcome:${sessionId}`,
    } });
    return {
      intake: (await window.hummerWorkOrderIntake.listAll(token))[0], sessionId, plan: session.plan, authorization, draft,
      receipt: await window.hummerOutcomes.receipt({ token, input: { outcomeEventId: outcome.id } }),
      integrity: await window.hummerPersistence.verifyIntegrity(token),
    };
  }, { token });

  if (productChain.intake.status !== 'confirmed' || !productChain.intake.workOrderId) throw new Error(`Intake did not remain confirmed: ${JSON.stringify(productChain.intake)}`);
  if (!productChain.receipt.tools.some((tool) => tool.capabilityId === 'doc.extract')) throw new Error('Receipt lacks doc.extract');
  if (!productChain.receipt.tools.some((tool) => tool.capabilityId === 'external.send.draft')) throw new Error('Receipt lacks external.send.draft');
  if (!productChain.integrity.valid || !existsSync(draftPath)) throw new Error('Final product chain or draft failed');

  await page.screenshot({ path: screenshotPath, fullPage: true });
  await closeDesktop(app);
  app = await launchDesktop();
  page = await app.firstWindow();
  const restartToken = await ensureIdentity(page);
  const restart = await page.evaluate(async ({ token, sessionId }) => {
    if (!window.hummerWorkOrderIntake || !window.hummerPersistence) throw new Error('Persistence bridges are unavailable after restart');
    const intakes = await window.hummerWorkOrderIntake.listAll(token);
    const sessions = await window.hummerPersistence.listSessions(token);
    return {
      intake: intakes[0],
      session: sessions.find((candidate) => candidate.handle.sessionId === sessionId),
      integrity: await window.hummerPersistence.verifyIntegrity(token),
    };
  }, { token: restartToken, sessionId: productChain.sessionId });
  if (restart.intake?.status !== 'confirmed' || !restart.session || !restart.integrity.valid) throw new Error(`Restart did not restore the intake chain: ${JSON.stringify(restart)}`);

  const output = {
    generatedAt: new Date().toISOString(), evidenceClass: 'real-codex-plus-local-product-chain',
    wireLogPath, preConfirm, productChain, restart,
  };
  writeFileSync(evidencePath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    evidencePath, screenshotPath, intakeId: productChain.intake.id, workOrderId: productChain.intake.workOrderId,
    sessionId: productChain.sessionId, tools: productChain.receipt.tools.map((tool) => tool.capabilityId),
    preConfirmSessions: preConfirm.sessions.length, restartRestored: Boolean(restart.session), integrity: restart.integrity,
  }, null, 2));
} finally {
  if (app) await closeDesktop(app);
  vite.kill();
}

function launchDesktop() {
  return electron.launch({
    args: [resolve(root, 'apps/desktop/dist/main.js'), '--disable-gpu', `--user-data-dir=${profileDirectory}`],
    env: {
      ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', HUMMER_RENDERER_URL: baseUrl,
      HUMMER_CODEX_CWD: workspace, HUMMER_CODEX_PATH: codexPath, HUMMER_CODEX_WIRE_LOG_PATH: wireLogPath,
      HUMMER_DATA_DIR: dataDirectory, HUMMER_ENGINE_PROFILE: 'openai-codex-validation',
    },
  });
}

async function closeDesktop(application) {
  const child = application.process();
  await Promise.race([application.close(), delay(5_000)]);
  if (!child.killed) child.kill();
}

async function ensureIdentity(page) {
  await page.waitForFunction(() => [...document.querySelectorAll('h1, h2')].some((node) => ['进入 HUMMER', '工作台'].includes(node.textContent?.trim() ?? '')), undefined, { timeout: 30_000 });
  if (await page.getByRole('heading', { name: '进入 HUMMER' }).isVisible()) {
    await page.getByLabel('公司名称').fill('M5-E 订单验收企业');
    await page.getByLabel('你的姓名').fill('订单责任人');
    await page.getByLabel('邮箱或手机').fill('m5e-intake@example.test');
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
