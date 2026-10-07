import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { _electron as electron } from 'playwright';

const execFileAsync = promisify(execFile);
const repository = resolve(import.meta.dirname, '..');
const cli = resolve(repository, 'scripts', 'hummer-local-stack.mjs');
const scratch = await mkdtemp(join(tmpdir(), 'hummer-local-first-run-'));
const stateRoot = join(scratch, 'state');
const workspaceRoot = join(scratch, 'workspace');
const dataRoot = join(scratch, 'facts');
const profileRoot = join(scratch, 'profile');
const configPath = join(scratch, 'local-stack.json');
const codexProbe = join(scratch, 'codex-0.153.4.cmd');
const claimToken = `claim_${randomBytes(32).toString('base64url')}`;
let supervisor;
let desktop;
let assertions = 0;

try {
  await writeFile(configPath, `${JSON.stringify({
    schema: 'hummer.local-stack-config', version: 2,
    stateRoot, workspaceRoot,
    identity: { mode: 'desktop-claim', claimTokenEnv: 'HUMMER_E2E_CLAIM_TOKEN' },
    nodeId: 'node-first-run', runtime: { provider: 'codex' }, launchDesktop: false,
  }, null, 2)}\n`, 'utf8');
  await writeFile(codexProbe, '@echo off\r\necho codex-cli 0.153.4\r\n', 'utf8');

  supervisor = spawn(process.execPath, [cli, 'run', '--config', configPath], {
    cwd: repository,
    env: { ...process.env, HUMMER_E2E_CLAIM_TOKEN: claimToken },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const waiting = await waitForSupervisorState(supervisor, 'waiting_for_identity');
  check(waiting.tenantId === undefined && waiting.actorRef === undefined, 'supervisor guessed an identity before Desktop login');

  desktop = await electron.launch({
    args: [resolve(repository, 'apps/desktop/dist/main.js'), '--disable-gpu', `--user-data-dir=${profileRoot}`],
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      HUMMER_DATA_DIR: dataRoot,
      HUMMER_CODEX_CWD: workspaceRoot,
      HUMMER_CODEX_PATH: codexProbe,
      HUMMER_EXEC_WORKSPACE_ROOT: workspaceRoot,
      HUMMER_LOCAL_STACK_CLAIM_PIPE: waiting.pipeName,
      HUMMER_LOCAL_STACK_CLAIM_TOKEN: claimToken,
    },
  });
  const page = await desktop.firstWindow();
  const gate = page.getByRole('heading', { name: '进入 HUMMER' });
  await gate.waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByLabel('公司名称').fill('HUMMER 首次启动验收企业');
  await page.getByLabel('你的姓名').fill('首次启动所有者');
  await page.getByLabel('邮箱或手机').fill('first-run@example.test');
  await page.getByRole('button', { name: '创建并进入' }).click();
  await gate.waitFor({ state: 'hidden', timeout: 30_000 });
  try {
    await page.getByRole('heading', { name: '工作台' }).waitFor({ state: 'visible', timeout: 30_000 });
  } catch (error) {
    const diagnostic = {
      event: 'e2e.first_run_workbench_timeout',
      url: page.url(),
      text: (await page.locator('body').innerText().catch(() => '')).slice(0, 2000),
      stack: await stackCommand('status').catch(() => ({ status: 'unavailable' })),
    };
    process.stderr.write(`${JSON.stringify(diagnostic)}\n`);
    throw error;
  }

  const result = await page.evaluate(async () => {
    const token = localStorage.getItem('hummer.auth.session');
    if (!token || !window.hummerIdentity || !window.hummerDesktopRelay) throw new Error('trusted Desktop bridges are unavailable');
    const identity = await window.hummerIdentity.resumeSession(token);
    const relayStatus = await window.hummerDesktopRelay.status();
    const nodes = await window.hummerDesktopRelay.listNodes(token);
    return { identity, relayStatus, nodes, storage: { ...localStorage } };
  });
  check(result.relayStatus.configured === true, 'Desktop Relay bridge was not configured after identity creation');
  check(result.nodes.some((node) => node.nodeId === 'node-first-run' && node.status === 'online'), 'claimed Node did not appear online in Desktop');
  check(!JSON.stringify(result.storage).includes(claimToken), 'claim token leaked into renderer storage');

  const live = await stackCommand('status');
  check(live.status === 'running', 'supervisor did not transition to running');
  check(live.tenantId === result.identity.tenant.id, 'supervisor tenant differs from Desktop identity');
  check(live.actorRef === `account:${result.identity.account.id}`, 'supervisor actor differs from Desktop identity');
  check(live.relayAddress?.startsWith('http://127.0.0.1:'), 'first-run Relay was not loopback-only');

  await desktop.close();
  desktop = undefined;
  const stopped = await stackCommand('stop');
  check(stopped.status === 'stopped' && stopped.changed === true, 'first-run supervisor did not stop');
  const supervisorExit = await waitForExit(supervisor, 15_000);
  check(supervisorExit.code === 0, 'first-run supervisor did not exit cleanly');
  supervisor = undefined;
  await assertSecretAbsent(scratch, claimToken);

  process.stdout.write(`${JSON.stringify({
    status: 'passed', assertions,
    tenantRef: hashRef(result.identity.tenant.id), actorRef: hashRef(result.identity.account.id),
    checks: [
      'fresh Desktop created its own tenant and account without prefilled identifiers',
      'Desktop main claimed the local stack through an authenticated named pipe',
      'Relay and Node started only after the verified identity claim',
      'Desktop listed the claimed Node through its trusted Relay bridge',
      'claim token was absent from renderer storage and all persisted test bytes',
    ],
  })}\n`);
} finally {
  if (desktop) await closeDesktop(desktop);
  if (supervisor && supervisor.exitCode === null) {
    await stackCommand('stop').catch(() => undefined);
    await waitForExit(supervisor, 10_000).catch(() => { supervisor.kill(); });
  }
  await removeTemporaryTree(scratch);
}

async function waitForSupervisorState(child, expected) {
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    for (const line of stdout.split(/\r?\n/u).filter(Boolean)) {
      try {
        const value = JSON.parse(line);
        if (value?.schema === 'hummer.local-stack-state' && value?.status === expected) return value;
      } catch {
        // Wait for a complete JSON line.
      }
    }
    if (child.exitCode !== null) throw new Error(`supervisor exited before ${expected}: ${stderr}`);
    await delay(50);
  }
  throw new Error(`timed out waiting for supervisor ${expected}: ${stderr}`);
}

async function stackCommand(command) {
  const result = await execFileAsync(process.execPath, [cli, command, '--config', configPath], { cwd: repository });
  return JSON.parse(result.stdout.trim().split(/\r?\n/u).at(-1));
}

async function assertSecretAbsent(root, secret) {
  for (const path of await files(root)) {
    const value = await readFile(path);
    check(!value.toString('latin1').includes(secret), `claim token persisted in ${path}`);
  }
}

async function files(root) {
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) result.push(...await files(path));
    else result.push(path);
  }
  return result;
}

function waitForExit(process_, timeoutMs) {
  if (process_.exitCode !== null || process_.signalCode !== null) return Promise.resolve({ code: process_.exitCode, signal: process_.signalCode });
  return Promise.race([
    new Promise((resolveExit) => process_.once('exit', (code, signal) => resolveExit({ code, signal }))),
    delay(timeoutMs).then(() => { throw new Error('timed out waiting for supervisor exit'); }),
  ]);
}

async function closeDesktop(app) {
  const process_ = app.process();
  await Promise.race([app.close().catch(() => undefined), delay(5_000)]);
  if (!process_.killed && process_.exitCode === null) process_.kill();
}

async function removeTemporaryTree(root) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await rm(root, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(error?.code) || attempt === 19) {
        process.stderr.write(`${JSON.stringify({ event: 'e2e.temp_cleanup_deferred', code: error?.code ?? 'unknown' })}\n`);
        return;
      }
      await delay(250);
    }
  }
}

function hashRef(value) {
  let hash = 2166136261;
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function check(condition, message) {
  assert.ok(condition, message);
  assertions += 1;
}
