import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildDeterministicApprovalRequest,
  consumeDaemonCredentials,
  validateNodeDaemonConfig,
} from '../src/daemon.mjs';
import { createSharedFleetContractValidator } from '../src/contract-validator.mjs';
import { portableOutcomeReceiptValidator } from '../src/outcome-receipt-validator.mjs';

function config(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'hummer-node-daemon-'));
  return {
    schema: 'hummer.node-agent-config',
    version: 3,
    nodeId: 'node-test-1',
    tenantId: 'tenant-test',
    relayBaseUrl: 'http://127.0.0.1:43210/',
    badgeTokenEnv: 'HUMMER_TEST_BADGE',
    grantTokenEnv: 'HUMMER_TEST_GRANT',
    grantExpiresAt: '2099-01-01T00:00:00.000Z',
    grantScopes: ['node.heartbeat', 'task.claim', 'approval.request', 'task.execute'],
    journalPath: join(root, 'execution.jsonl'),
    receiptRoot: join(root, 'receipts'),
    workspaceRoot: join(root, 'workspace'),
    heartbeatIntervalMs: 15_000,
    pollIntervalMs: 100,
    approvalTtlMs: 60_000,
    runtime: { provider: 'codex' },
    capabilities: ['fs.read'],
    mcp: { endpoint: 'stdio://hummer-local', tools: [] },
    approval: { riskClass: 'unknown' },
    ...overrides,
  };
}

function envelope(overrides = {}) {
  return {
    schema: 'hummer.task-envelope',
    version: 1,
    workOrderTask: {
      schema: 'hummer.work-order-task', version: 1,
      title: 'Safe test task', target: 'test', expectedDeliverable: 'outputs/result.txt',
    },
    tenantId: 'tenant-test',
    targetNodeId: 'node-test-1',
    targetRuntime: 'codex',
    idempotencyKey: 'delivery-test-001',
    leaseMs: 30_000,
    approvalPolicyRef: 'human-required',
    expiresAt: '2099-01-01T00:00:00.000Z',
    originRef: 'work-test-1',
    ...overrides,
  };
}

test('daemon config is versioned, exact, absolute, and rejects non-loopback HTTP', () => {
  const parsed = validateNodeDaemonConfig(config());
  assert.equal(parsed.schema, 'hummer.node-agent-config');
  assert.throws(() => validateNodeDaemonConfig({ ...config(), surprise: true }), { code: 'invalid_daemon_config' });
  assert.throws(() => validateNodeDaemonConfig(config({ version: 1 })), { code: 'unsupported_daemon_config' });
  assert.throws(() => validateNodeDaemonConfig(config({ journalPath: 'relative.jsonl' })), { code: 'invalid_daemon_config' });
  assert.throws(() => validateNodeDaemonConfig(config({ receiptRoot: 'relative-receipts' })), { code: 'invalid_daemon_config' });
  assert.throws(() => validateNodeDaemonConfig(config({ workspaceRoot: 'relative-workspace' })), { code: 'invalid_daemon_config' });
  assert.throws(() => validateNodeDaemonConfig(config({ capabilities: ['workspace.exec'] })), { code: 'invalid_daemon_config' });
  const overlap = config();
  assert.throws(() => validateNodeDaemonConfig({ ...overlap, receiptRoot: join(overlap.workspaceRoot, 'receipts') }), { code: 'invalid_daemon_config' });
  assert.throws(
    () => validateNodeDaemonConfig(config({ relayBaseUrl: 'http://192.0.2.10:8787/' })),
    { code: 'invalid_daemon_config' },
  );
});

test('credential env values are consumed and immediately deleted', () => {
  const parsed = validateNodeDaemonConfig(config());
  const environment = { HUMMER_TEST_BADGE: 'badge-secret-value', HUMMER_TEST_GRANT: 'grant-secret-value' };
  assert.deepEqual(consumeDaemonCredentials(parsed, environment), {
    badgeToken: 'badge-secret-value',
    grantToken: 'grant-secret-value',
  });
  assert.equal(environment.HUMMER_TEST_BADGE, undefined);
  assert.equal(environment.HUMMER_TEST_GRANT, undefined);
  assert.throws(() => consumeDaemonCredentials(parsed, {}), { code: 'daemon_credential_missing' });
});

test('approval request is deterministic, scoped, redacted, and human-gated', () => {
  const parsed = validateNodeDaemonConfig(config());
  const input = { claimId: 'delivery-test-001', envelope: envelope(), config: parsed, now: new Date('2026-10-07T00:00:00.000Z') };
  const first = buildDeterministicApprovalRequest(input);
  const second = buildDeterministicApprovalRequest(input);
  assert.deepEqual(first, second);
  assert.equal(first.target, 'delivery-test-001');
  assert.equal(first.tenantId, 'tenant-test');
  assert.deepEqual(first.requestedScope, { capabilities: ['task.execute'], maxUses: 1 });
  assert.equal(JSON.stringify(first).includes('Safe test task'), false);
  assert.throws(
    () => buildDeterministicApprovalRequest({ ...input, envelope: envelope({ tenantId: 'tenant-other' }) }),
    { code: 'task_scope_mismatch' },
  );
});

test('read attestation approval binds one explicit path and never includes task prose', () => {
  const parsed = validateNodeDaemonConfig(config());
  const request = buildDeterministicApprovalRequest({
    claimId: 'delivery-test-001', config: parsed, now: new Date('2026-10-07T00:00:00.000Z'),
    envelope: envelope({
      grantRef: 'grant:read-1',
      executionPlan: { kind: 'fs.read.attest.v1', path: 'reports/approved.txt', maxBytes: 4096 },
      workOrderTask: {
        schema: 'hummer.work-order-task', version: 1, title: 'CANARY-CONTENT',
        target: 'CANARY-CONTENT', expectedDeliverable: 'CANARY-CONTENT',
      },
    }),
  });
  assert.equal(request.action, 'fs.read.attest.v1');
  assert.equal(request.target, 'delivery-test-001');
  assert.deepEqual(request.requestedScope, {
    capabilities: ['task.execute', 'fs.read'], paths: ['reports/approved.txt'], maxUses: 1,
  });
  assert.deepEqual(createSharedFleetContractValidator(portableOutcomeReceiptValidator).validateApprovalRequest(request), {
    ok: true, value: request,
  });
  assert.equal(JSON.stringify(request).includes('CANARY-CONTENT'), false);
});

test('real CLI subprocess fails closed for missing env, non-loopback HTTP, and unknown config fields', async () => {
  const root = mkdtempSync(join(tmpdir(), 'hummer-node-cli-fail-'));
  const missingEnvPath = join(root, 'missing-env.json');
  writeFileSync(missingEnvPath, JSON.stringify(config({ journalPath: join(root, 'missing-env.jsonl') })), 'utf8');
  const missingEnv = await runCli(missingEnvPath, {});
  assert.equal(missingEnv.code, 1);
  assert.match(missingEnv.stderr, /daemon_credential_missing/u);

  const unsafeUrlPath = join(root, 'unsafe-url.json');
  writeFileSync(unsafeUrlPath, JSON.stringify(config({
    journalPath: join(root, 'unsafe-url.jsonl'),
    relayBaseUrl: 'http://192.0.2.10:8787/',
  })), 'utf8');
  const unsafeUrl = await runCli(unsafeUrlPath, { HUMMER_TEST_BADGE: 'badge-unsafe-secret', HUMMER_TEST_GRANT: 'grant-unsafe-secret' });
  assert.equal(unsafeUrl.code, 1);
  assert.match(unsafeUrl.stderr, /Plain HTTP Relay endpoints are allowed only on loopback/u);
  assert.equal(unsafeUrl.stdout.includes('badge-unsafe-secret') || unsafeUrl.stderr.includes('badge-unsafe-secret'), false);
  assert.equal(unsafeUrl.stdout.includes('grant-unsafe-secret') || unsafeUrl.stderr.includes('grant-unsafe-secret'), false);

  const unknownPath = join(root, 'unknown.json');
  writeFileSync(unknownPath, JSON.stringify({ ...config({ journalPath: join(root, 'unknown.jsonl') }), unknown: true }), 'utf8');
  const unknown = await runCli(unknownPath, { HUMMER_TEST_BADGE: 'badge-unknown-secret', HUMMER_TEST_GRANT: 'grant-unknown-secret' });
  assert.equal(unknown.code, 1);
  assert.match(unknown.stderr, /invalid_daemon_config/u);
  assert.equal(unknown.stdout.includes('badge-unknown-secret') || unknown.stderr.includes('badge-unknown-secret'), false);
  assert.equal(unknown.stdout.includes('grant-unknown-secret') || unknown.stderr.includes('grant-unknown-secret'), false);
});

test('real CLI subprocess registers, heartbeats, opens SSE/poll, hides tokens, and accepts shutdown', { timeout: 45_000 }, async () => {
  const badge = 'badge-never-print-4c177d';
  const grant = 'grant-never-print-9017ac';
  const requests = [];
  const streams = new Set();
  let taskClaimed = false;
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    requests.push({ method: request.method, url: request.url, authorization: request.headers.authorization, body });
    if (request.url?.endsWith('/events')) {
      response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive', 'cache-control': 'no-cache' });
      response.write('event: connected\ndata: {}\n\n');
      streams.add(response);
      response.once('close', () => streams.delete(response));
      return;
    }
    if (request.url?.endsWith('/tasks/claim')) {
      if (!taskClaimed) {
        taskClaimed = true;
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
          task: { taskId: 'delivery-test-001', envelope: envelope() },
        }));
        return;
      }
      response.writeHead(204).end();
      return;
    }
    if (request.url?.endsWith('/approval-requests') && request.method === 'POST') {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ request: { request: JSON.parse(body) } }));
      return;
    }
    if (request.url?.endsWith('/consume') && request.method === 'POST') {
      response.writeHead(409, { 'content-type': 'application/json' }).end(JSON.stringify({
        error: { code: 'approval_pending', message: 'Approval is still pending' },
      }));
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ node: { ok: true } }));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.equal(typeof address, 'object');
  const root = mkdtempSync(join(tmpdir(), 'hummer-node-cli-'));
  mkdirSync(join(root, 'workspace'));
  const configPath = join(root, 'node.json');
  writeFileSync(configPath, JSON.stringify(config({
    relayBaseUrl: `http://127.0.0.1:${address.port}/`,
    journalPath: join(root, 'execution.jsonl'),
    receiptRoot: join(root, 'receipts'),
    workspaceRoot: join(root, 'workspace'),
  })), 'utf8');

  const child = spawn(process.execPath, [join(import.meta.dirname, '..', 'bin', 'hummer-node.mjs'), 'run', '--config', configPath], {
    cwd: join(import.meta.dirname, '..'),
    env: { ...process.env, HUMMER_TEST_BADGE: badge, HUMMER_TEST_GRANT: grant },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  try {
    await waitUntil(() => stdout.includes('"event":"daemon.ready"'), 35_000);
    assert.equal(existsSync(join(root, 'receipts', '.hummer-node-receipt-root.json')), true);
    assert.ok(requests.some((item) => item.url === '/v1/nodes/register'));
    assert.ok(requests.some((item) => item.url === '/v1/nodes/node-test-1/heartbeat'));
    assert.ok(requests.some((item) => item.url === '/v1/nodes/node-test-1/events'));
    assert.ok(requests.some((item) => item.url === '/v1/nodes/node-test-1/tasks/claim'));
    const approvalCall = requests.find((item) => item.url === '/v1/nodes/node-test-1/tasks/delivery-test-001/approval-requests');
    assert.ok(approvalCall);
    const approval = JSON.parse(approvalCall.body);
    assert.equal(approval.schema, 'hummer.approval-request');
    assert.equal(approval.target, 'delivery-test-001');
    assert.deepEqual(approval.requestedScope, { capabilities: ['task.execute'], maxUses: 1 });
    assert.equal(approval.redactedPreview.includes('Safe test task'), false);
    assert.ok(requests.every((item) => item.authorization === `Bearer ${badge}`));
    assert.equal(stdout.includes(badge) || stdout.includes(grant), false);
    assert.equal(stderr.includes(badge) || stderr.includes(grant), false);
    child.kill('SIGTERM');
    const exit = await new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
    if (process.platform !== 'win32') {
      assert.deepEqual(exit, { code: 0, signal: null });
      assert.match(stdout, /"event":"daemon\.stopped"/u);
    } else {
      assert.ok(exit.code === 0 || exit.signal === 'SIGTERM');
    }
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    for (const stream of streams) stream.end();
    await new Promise((resolve) => server.close(resolve));
  }
});

/** @param {() => boolean} predicate @param {number} timeoutMs */
async function waitUntil(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for CLI subprocess');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** @param {string} configPath @param {NodeJS.ProcessEnv} environment */
async function runCli(configPath, environment) {
  const childEnvironment = { ...process.env, ...environment };
  if (!Object.hasOwn(environment, 'HUMMER_TEST_BADGE')) delete childEnvironment.HUMMER_TEST_BADGE;
  if (!Object.hasOwn(environment, 'HUMMER_TEST_GRANT')) delete childEnvironment.HUMMER_TEST_GRANT;
  const child = spawn(process.execPath, [join(import.meta.dirname, '..', 'bin', 'hummer-node.mjs'), 'run', '--config', configPath], {
    cwd: join(import.meta.dirname, '..'),
    env: childEnvironment,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const code = await new Promise((resolve) => child.once('exit', resolve));
  return { code, stdout, stderr };
}
