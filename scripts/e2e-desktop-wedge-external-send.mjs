import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron as electron } from 'playwright';

const root = process.cwd();
const credential = process.env.DEEPSEEK_API_KEY;
if (!credential) throw new Error('DEEPSEEK_API_KEY is required for the real external-send wedge E2E');
const spikeRoot = resolve(root, 'spikes/m5c-external-send');
const dataDirectory = resolve(spikeRoot, 'facts');
const profileDirectory = resolve(spikeRoot, 'profile');
const draftPath = resolve(spikeRoot, 'customer-update-draft.md');
const sentMarkerPath = resolve(spikeRoot, 'external-delivery.marker');
const wireLogPath = resolve(spikeRoot, 'deepseek-wire.jsonl');
const evidencePath = resolve(spikeRoot, 'wedge-evidence.json');
const approvedReceiptPath = resolve(spikeRoot, 'approved-receipt.json');
const rejectedReceiptPath = resolve(spikeRoot, 'rejected-receipt.json');
const codexPath = resolve(process.env.LOCALAPPDATA, 'hermes/node/codex.cmd');
const baseUrl = 'http://127.0.0.1:4185';
const task = 'Read the local README and use apply_patch to create spikes/m5c-external-send/customer-update-draft.md. Write a concise Chinese customer update draft. Prepare it for external sending but do not send it or contact any external service.';

if (!existsSync(codexPath)) throw new Error(`Codex npm shim not found at ${codexPath}`);
mkdirSync(spikeRoot, { recursive: true });
for (const path of [dataDirectory, profileDirectory]) if (existsSync(path)) rmSync(path, { recursive: true, force: true });
for (const path of [draftPath, sentMarkerPath, wireLogPath, evidencePath, approvedReceiptPath, rejectedReceiptPath]) if (existsSync(path)) rmSync(path);

const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4185', '--strictPort'], {
  cwd: root, stdio: 'pipe', windowsHide: true,
  env: { ...process.env, VITE_HUMMER_RUNTIME_ADAPTER: 'codex', VITE_HUMMER_CODEX_PROTOCOL: 'app-server-jsonrpc' },
});

let desktop;
try {
  await waitForServer(baseUrl);
  desktop = await launchDesktop();
  const page = await desktop.firstWindow();
  const token = await ensureIdentity(page);
  await page.evaluate(async ({ token, credential }) => {
    if (!window.hummerEngineCredentials) throw new Error('Encrypted credential bridge is unavailable');
    await window.hummerEngineCredentials.configure({ token, engineProfileId: 'deepseek-standard', credential });
  }, { token, credential });
  await page.reload();
  await page.getByRole('heading', { name: '\u5de5\u4f5c\u53f0' }).waitFor({ state: 'visible', timeout: 30_000 });
  const composer = page.getByRole('textbox', { name: '\u4efb\u52a1\u63cf\u8ff0' });
  await composer.fill(task);
  await composer.press('Enter');
  const planBadge = page.getByText('\u6a21\u578b\u751f\u6210\u8ba1\u5212', { exact: true });
  await planBadge.waitFor({ state: 'visible', timeout: 150_000 });
  const planCard = planBadge.locator('xpath=ancestor::form');
  const planText = (await planCard.innerText()).replace(/\s+/g, ' ');
  if (!planText.includes('external.send')) throw new Error(`Real plan did not derive an external.send action: ${planText.slice(0, 1000)}`);
  await page.getByRole('button', { name: '\u5f00\u59cb\u5e72' }).click();
  await approveRuntimeUntilComplete(page);
  if (!existsSync(draftPath)) throw new Error('Real runtime completed without creating the external-send draft');

  const productChain = await page.evaluate(async ({ token, task }) => {
    if (!window.hummerPersistence || !window.hummerOutcomes || !window.hummerApprovalPolicy) throw new Error('Required HUMMER product bridges are unavailable');
    const sessions = await window.hummerPersistence.listSessions(token);
    const runtimeSession = sessions.find((record) => record.plan?.prompt === task);
    if (!runtimeSession) throw new Error('Real DeepSeek execution session was not persisted');
    const resultEvent = runtimeSession.events.findLast((event) => event.type === 'result' && event.usage);
    if (!resultEvent?.usage) throw new Error('Real DeepSeek result did not provide token usage');
    const fileEvidence = runtimeSession.events.findLast((event) => event.type === 'tool' && event.tool === 'workspace.patch')?.evidenceRefs?.[0];
    if (!fileEvidence?.startsWith('evidence://sha256/')) throw new Error('Draft does not have content-addressed evidence');
    const definition = await window.hummerOutcomes.define({ token, input: {
      actionPattern: 'external.send.customer-update', title: '\u5ba2\u6237\u901a\u77e5\u5916\u53d1\u5ba1\u6838',
      acceptanceCriteria: '\u5177\u540d\u8d1f\u8d23\u4eba\u5ba1\u6838\u8349\u7a3f\u548c\u6536\u4ef6\u8303\u56f4\uff1b\u672c\u9a8c\u6536\u4e0d\u5305\u542b\u6e20\u9053\u6295\u9012', riskLevel: 'high', idempotencyKey: 'm5c-wedge-definition',
    } });
    const branches = [];
    for (const approved of [false, true]) {
      const branch = approved ? 'approved' : 'rejected';
      const sessionId = `session_m5c_external_${branch}`;
      const approvalId = `approval_m5c_external_${branch}`;
      const plan = { id: `plan_m5c_external_${branch}`, prompt: task };
      const handle = { runtimeId: 'hummer-decision-gate', sessionId };
      await window.hummerPersistence.saveSession({ token, plan, handle });
      await window.hummerPersistence.appendEvent({ token, plan, handle, event: {
        sessionId, sequence: 1, occurredAt: new Date().toISOString(), actorRef: 'employee:codex', type: 'approval_required',
        approvalId, title: '\u8bf7\u6c42\u5916\u53d1\u5ba2\u6237\u901a\u77e5', message: '\u8349\u7a3f\u5df2\u751f\u6210\uff0c\u7b49\u5f85\u5177\u540d\u8d1f\u8d23\u4eba\u51b3\u5b9a',
        tool: 'external.send.customer-update', args: { recipients: ['customer-contact'], draftEvidence: fileEvidence }, result: '\u5f85\u5ba1\u6279', durationMs: null, costCny: null, evidenceRefs: [fileEvidence],
      } });
      const approval = await window.hummerApprovalPolicy.authorize({ token, input: {
        sessionId, approvalId, action: 'external.send.customer-update', requestedBy: 'employee:codex', estimatedCostCny: resultEvent.costCny ?? null,
        approved, occurredAt: new Date().toISOString(),
      } });
      const outcome = await window.hummerOutcomes.record({ token, input: {
        outcomeDefinitionId: definition.id, workOrderId: `work_order_m5c_${branch}`, sessionId, approvalId,
        verdict: approved ? 'accepted' : 'rejected', evidenceRef: fileEvidence, occurredAt: new Date().toISOString(), idempotencyKey: `m5c-wedge-outcome-${branch}`,
      } });
      let cost = null;
      if (approved) cost = await window.hummerOutcomes.recordCost({ token, input: {
        sessionId, outcomeEventId: outcome.id, engineProfileId: 'deepseek-standard', model: runtimeSession.handle.engine?.modelName ?? 'deepseek-v4-flash',
        usage: { inputTokens: resultEvent.usage.inputTokens, cachedInputTokens: resultEvent.usage.cachedInputTokens, outputTokens: resultEvent.usage.outputTokens },
        occurredAt: new Date().toISOString(), idempotencyKey: 'm5c-wedge-real-runtime-cost',
      } });
      const receipt = await window.hummerOutcomes.exportReceipt({ token, input: { outcomeEventId: outcome.id } });
      branches.push({ branch, approval, outcome, cost, receipt });
    }
    return { runtimeSessionId: runtimeSession.handle.sessionId, usage: resultEvent.usage, definition, branches, integrity: await window.hummerPersistence.verifyIntegrity(token) };
  }, { token, task });

  if (!productChain.integrity?.valid) throw new Error('External-send wedge hash chain is invalid');
  const rejected = productChain.branches.find((branch) => branch.branch === 'rejected');
  const approved = productChain.branches.find((branch) => branch.branch === 'approved');
  if (rejected?.approval.approved || rejected?.outcome.verdict !== 'rejected') throw new Error('Rejection branch did not remain rejected');
  if (!approved?.approval.approved || approved?.outcome.verdict !== 'accepted' || !(approved.cost?.costCny > 0)) throw new Error('Approved branch omitted approval or real runtime cost');
  if (existsSync(sentMarkerPath)) throw new Error('Rejection branch caused an external delivery marker');
  writeFileSync(rejectedReceiptPath, `${rejected.receipt}\n`, 'utf8');
  writeFileSync(approvedReceiptPath, `${approved.receipt}\n`, 'utf8');
  for (const path of [rejectedReceiptPath, approvedReceiptPath]) {
    const verification = verifyReceipt(path);
    if (verification.status !== 0 || !verification.result.valid) throw new Error(`Receipt verification failed for ${path}: ${verification.stdout}`);
  }
  const trajectory = await page.locator('[data-runtime-event-kind]').evaluateAll((nodes) => nodes.map((node) => ({
    sequence: Number(node.getAttribute('data-runtime-sequence')), kind: node.getAttribute('data-runtime-event-kind'), tool: node.getAttribute('data-runtime-tool') || undefined,
    text: node.textContent?.replace(/\s+/g, ' ').trim(),
  })));
  const evidence = { generatedAt: new Date().toISOString(), evidenceClass: 'real-deepseek-runtime-plus-local-product-chain', task, planText, draftPath, draftShaEvidence: approved.outcome.evidenceRef, trajectory, productChain: { ...productChain, branches: productChain.branches.map(({ receipt, ...branch }) => branch) }, rejectedReceiptPath, approvedReceiptPath, noExternalDeliveryOnReject: !existsSync(sentMarkerPath) };
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  const secretScan = [evidencePath, wireLogPath, rejectedReceiptPath, approvedReceiptPath].filter(existsSync).map((path) => readFileSync(path, 'utf8')).join('\n');
  if (secretScan.includes(credential) || /\bsk-[A-Za-z0-9_-]{12,}\b/.test(secretScan)) throw new Error('Secret leaked into wedge evidence');
  console.log(JSON.stringify({ evidencePath, wireLogPath, rejectedReceiptPath, approvedReceiptPath, integrity: productChain.integrity, realCostCny: approved.cost.costCny }, null, 2));
} finally {
  if (desktop) await closeDesktop(desktop);
  vite.kill();
}

function launchDesktop() {
  const { DEEPSEEK_API_KEY: _removed, ...environmentWithoutCredential } = process.env;
  return electron.launch({
    args: [resolve(root, 'apps/desktop/dist/main.js'), '--disable-gpu', `--user-data-dir=${profileDirectory}`],
    env: { ...environmentWithoutCredential, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', HUMMER_RENDERER_URL: baseUrl, HUMMER_DATA_DIR: dataDirectory, HUMMER_CODEX_CWD: root, HUMMER_CODEX_PATH: codexPath, HUMMER_CODEX_WIRE_LOG_PATH: wireLogPath, HUMMER_ENGINE_PROFILE: 'deepseek-standard' },
  });
}

async function approveRuntimeUntilComplete(page) {
  const completed = page.getByText('\u4efb\u52a1\u8fd0\u884c\u5b8c\u6210', { exact: true });
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    if (await completed.isVisible().catch(() => false)) return;
    const approve = page.getByRole('button', { name: '\u786e\u8ba4\u66f4\u65b0' });
    if (await approve.isVisible().catch(() => false)) await approve.click();
    await delay(500);
  }
  throw new Error('Real DeepSeek draft execution did not complete within 240 seconds');
}

async function ensureIdentity(page) {
  const gate = page.getByRole('heading', { name: '\u8fdb\u5165 HUMMER' });
  const workbench = page.getByRole('heading', { name: '\u5de5\u4f5c\u53f0' });
  await Promise.race([gate.waitFor({ state: 'visible', timeout: 30_000 }), workbench.waitFor({ state: 'visible', timeout: 30_000 })]);
  if (await gate.isVisible()) {
    await page.getByLabel('\u516c\u53f8\u540d\u79f0').fill('HUMMER M5-C \u5916\u53d1\u5ba1\u6838');
    await page.getByLabel('\u4f60\u7684\u59d3\u540d').fill('\u5916\u53d1\u5ba1\u6279\u4eba');
    await page.getByLabel('\u90ae\u7bb1\u6216\u624b\u673a').fill('external-send-e2e@example.test');
    await page.getByRole('button', { name: '\u521b\u5efa\u5e76\u8fdb\u5165' }).click();
    await gate.waitFor({ state: 'hidden', timeout: 15_000 });
  }
  const token = await page.evaluate(() => localStorage.getItem('hummer.auth.session'));
  if (!token) throw new Error('Authenticated session was not created');
  return token;
}

function verifyReceipt(path) {
  const result = spawnSync(process.execPath, [resolve(root, 'scripts/verify-receipt.mjs'), path], { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout.trim(), result: JSON.parse(result.stdout) };
}
async function closeDesktop(app) { const process = app.process(); await Promise.race([app.close(), delay(5_000)]); if (!process.killed) process.kill(); }
async function waitForServer(url) { const deadline = Date.now() + 30_000; while (Date.now() < deadline) { try { if ((await fetch(url)).ok) return; } catch { /* Vite is starting. */ } await delay(250); } throw new Error(`Vite did not become reachable at ${url}`); }
