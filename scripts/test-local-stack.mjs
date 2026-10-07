import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repository = resolve(import.meta.dirname, '..');
const cli = resolve(repository, 'scripts', 'hummer-local-stack.mjs');
const scratch = await mkdtemp(join(tmpdir(), 'hummer-local-stack-test-'));
const stateRoot = join(scratch, 'state');
const claimStateRoot = join(scratch, 'claim-state');
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

  const claimToken = `claim_${randomBytes(32).toString('base64url')}`;
  await writeFile(configPath, `${JSON.stringify({
    schema: 'hummer.local-stack-config', version: 2,
    stateRoot: claimStateRoot, workspaceRoot,
    identity: { mode: 'desktop-claim', claimTokenEnv: 'HUMMER_TEST_CLAIM_TOKEN' },
    nodeId: 'node-local-test', runtime: { provider: 'codex' }, launchDesktop: false,
  }, null, 2)}\n`, 'utf8');
  const waiting = await start('waiting_for_identity', { HUMMER_TEST_CLAIM_TOKEN: claimToken });
  check(waiting.state.tenantId === undefined && waiting.state.actorRef === undefined, 'waiting state exposed a guessed identity');
  const unauthorized = await pipeRequest(waiting.state.pipeName, {
    command: 'claim', auth: 'wrong-claim-token-value-that-is-long-enough',
    identity: { tenantId: 'tenant-claimed', actorRef: 'account:owner-claimed' },
  });
  check(unauthorized.error?.code === 'claim_unauthorized', 'bad claim token was not rejected');
  check((await command('status')).status === 'waiting_for_identity', 'unauthorized claim changed supervisor state');
  const claimed = await pipeRequest(waiting.state.pipeName, {
    command: 'claim', auth: claimToken,
    identity: { tenantId: 'tenant-claimed', actorRef: 'account:owner-claimed' },
  });
  check(claimed.schema === 'hummer.local-stack-claim-result', 'authenticated identity claim did not return Relay config');
  check(claimed.identity?.tenantId === 'tenant-claimed' && claimed.identity?.actorRef === 'account:owner-claimed', 'claim response changed the Desktop identity');
  const session = await fetch(`${claimed.relay.baseUrl}v1/control/session`, {
    headers: { authorization: `Bearer ${claimed.relay.badgeToken}` },
  });
  check(session.status === 200, 'claimed control badge did not authenticate to Relay');
  check(JSON.stringify(await session.json()) === JSON.stringify({
    session: { tenantId: 'tenant-claimed', actorRef: 'account:owner-claimed' },
  }), 'Relay session did not match the claimed Desktop identity');
  const claimedStatus = await command('status');
  check(claimedStatus.status === 'running' && claimedStatus.tenantId === 'tenant-claimed', 'claim did not transition the stack to running');
  const conflicting = await pipeRequest(waiting.state.pipeName, {
    command: 'claim', auth: claimToken,
    identity: { tenantId: 'tenant-other', actorRef: 'account:owner-other' },
  });
  check(conflicting.error?.code === 'identity_already_bound', 'a second identity was not rejected');
  await command('stop');
  const claimedExit = await waitForExit(child, 15_000);
  check(claimedExit.code === 0, 'claimed supervisor did not stop cleanly');
  child = undefined;
  await assertNoPlaintextSecrets(claimStateRoot, [claimToken, claimed.relay.badgeToken]);

  process.stdout.write(`${JSON.stringify({ status: 'passed', assertions, checks: [
    'one command starts real Relay and Node with ephemeral in-memory credentials',
    'live named-pipe status and coordinated stop are available without a network admin port',
    'a second supervisor is rejected and the same durable state can restart',
    'authenticated Desktop identity claim starts Relay and rejects bad tokens and conflicting identities',
    'configs state SQLite journal and receipts contain no plaintext generated bearer patterns',
  ] })}\n`);
} finally {
  if (child && child.exitCode === null) child.kill();
  await rm(scratch, { recursive: true, force: true });
}

async function start(expectedStatus = 'running', environment = {}) {
  child = spawn(process.execPath, [cli, 'run', '--config', configPath], {
    cwd: repository, env: { ...process.env, ...environment }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
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
      if (value?.schema === 'hummer.local-stack-state' && value?.status === expectedStatus) {
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

async function assertNoPlaintextSecrets(root, forbidden = []) {
  const pattern = /(?:control|node|issuer|claim)_[A-Za-z0-9_-]{40,}/u;
  for (const path of await files(root)) {
    const bytes = await readFile(path);
    const text = bytes.toString('latin1');
    check(!pattern.test(text), `plaintext secret pattern found in ${path}`);
    for (const secret of forbidden) check(!text.includes(secret), `known plaintext secret found in ${path}`);
  }
}

function pipeRequest(pipeName, request) {
  return new Promise((resolveRequest, reject) => {
    const socket = connect(pipeName);
    let buffer = '';
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('pipe request timed out')); }, 15_000);
    socket.setEncoding('utf8');
    socket.once('connect', () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on('data', (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      clearTimeout(timer);
      socket.end();
      resolveRequest(JSON.parse(buffer.slice(0, newline)));
    });
    socket.once('error', (error) => { clearTimeout(timer); reject(error); });
  });
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
