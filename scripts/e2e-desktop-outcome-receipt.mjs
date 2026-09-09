import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron as electron } from 'playwright';

const root = process.cwd();
const baseUrl = 'http://127.0.0.1:4186';
const spikeRoot = resolve(root, 'spikes/m5a-outcome-ledger');
const dataDirectory = resolve(spikeRoot, 'facts');
const profileDirectory = resolve(spikeRoot, 'profile');
const evidencePath = resolve(spikeRoot, 'outcome-receipt-evidence.json');

for (const directory of [dataDirectory, profileDirectory]) {
  if (!directory.startsWith(spikeRoot)) throw new Error('Refusing to clean outside M5-A evidence directory');
  if (existsSync(directory)) rmSync(directory, { recursive: true, force: true });
}
mkdirSync(spikeRoot, { recursive: true });

const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4186', '--strictPort'], {
  cwd: root,
  stdio: 'pipe',
  windowsHide: true,
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
      HUMMER_DATA_DIR: dataDirectory,
      HUMMER_CODEX_CWD: spikeRoot,
    },
  });
  const page = await app.firstWindow();
  const token = await ensureIdentity(page);
  const evidence = await page.evaluate(async ({ token }) => {
    if (!window.hummerOutcomes || !window.hummerPersistence || !window.hummerApprovalPolicy) {
      throw new Error('M5-A desktop bridges are unavailable');
    }
    const sessionId = 'session_m5a_receipt';
    const approvalId = 'approval_m5a_receipt';
    const workOrderId = 'work_order_m5a_receipt';
    const occurredAt = '2026-09-10T02:30:00.000Z';
    const definition = await window.hummerOutcomes.define({
      token,
      input: {
        actionPattern: 'external.send.summary',
        title: '客户摘要外发验收',
        acceptanceCriteria: '负责人已确认内容与收件范围',
        riskLevel: 'high',
        idempotencyKey: 'm5a-e2e-definition',
      },
    });
    await window.hummerPersistence.saveSession({
      token,
      plan: { id: 'plan_m5a_receipt', prompt: '准备并验收客户摘要' },
      handle: { runtimeId: 'mock-runtime', sessionId },
    });
    await window.hummerPersistence.appendEvent({
      token,
      plan: { id: 'plan_m5a_receipt', prompt: '准备并验收客户摘要' },
      handle: { runtimeId: 'mock-runtime', sessionId },
      event: {
        sessionId,
        sequence: 1,
        occurredAt,
        actorRef: 'employee:receipt-e2e',
        type: 'approval_required',
        approvalId,
        title: '客户摘要外发前确认',
        message: '请核对收件范围',
        tool: 'external.send.summary',
        args: { recipients: 3 },
        result: '待批准',
        durationMs: null,
        costCny: null,
        evidenceRefs: [],
      },
    });
    const approval = await window.hummerApprovalPolicy.authorize({
      token,
      input: {
        sessionId,
        approvalId,
        action: 'external.send.summary',
        requestedBy: 'employee:receipt-e2e',
        estimatedCostCny: null,
        approved: true,
        occurredAt: '2026-09-10T02:31:00.000Z',
      },
    });
    if (!approval.approved) throw new Error(`M5-A approval was rejected: ${approval.reason}`);
    const outcome = await window.hummerOutcomes.record({
      token,
      input: {
        outcomeDefinitionId: definition.id,
        workOrderId,
        sessionId,
        approvalId,
        verdict: 'accepted',
        evidenceRef: 'evidence://sha256/m5a-accepted-summary',
        occurredAt: '2026-09-10T02:32:00.000Z',
        idempotencyKey: 'm5a-e2e-outcome',
      },
    });
    const cost = await window.hummerOutcomes.recordCost({
      token,
      input: {
        sessionId,
        outcomeEventId: outcome.id,
        engineProfileId: 'deepseek-standard',
        model: 'deepseek-v4-flash',
        usage: { inputTokens: 4200, cachedInputTokens: 800, outputTokens: 950 },
        occurredAt: '2026-09-10T02:32:30.000Z',
        idempotencyKey: 'm5a-e2e-cost',
      },
    });
    const sessionCost = await window.hummerOutcomes.sessionCost({ token, input: { sessionId } });
    const receipt = await window.hummerOutcomes.receipt({ token, input: { outcomeEventId: outcome.id } });
    const integrity = await window.hummerPersistence.verifyIntegrity(token);
    return { generatedAt: new Date().toISOString(), sessionId, workOrderId, definition, approval, outcome, cost, sessionCost, receipt, integrity };
  }, { token });

  if (evidence.outcome.verdict !== 'accepted') throw new Error('Outcome acceptance was not persisted');
  if (!(evidence.cost.costCny > 0) || evidence.sessionCost.totalCostCny !== evidence.cost.costCny) throw new Error('Cost ledger total is not backed by the recorded cost');
  if (evidence.receipt.totalCostCny !== evidence.cost.costCny || evidence.receipt.approval?.status !== 'approved') throw new Error('Receipt omitted its approval or real cost');
  if (!evidence.integrity?.valid || !evidence.receipt.chainIntegrity?.valid) throw new Error('Outcome receipt hash chain is invalid');
  if (/sk-[A-Za-z0-9]/.test(evidence.receipt.receiptJson)) throw new Error('Outcome receipt leaked a secret-shaped value');
  writeFileSync(evidencePath, `${JSON.stringify({ ...evidence, evidencePath, dataDirectory }, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ...evidence, evidencePath, dataDirectory }, null, 2));
} finally {
  if (app) {
    const process = app.process();
    await Promise.race([app.close(), delay(5_000)]);
    if (!process.killed) process.kill();
  }
  vite.kill();
}

async function ensureIdentity(page) {
  await page.waitForFunction(() => [...document.querySelectorAll('h1, h2')].some((node) => ['进入 HUMMER', '工作台'].includes(node.textContent?.trim() ?? '')), undefined, { timeout: 30_000 });
  const existing = await page.evaluate(() => localStorage.getItem('hummer.auth.session'));
  if (existing) return existing;
  await page.getByLabel('公司名称').fill('M5-A 验收企业');
  await page.getByLabel('你的姓名').fill('结果验收员');
  await page.getByLabel('邮箱或手机').fill('m5a-outcome@example.test');
  await page.getByRole('button', { name: '创建并进入' }).click();
  await page.getByRole('heading', { name: '进入 HUMMER' }).waitFor({ state: 'hidden', timeout: 15_000 });
  const token = await page.evaluate(() => localStorage.getItem('hummer.auth.session'));
  if (!token) throw new Error('Authentication token was not created');
  return token;
}

async function waitForServer(url) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Vite is still starting.
    }
    await delay(250);
  }
  throw new Error(`Vite did not become reachable at ${url}`);
}
