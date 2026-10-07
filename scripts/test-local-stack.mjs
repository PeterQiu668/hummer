import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repository = resolve(import.meta.dirname, '..');
const cli = resolve(repository, 'scripts', 'hummer-local-stack.mjs');
const scratch = await mkdtemp(join(tmpdir(), 'hummer-local-stack-test-'));
const stateRoot = join(scratch, 'state');
const workspaceRoot = join(scratch, 'workspace');
const configPath = join(scratch, 'local-stack.json');
let assertions = 0;
let child;

try {
  await writeFile(configPath, `${JSON.stringify({
    schema: 'hummer.local-stack-config', version: 1,
    stateRoot, workspaceRoot,
    tenantId: 'tenant-local-test', actorRef: 'account:owner-test', nodeId: 'node-local-test',
    runtime: { provider: 'codex' }, launchDesktop: false,
  }, null, 2)}\n`, 'utf8');

  const first = await start();
  check(first.state.status === 'running', 'local stack did not reach running');
  check(first.events.some((entry) => entry?.source === 'node' && entry?.event === 'daemon.ready'), 'Node daemon readiness was not observed');
  check(/^http:\/\/127\.0\.0\.1:\d+$/u.test(first.state.relayAddress), 'Relay did not bind ephemeral loopback');

  const status = await command('status');
  check(status.status === 'running' && status.sessionId === first.state.sessionId, 'status did not come from the live supervisor');

  const duplicate = await execFileAsync(process.execPath, [cli, 'run', '--config', configPath], { cwd: repository })
    .then(() => ({ code: 0, stderr: '' }), (error) => ({ code: error.code, stderr: String(error.stderr) }));
  check(duplicate.code !== 0 && duplicate.stderr.includes('local_stack_already_running'), 'a second supervisor was not rejected');

  const stopped = await command('stop');
  check(stopped.status === 'stopped' && stopped.changed === true, 'stop was not acknowledged');
  const firstExit = await waitForExit(child, 15_000);
  check(firstExit.code === 0, 'supervisor did not exit cleanly after stop');
  child = undefined;
  check((await command('status')).status === 'stopped', 'status did not report stopped after coordinated shutdown');

  const firstArchive = await archivedRun(first.state.sessionId);
  const archivedStatus = JSON.parse(await readFile(join(firstArchive, 'status.json'), 'utf8'));
  check(archivedStatus.status === 'stopped' && archivedStatus.stopReason === 'control_stop', 'archived status did not preserve the stop receipt');
  await assertNoPlaintextSecrets(stateRoot);

  const second = await start();
  check(second.state.status === 'running' && second.state.sessionId !== first.state.sessionId, 'restart did not create a new session');
  await command('stop');
  const secondExit = await waitForExit(child, 15_000);
  check(secondExit.code === 0, 'restarted supervisor did not stop cleanly');
  child = undefined;
  await assertNoPlaintextSecrets(stateRoot);

  process.stdout.write(`${JSON.stringify({ status: 'passed', assertions, checks: [
    'one command starts real Relay and Node with ephemeral in-memory credentials',
    'live named-pipe status and coordinated stop are available without a network admin port',
    'a second supervisor is rejected and the same durable state can restart',
    'configs state SQLite journal and receipts contain no plaintext generated bearer patterns',
  ] })}\n`);
} finally {
  if (child && child.exitCode === null) child.kill();
  await rm(scratch, { recursive: true, force: true });
}

async function start() {
  child = spawn(process.execPath, [cli, 'run', '--config', configPath], {
    cwd: repository, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    for (const line of stdout.split(/\r?\n/u).filter(Boolean)) {
      let value;
      try { value = JSON.parse(line); } catch { continue; }
      if (value?.schema === 'hummer.local-stack-state' && value?.status === 'running') {
        return {
          state: value,
          events: stdout.split(/\r?\n/u).filter(Boolean).flatMap((candidate) => {
            try { return [JSON.parse(candidate)]; } catch { return []; }
          }),
        };
      }
    }
    if (child.exitCode !== null) throw new Error(`local stack exited before ready: ${stderr}`);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
  throw new Error(`timed out waiting for local stack: ${stderr}`);
}

async function command(name) {
  const result = await execFileAsync(process.execPath, [cli, name, '--config', configPath], { cwd: repository });
  return JSON.parse(result.stdout.trim().split(/\r?\n/u).at(-1));
}

async function archivedRun(sessionId) {
  const root = join(stateRoot, 'runs');
  const match = (await readdir(root)).find((name) => name.startsWith(`${sessionId}-`));
  assert.ok(match, 'archived run was not found');
  return join(root, match);
}

async function assertNoPlaintextSecrets(root) {
  const pattern = /(?:control|node|issuer)_[A-Za-z0-9_-]{40,}/u;
  for (const path of await files(root)) {
    const bytes = await readFile(path);
    check(!pattern.test(bytes.toString('latin1')), `plaintext secret pattern found in ${path}`);
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
  if (process_.exitCode !== null || process_.signalCode !== null) {
    return Promise.resolve({ code: process_.exitCode, signal: process_.signalCode });
  }
  return Promise.race([
    new Promise((resolveExit) => process_.once('exit', (code, signal) => resolveExit({ code, signal }))),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timed out waiting for supervisor exit')), timeoutMs)),
  ]);
}

function check(condition, message) {
  assert.ok(condition, message);
  assertions += 1;
}
