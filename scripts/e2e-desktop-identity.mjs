import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron as electron } from 'playwright';

const root = process.cwd();
const baseUrl = 'http://127.0.0.1:4180';
const spikeRoot = resolve(root, 'spikes/m4-identity');
const dataDirectory = resolve(spikeRoot, 'facts');
const ownerProfile = resolve(spikeRoot, 'profile-owner');
const memberProfile = resolve(spikeRoot, 'profile-member');
const evidencePath = resolve(spikeRoot, 'two-profile-evidence.json');
const screenshotPath = resolve(root, 'dist/hummer-m4-identity-two-profile.png');

for (const directory of [dataDirectory, ownerProfile, memberProfile]) {
  if (!directory.startsWith(spikeRoot)) throw new Error('Refusing to clean identity data outside the M4 spike directory');
  if (existsSync(directory)) rmSync(directory, { recursive: true, force: true });
}
mkdirSync(spikeRoot, { recursive: true });

const vite = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4180', '--strictPort'],
  { cwd: root, stdio: 'pipe', windowsHide: true },
);

let ownerApp;
let memberApp;
try {
  await waitForServer(baseUrl);

  ownerApp = await launchDesktop(ownerProfile);
  let ownerPage = await ownerApp.firstWindow();
  await createCompany(ownerPage);
  await openTeam(ownerPage);
  await ownerPage.getByRole('button', { name: '邀请真人同事' }).click();
  await ownerPage.getByLabel('同事邮箱或手机号').fill('member-two-profile@example.test');
  await ownerPage.getByLabel('成员角色').selectOption('member');
  await ownerPage.getByRole('button', { name: '创建邀请' }).click();
  await ownerPage.getByText('邀请已创建', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
  const invitationToken = await ownerPage.locator('textarea[readonly]').inputValue();
  if (!invitationToken) throw new Error('Invitation token was not rendered');
  await ownerPage.getByRole('button', { name: '关闭邀请窗口' }).click();

  memberApp = await launchDesktop(memberProfile);
  const memberPage = await memberApp.firstWindow();
  await acceptInvitation(memberPage, invitationToken);
  await openTeam(memberPage);

  const memberContext = await readIdentity(memberPage);
  const memberRows = await listMembers(memberPage);
  if (memberRows.length !== 2) throw new Error(`Invited member sees ${memberRows.length} members instead of 2`);

  await ownerPage.getByRole('button', { name: '工作台' }).click();
  await waitForWorkbench(ownerPage);
  await openTeam(ownerPage);
  await ownerPage.getByText('2 人', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
  const ownerContext = await readIdentity(ownerPage);
  const ownerRows = await listMembers(ownerPage);
  assertMembershipFacts(ownerContext, memberContext, ownerRows);

  await ownerPage.screenshot({ path: screenshotPath, fullPage: true });
  await closeDesktop(ownerApp);
  ownerApp = undefined;

  ownerApp = await launchDesktop(ownerProfile);
  ownerPage = await ownerApp.firstWindow();
  await waitForIdentityReady(ownerPage);
  await openTeam(ownerPage);
  const afterRestartRows = await listMembers(ownerPage);
  assertMembershipFacts(ownerContext, memberContext, afterRestartRows);

  const evidence = {
    generatedAt: new Date().toISOString(),
    dataDirectory,
    ownerProfile,
    memberProfile,
    tenantId: ownerContext.tenant.id,
    ownerAccountId: ownerContext.account.id,
    memberAccountId: memberContext.account.id,
    memberRows: afterRestartRows,
    uniqueActiveTwinCount: new Set(afterRestartRows.map((member) => member.twinId)).size,
    restartRetained: true,
    screenshotPath,
  };
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  if (memberApp) await closeDesktop(memberApp);
  if (ownerApp) await closeDesktop(ownerApp);
  vite.kill();
}

function launchDesktop(profileDirectory) {
  return electron.launch({
    args: [
      resolve(root, 'apps/desktop/dist/main.js'),
      '--disable-gpu',
      `--user-data-dir=${profileDirectory}`,
    ],
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      HUMMER_RENDERER_URL: baseUrl,
      HUMMER_CODEX_CWD: spikeRoot,
      HUMMER_DATA_DIR: dataDirectory,
    },
  });
}

async function createCompany(page) {
  const gate = page.getByRole('heading', { name: '进入 HUMMER' });
  await gate.waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByLabel('公司名称').fill('HUMMER 双身份验收企业');
  await page.getByLabel('你的姓名').fill('企业所有者');
  await page.getByLabel('邮箱或手机').fill('owner-two-profile@example.test');
  await page.getByRole('button', { name: '创建并进入' }).click();
  await gate.waitFor({ state: 'hidden', timeout: 15_000 });
  await waitForWorkbench(page);
}

async function acceptInvitation(page, invitationToken) {
  const gate = page.getByRole('heading', { name: '进入 HUMMER' });
  await gate.waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByRole('button', { name: '接受邀请' }).click();
  await page.getByLabel('邀请凭证').fill(invitationToken);
  await page.getByLabel('你的姓名').fill('受邀同事');
  await page.getByLabel('邮箱或手机').fill('member-two-profile@example.test');
  await page.getByRole('button', { name: '接受邀请并进入' }).click();
  await gate.waitFor({ state: 'hidden', timeout: 15_000 });
  await waitForWorkbench(page);
}

async function waitForWorkbench(page) {
  await page.getByRole('heading', { name: '工作台' }).waitFor({ state: 'visible', timeout: 30_000 });
}

async function waitForIdentityReady(page) {
  await page.waitForFunction(() => {
    const headings = [...document.querySelectorAll('h1, h2')].map((node) => node.textContent?.trim());
    return headings.includes('工作台') || headings.includes('团队协作');
  }, undefined, { timeout: 30_000 });
}
async function openTeam(page) {
  await page.getByRole('button', { name: /团队协作/ }).click();
  await page.getByRole('heading', { name: '团队协作' }).waitFor({ state: 'visible', timeout: 10_000 });
}

async function readIdentity(page) {
  return page.evaluate(async () => {
    const token = localStorage.getItem('hummer.auth.session');
    if (!token || !window.hummerIdentity) throw new Error('Desktop identity bridge or session is missing');
    return window.hummerIdentity.resumeSession(token);
  });
}

async function listMembers(page) {
  return page.evaluate(async () => {
    const token = localStorage.getItem('hummer.auth.session');
    if (!token || !window.hummerIdentity) throw new Error('Desktop identity bridge or session is missing');
    return window.hummerIdentity.listMembers(token);
  });
}

function assertMembershipFacts(ownerContext, memberContext, members) {
  if (ownerContext.tenant.id !== memberContext.tenant.id) throw new Error('Invitation accepted into the wrong tenant');
  if (ownerContext.account.id === memberContext.account.id) throw new Error('Two browser profiles resolved to the same account');
  if (members.length !== 2) throw new Error(`Expected 2 persisted members, received ${members.length}`);
  if (new Set(members.map((member) => member.accountId)).size !== 2) throw new Error('Member account ids are not unique');
  if (new Set(members.map((member) => member.humanUserId)).size !== 2) throw new Error('Human user ids are not unique');
  if (new Set(members.map((member) => member.twinId)).size !== 2) throw new Error('Each human must have exactly one distinct active twin');
}

async function closeDesktop(desktop) {
  const process = desktop.process();
  await Promise.race([desktop.close(), delay(5_000)]);
  if (!process.killed) process.kill();
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
