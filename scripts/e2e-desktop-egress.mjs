import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron as electron } from 'playwright';

const root = process.cwd();
const spikeRoot = resolve(root, 'spikes/m5h-egress');
const dataDirectory = resolve(spikeRoot, 'facts');
const profileDirectory = resolve(spikeRoot, 'profile');
const executionRoot = resolve(spikeRoot, 'order-workspaces');
const deliveredDirectory = resolve(spikeRoot, 'customer-delivery');
const rejectedDirectory = resolve(spikeRoot, 'rejected-delivery');
const evidencePath = resolve(spikeRoot, 'egress-evidence.json');
const receiptPath = resolve(spikeRoot, 'egress-receipt.json');
const baseUrl = 'http://127.0.0.1:4210';

for (const target of [dataDirectory, profileDirectory, executionRoot, deliveredDirectory, rejectedDirectory]) {
  if (!target.startsWith(spikeRoot)) throw new Error('Refusing to clean outside the M5-H egress spike directory');
  if (existsSync(target)) rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
}
if (existsSync(evidencePath)) rmSync(evidencePath);
if (existsSync(receiptPath)) rmSync(receiptPath);

const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4210', '--strictPort'], {
  cwd: root, stdio: 'pipe', windowsHide: true,
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
      HUMMER_EXEC_WORKSPACE_ROOT: executionRoot,
    },
  });
  const page = await app.firstWindow();
  const token = await ensureIdentity(page);
  const result = await page.evaluate(async ({ token, executionRoot, deliveredDirectory, rejectedDirectory }) => {
    if (!window.hummerPersistence || !window.hummerApprovalPolicy || !window.hummerToolRegistry || !window.hummerOutcomes) {
      throw new Error('M5-H desktop bridges are unavailable');
    }
    const requestedBy = 'employee:delivery-agent';
    const plan = { id: 'plan_m5h_egress', prompt: 'Deliver the approved customer artifact.', workOrderId: 'wo_m5h_egress' };
    const runBranch = async (branch, approved, destinationDirectory) => {
      const sessionId = `session_m5h_egress_${branch}`;
      const approvalId = `approval_m5h_egress_${branch}`;
      const workOrderId = `wo_m5h_egress_${branch}`;
      const handle = { runtimeId: 'hummer-builtin', sessionId };
      const branchPlan = { ...plan, id: `plan_m5h_egress_${branch}`, workOrderId };
      const workspace = `${executionRoot}/${workOrderId}`;
      await window.hummerPersistence.saveSession({ token, plan: branchPlan, handle });
      await window.hummerPersistence.appendEvent({ token, plan: branchPlan, handle, event: {
        sessionId, sequence: 1, occurredAt: '2026-09-14T09:00:00.000Z', actorRef: requestedBy,
        type: 'approval_required', approvalId, title: '确认导出客户成果', message: '成果将复制到你选择的本地目录。',
        tool: 'external.send', args: { destinationDirectory, sourceRelativePath: 'delivery/proposal.md' }, result: 'pending',
        durationMs: null, costCny: null, evidenceRefs: [],
      } });
      const authorization = await window.hummerApprovalPolicy.authorize({ token, input: {
        sessionId, approvalId, action: 'external.send', requestedBy, estimatedCostCny: null, approved,
        occurredAt: '2026-09-14T09:00:01.000Z',
      } });
      return { branch, sessionId, approvalId, workOrderId, workspace, authorization };
    };
    return { requestedBy, approved: await runBranch('approved', true, deliveredDirectory), rejected: await runBranch('rejected', false, rejectedDirectory) };
  }, { token, executionRoot: executionRoot.replaceAll('\\', '/'), deliveredDirectory: deliveredDirectory.replaceAll('\\', '/'), rejectedDirectory: rejectedDirectory.replaceAll('\\', '/') });

  const approvedSource = resolve(executionRoot, result.approved.workOrderId, 'delivery/proposal.md');
  const rejectedSource = resolve(executionRoot, result.rejected.workOrderId, 'delivery/proposal.md');
  mkdirSync(resolve(approvedSource, '..'), { recursive: true });
  mkdirSync(resolve(rejectedSource, '..'), { recursive: true });
  writeFileSync(approvedSource, 'approved local export', 'utf8');
  writeFileSync(rejectedSource, 'rejected local export', 'utf8');
  // Sources are staged after session registration but before the egress IPC is invoked below.
  const execution = await page.evaluate(async ({ token, approved, rejected, deliveredDirectory, rejectedDirectory }) => {
    if (!window.hummerToolRegistry || !window.hummerOutcomes || !window.hummerPersistence) throw new Error('M5-H bridges disappeared');
    const rerun = async (branch, destinationDirectory) => window.hummerToolRegistry.exportApprovedArtifact({ token, input: {
      sessionId: branch.sessionId, approvalId: branch.approvalId, requestedBy: 'employee:delivery-agent', workOrderId: branch.workOrderId,
      sourceRelativePath: 'delivery/proposal.md', destinationDirectory, occurredAt: '2026-09-14T09:00:03.000Z', idempotencyKey: `m5h-egress-${branch.branch}`,
    } });
    let approvedDelivery = null;
    let rejectedError = null;
    try { approvedDelivery = await rerun(approved, deliveredDirectory); } catch (error) { throw new Error(`Approved delivery failed: ${error instanceof Error ? error.message : String(error)}`); }
    try { await rerun(rejected, rejectedDirectory); } catch (error) { rejectedError = error instanceof Error ? error.message : String(error); }
    const definition = await window.hummerOutcomes.define({ token, input: {
      actionPattern: 'external.send', title: '本地成果导出', acceptanceCriteria: '具名审批后成果到达指定目录', riskLevel: 'high', idempotencyKey: 'm5h-egress-outcome-definition',
    } });
    const outcome = await window.hummerOutcomes.record({ token, input: {
      outcomeDefinitionId: definition.id, workOrderId: approved.workOrderId, sessionId: approved.sessionId, approvalId: approved.approvalId,
      verdict: 'accepted', evidenceRef: approvedDelivery.evidenceRef, occurredAt: '2026-09-14T09:00:04.000Z', idempotencyKey: 'm5h-egress-outcome',
    } });
    return {
      approvedDelivery,
      rejectedError,
      deliveries: await window.hummerToolRegistry.listEgressDeliveries({ token, sessionId: approved.sessionId }),
      receipt: await window.hummerOutcomes.exportReceipt({ token, input: { outcomeEventId: outcome.id } }),
      integrity: await window.hummerPersistence.verifyIntegrity(token),
    };
  }, { token, approved: result.approved, rejected: result.rejected, deliveredDirectory, rejectedDirectory });

  if (readFileSync(resolve(deliveredDirectory, 'proposal.md'), 'utf8') !== 'approved local export') throw new Error('Approved egress did not reach the selected directory');
  if (existsSync(resolve(rejectedDirectory, 'proposal.md'))) throw new Error('Rejected egress left a target-side file');
  if (!execution.rejectedError?.includes('approved approval')) throw new Error(`Rejected egress did not fail closed: ${execution.rejectedError}`);
  if (!execution.integrity.valid) throw new Error(`Hash chain failed: ${JSON.stringify(execution.integrity)}`);
  if (!execution.deliveries.some((delivery) => delivery.contentSha256 === execution.approvedDelivery.contentSha256 && delivery.status === 'delivered')) {
    throw new Error('Egress delivery ledger lacks the approved delivery proof');
  }
  writeFileSync(receiptPath, `${execution.receipt}\n`, 'utf8');
  const verification = spawnSync(process.execPath, [resolve(root, 'scripts/verify-receipt.mjs'), receiptPath], { encoding: 'utf8' });
  if (verification.status !== 0) throw new Error(verification.stderr || verification.stdout || 'Independent receipt verification failed');
  const evidence = { generatedAt: new Date().toISOString(), evidenceClass: 'local-product-egress-chain', result, execution, receiptPath, chainIntegrity: execution.integrity };
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ evidencePath, deliveredPath: resolve(deliveredDirectory, 'proposal.md'), rejectedFileExists: existsSync(resolve(rejectedDirectory, 'proposal.md')), chainIntegrity: execution.integrity }, null, 2));
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
  const existing = await page.evaluate(() => localStorage.getItem('hummer.auth.session'));
  if (existing) return existing;
  await page.getByLabel('公司名称').fill('M5-H 出境验收企业');
  await page.getByLabel('你的姓名').fill('出境审批人');
  await page.getByLabel('邮箱或手机').fill('m5h-egress@example.test');
  await page.getByRole('button', { name: '创建并进入' }).click();
  const token = await page.evaluate(() => localStorage.getItem('hummer.auth.session'));
  if (!token) throw new Error('Authentication token was not created');
  return token;
}

async function waitForServer(url) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return; } catch { /* Vite is starting. */ }
    await delay(250);
  }
  throw new Error(`Vite did not become reachable at ${url}`);
}
