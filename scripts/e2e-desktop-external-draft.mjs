import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron as electron } from 'playwright';

const root = process.cwd();
const spikeRoot = resolve(root, 'spikes/m5d-external-draft');
const workspace = resolve(spikeRoot, 'workspace');
const dataDirectory = resolve(spikeRoot, 'facts');
const profileDirectory = resolve(spikeRoot, 'profile');
const evidencePath = resolve(spikeRoot, 'external-draft-evidence.json');
const screenshotPath = resolve(root, 'dist/hummer-m5d-external-draft.png');
const approvedDraft = resolve(workspace, 'drafts/approved-customer-update.md');
const rejectedDraft = resolve(workspace, 'drafts/rejected-customer-update.md');
const baseUrl = 'http://127.0.0.1:4193';

for (const target of [workspace, dataDirectory, profileDirectory]) {
  if (!target.startsWith(spikeRoot)) throw new Error('Refusing to clean outside the M5-D draft spike directory');
  if (existsSync(target)) rmSync(target, { recursive: true, force: true });
}
mkdirSync(workspace, { recursive: true });
if (existsSync(evidencePath)) rmSync(evidencePath);

const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4193', '--strictPort'], {
  cwd: root, stdio: 'pipe', windowsHide: true,
});

let app;
try {
  await waitForServer(baseUrl);
  app = await electron.launch({
    args: [resolve(root, 'apps/desktop/dist/main.js'), '--disable-gpu', `--user-data-dir=${profileDirectory}`],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', HUMMER_RENDERER_URL: baseUrl, HUMMER_DATA_DIR: dataDirectory, HUMMER_CODEX_CWD: workspace },
  });
  const page = await app.firstWindow();
  const token = await ensureIdentity(page);
  const evidence = await page.evaluate(async ({ token }) => {
    if (!window.hummerPersistence || !window.hummerApprovalPolicy || !window.hummerToolRegistry || !window.hummerOutcomes) {
      throw new Error('M5-D desktop bridges are unavailable');
    }
    const plan = { id: 'plan_m5d_external_draft', prompt: 'Create a draft only; never deliver it.' };
    const requestedBy = 'employee:external-draft-writer';
    const runBranch = async (branch, approved) => {
      const sessionId = `session_m5d_draft_${branch}`;
      const approvalId = `approval_m5d_draft_${branch}`;
      const handle = { runtimeId: 'hummer-builtin', sessionId };
      await window.hummerPersistence.saveSession({ token, plan, handle });
      await window.hummerPersistence.appendEvent({ token, plan, handle, event: {
        sessionId, sequence: 1, occurredAt: `2026-09-11T05:10:0${approved ? '2' : '0'}.000Z`, actorRef: requestedBy,
        type: 'approval_required', approvalId, title: 'Confirm external draft creation', message: 'Creates a local draft file only.',
        tool: 'external.send.draft', args: { relativePath: `drafts/${branch}-customer-update.md` }, result: 'pending',
        durationMs: null, costCny: null, evidenceRefs: [],
      } });
      const authorization = await window.hummerApprovalPolicy.authorize({ token, input: {
        sessionId, approvalId, action: 'external.send.draft', requestedBy, estimatedCostCny: null, approved,
        occurredAt: `2026-09-11T05:10:0${approved ? '3' : '1'}.000Z`,
      } });
      let execution = null;
      let error = null;
      try {
        execution = await window.hummerToolRegistry.createExternalSendDraft({ token, input: {
          sessionId, approvalId, requestedBy, relativePath: `drafts/${branch}-customer-update.md`,
          content: `Customer update draft (${branch}). This file has not been delivered.`,
          occurredAt: `2026-09-11T05:10:0${approved ? '4' : '2'}.000Z`, idempotencyKey: `m5d-draft-${branch}`,
        } });
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
      }
      return { branch, sessionId, approvalId, authorization, execution, error };
    };

    const rejected = await runBranch('rejected', false);
    const approved = await runBranch('approved', true);
    if (!approved.execution) throw new Error(`Approved draft did not execute: ${approved.error}`);
    const definition = await window.hummerOutcomes.define({ token, input: {
      actionPattern: 'external.send.draft', title: 'External draft accepted', acceptanceCriteria: 'Approved draft is content-addressed and not delivered',
      riskLevel: 'high', idempotencyKey: 'm5d-draft-outcome-definition',
    } });
    const outcome = await window.hummerOutcomes.record({ token, input: {
      outcomeDefinitionId: definition.id, sessionId: approved.sessionId, approvalId: approved.approvalId,
      verdict: 'accepted', evidenceRef: approved.execution.evidenceRef, occurredAt: '2026-09-11T05:10:05.000Z', idempotencyKey: 'm5d-draft-outcome',
    } });
    const receipt = await window.hummerOutcomes.receipt({ token, input: { outcomeEventId: outcome.id } });
    const integrity = await window.hummerPersistence.verifyIntegrity(token);
    return { generatedAt: new Date().toISOString(), evidenceClass: 'local-product-controlled-builtin', rejected, approved, receipt, integrity };
  }, { token });

  if (existsSync(rejectedDraft)) throw new Error('Rejected draft was written to disk');
  if (!existsSync(approvedDraft)) throw new Error('Approved draft is missing from disk');
  if (!readFileSync(approvedDraft, 'utf8').includes('has not been delivered')) throw new Error('Approved draft lost its no-delivery disclosure');
  if (!evidence.rejected.error?.includes('approved approval')) throw new Error('Rejected draft did not fail at the approval gate');
  if (!evidence.receipt.tools.some((tool) => tool.capabilityId === 'external.send.draft' && tool.status === 'completed')) throw new Error('Receipt lacks completed external.send.draft');
  if (!evidence.integrity.valid) throw new Error(`Hash chain failed: ${JSON.stringify(evidence.integrity)}`);
  writeFileSync(evidencePath, `${JSON.stringify({ ...evidence, approvedDraft, rejectedDraft, noDeliveryPerformed: true }, null, 2)}\n`, 'utf8');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(JSON.stringify({ evidencePath, screenshotPath, approvedDraft, rejectedFileExists: existsSync(rejectedDraft), receiptTools: evidence.receipt.tools, integrity: evidence.integrity }, null, 2));
} finally {
  if (app) {
    const child = app.process();
    await Promise.race([app.close(), delay(5_000)]);
    if (!child.killed) child.kill();
  }
  vite.kill();
}

async function ensureIdentity(page) {
  const gate = page.getByRole('heading', { name: '\u8fdb\u5165 HUMMER' });
  const workbench = page.getByRole('heading', { name: '\u5de5\u4f5c\u53f0' });
  await Promise.race([gate.waitFor({ state: 'visible', timeout: 30_000 }), workbench.waitFor({ state: 'visible', timeout: 30_000 })]);
  if (await gate.isVisible()) {
    await page.getByLabel('\u516c\u53f8\u540d\u79f0').fill('M5-D Draft Test');
    await page.getByLabel('\u4f60\u7684\u59d3\u540d').fill('Draft Approver');
    await page.getByLabel('\u90ae\u7bb1\u6216\u624b\u673a').fill('draft-e2e@example.test');
    await page.getByRole('button', { name: '\u521b\u5efa\u5e76\u8fdb\u5165' }).click();
    await gate.waitFor({ state: 'hidden', timeout: 15_000 });
  }
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
