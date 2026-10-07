import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const repository = process.cwd();
const tenantId = 'tenant-daemon-gate';
const nodeId = 'node-daemon-gate';
const taskId = 'daemon-gate-task-001';
const controlToken = `control_${randomBytes(32).toString('base64url')}`;
const nodeToken = `node_${randomBytes(32).toString('base64url')}`;
const grantToken = `grant_${randomBytes(32).toString('base64url')}`;
const secretValues = [controlToken, nodeToken, grantToken];
const scratch = mkdtempSync(join(tmpdir(), 'hummer-daemon-gate-'));
const databasePath = join(scratch, 'fleet.sqlite');
const taskGrantDatabasePath = join(scratch, 'task-grants.sqlite');
const journalPath = join(scratch, 'execution.jsonl');
const receiptRoot = join(scratch, 'receipts');
const workspaceRoot = join(scratch, 'workspace');
const relayConfigPath = join(scratch, 'relay.json');
const nodeConfigPath = join(scratch, 'node.json');
const evidenceRound = option('--evidence-round');
const evidenceDir = evidenceRound ? resolve(repository, 'evidence', evidenceRound) : null;
let assertions = 0;
let relay;
let node;

if (evidenceDir) {
  if (existsSync(evidenceDir)) throw new Error(`evidence round already exists: ${evidenceRound}`);
  mkdirSync(evidenceDir, { recursive: true });
}

const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
mkdirSync(workspaceRoot);
writeJson(relayConfigPath, {
  schema: 'hummer.relay-config',
  version: 2,
  host: '127.0.0.1',
  port: 0,
  databasePath,
  taskGrantDatabasePath,
  badges: [
    {
      tokenEnv: 'HUMMER_GATE_CONTROL_BADGE',
      tokenId: 'control-daemon-gate',
      tenantId,
      actorRef: 'human:operator',
      scopes: ['node.read', 'task.read', 'task.enqueue', 'approval.read', 'approval.decide'],
      expiresAt,
    },
    {
      tokenEnv: 'HUMMER_GATE_NODE_BADGE',
      tokenId: 'node-daemon-gate',
      tenantId,
      actorRef: `system:${nodeId}`,
      nodeId,
      scopes: ['node.register', 'node.heartbeat', 'task.claim', 'task.event', 'stream.connect', 'approval.request', 'approval.consume'],
      expiresAt,
    },
  ],
});

try {
  relay = startChild(
    [resolve(repository, 'apps/relay/bin/hummer-relay.mjs'), 'start', '--config', relayConfigPath],
    { HUMMER_GATE_CONTROL_BADGE: controlToken, HUMMER_GATE_NODE_BADGE: nodeToken },
  );
  const ready = await waitForJson(relay, (entry) => entry?.schema === 'hummer.relay-ready', 30_000);
  check(typeof ready.address === 'string' && /^http:\/\/127\.0\.0\.1:\d+$/u.test(ready.address), 'Relay did not bind an ephemeral loopback address');

  writeJson(nodeConfigPath, {
    schema: 'hummer.node-agent-config',
    version: 3,
    nodeId,
    tenantId,
    relayBaseUrl: `${ready.address}/`,
    badgeTokenEnv: 'HUMMER_GATE_NODE_BADGE',
    grantTokenEnv: 'HUMMER_GATE_GRANT_TOKEN',
    grantExpiresAt: expiresAt,
    grantScopes: ['node.heartbeat', 'task.claim', 'approval.request', 'task.execute'],
    journalPath,
    receiptRoot,
    workspaceRoot,
    heartbeatIntervalMs: 15_000,
    pollIntervalMs: 100,
    approvalTtlMs: 300_000,
    runtime: { provider: 'codex' },
    capabilities: ['fs.read'],
    mcp: { endpoint: 'stdio://hummer-local', tools: ['fs_read'] },
    approval: { riskClass: 'write' },
  });
  node = startChild(
    [resolve(repository, 'apps/node-agent/bin/hummer-node.mjs'), 'run', '--config', nodeConfigPath],
    { HUMMER_GATE_NODE_BADGE: nodeToken, HUMMER_GATE_GRANT_TOKEN: grantToken },
  );
  const nodeReady = await waitForJson(node, (entry) => entry?.event === 'daemon.ready', 45_000);
  check(nodeReady.executionMode === 'fs.read.attest.v1', 'Node daemon must advertise only the read attestation executor');

  const nodes = await controlRequest(ready.address, '/v1/control/nodes');
  check(nodes.nodes?.some((entry) => entry.nodeId === nodeId), 'Node daemon was not registered in Relay SQLite state');
  const registered = nodes.nodes.find((entry) => entry.nodeId === nodeId);
  check(registered?.manifest?.capabilities?.join(',') === 'fs.read', 'Node manifest exposed a capability beyond fs.read');
  check(registered?.manifest?.mcp?.tools?.join(',') === 'fs_read', 'Node manifest did not expose exactly the read-only MCP inventory name');

  const enqueued = await controlRequest(ready.address, '/v1/tasks/enqueue', {
    schema: 'hummer.task-envelope',
    version: 1,
    workOrderTask: {
      schema: 'hummer.work-order-task',
      version: 1,
      title: 'Daemon integration gate',
      target: 'Prove real Relay and Node daemon handoff',
      expectedDeliverable: 'outputs/daemon-gate.md',
    },
    tenantId,
    targetNodeId: nodeId,
    targetRuntime: 'codex',
    idempotencyKey: taskId,
    leaseMs: 30_000,
    approvalPolicyRef: 'policy-human-confirmation',
    expiresAt,
    originRef: 'work-daemon-gate-001',
  });
  check(enqueued.inserted === true && enqueued.task?.taskId === taskId, 'Relay did not persist the formal TaskEnvelope');

  const approval = await waitForApproval(ready.address, 20_000);
  check(approval.taskId === taskId && approval.nodeId === nodeId, 'ApprovalRequest lost its task or node binding');
  check(approval.decision === undefined || approval.decision === null, 'Task advanced without a human approval decision');
  check(!JSON.stringify(approval).includes('Prove real Relay and Node daemon handoff'), 'ApprovalRequest leaked the unredacted task target');

  const taskView = await controlRequest(ready.address, `/v1/control/tasks/${taskId}`);
  check(taskView.task?.status === 'leased', `Expected approval-gated leased task, got ${taskView.task?.status ?? 'missing'}`);
  const journal = readFileSync(journalPath, 'utf8');
  check(journal.includes('"type":"approval_request_recorded"'), 'Node journal does not prove the approval-requested state');
  check(!journal.includes('"type":"executing"') && !journal.includes('"type":"completed"'), 'Unavailable executor must not enter executing or completed state');

  const publicSurface = [
    relay.stdout, relay.stderr, node.stdout, node.stderr,
    readFileSync(relayConfigPath, 'utf8'), readFileSync(nodeConfigPath, 'utf8'), journal,
    readFileSync(databasePath),
  ];
  for (const secret of secretValues) {
    check(!publicSurface.some((value) => Buffer.isBuffer(value) ? value.includes(Buffer.from(secret)) : value.includes(secret)), 'A bearer secret leaked into config, logs, SQLite, or journal');
  }

  const gate = {
    schema: 'hummer.executable-gate-result',
    version: 1,
    gate: 'relay-node-daemon-integration',
    mode: 'two-real-loopback-child-processes-sqlite',
    status: 'passed',
    capturedAt: new Date().toISOString(),
    toolchain: { node: process.version, platform: process.platform, arch: process.arch },
    assertions,
    checks: [{
      id: 'relay-node-pending-approval',
      status: 'passed',
      evidence: [
        'real hummer-relay child process listened on an ephemeral loopback port with SQLiteFleetStore',
        'real hummer-node child process registered, heartbeated, received the formal TaskEnvelope, and submitted a bound redacted ApprovalRequest',
        'task remained leased and the node journal ended at approval_request_recorded with zero executing/completed records',
        'bearer values were absent from configs, stdout, stderr, SQLite, journal, and this gate',
      ],
    }],
    limitations: [
      'Both child processes ran on one Windows machine over loopback; this is not two-device or external-network evidence.',
      'This gate proves safe handoff and approval blocking only; read-attestation execution is covered by a separate real HTTP and SQLite integration test.',
      'Static high-entropy badges are bootstrap credentials, not production IdP issuance or revocation.',
      'Windows child termination does not prove JavaScript signal handlers ran; package-level tests separately verify SQLite remains readable.',
    ],
  };
  check(!secretValues.some((secret) => JSON.stringify(gate).includes(secret)), 'Gate output leaked a bearer secret');
  gate.assertions = assertions;
  if (evidenceDir) writeJson(join(evidenceDir, 'gate.json'), gate);
  process.stdout.write(`${JSON.stringify(gate)}\n`);
} catch (error) {
  if (evidenceDir) writeJson(join(evidenceDir, 'failure.json'), {
    schema: 'hummer.executable-gate-result', version: 1, gate: 'relay-node-daemon-integration',
    status: 'failed', capturedAt: new Date().toISOString(), error: safeError(error), assertions,
  });
  throw error;
} finally {
  await stopChild(node);
  await stopChild(relay);
}

function startChild(args, additions) {
  const child = spawn(process.execPath, args, {
    cwd: repository,
    env: { ...process.env, ...additions },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const state = { child, stdout: '', stderr: '', lines: [], exit: null };
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    state.stdout += chunk;
    state.lines = state.stdout.split(/\r?\n/u).filter(Boolean).map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    });
  });
  child.stderr.on('data', (chunk) => { state.stderr += chunk; });
  child.once('exit', (code, signal) => { state.exit = { code, signal }; });
  return state;
}

async function stopChild(state) {
  if (!state || state.exit) return;
  state.child.kill('SIGTERM');
  const deadline = Date.now() + 5_000;
  while (!state.exit && Date.now() < deadline) await delay(25);
  if (!state.exit) state.child.kill();
}

async function waitForJson(state, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = state.lines.find(predicate);
    if (found) return found;
    if (state.exit) throw new Error(`child exited before readiness: ${JSON.stringify(state.exit)} ${state.stderr}`);
    await delay(25);
  }
  throw new Error(`timed out waiting for child JSON; stderr=${state.stderr}`);
}

async function controlRequest(address, path, body) {
  const response = await fetch(`${address}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${controlToken}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`control request ${path} failed ${response.status}: ${JSON.stringify(payload)}`);
  return payload;
}

async function waitForApproval(address, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const payload = await controlRequest(address, '/v1/control/approval-requests');
    if (payload.approvalRequests?.length) return payload.approvalRequests[0];
    await delay(50);
  }
  throw new Error('timed out waiting for ApprovalRequest');
}

function check(condition, message) {
  if (!condition) throw new Error(message);
  assertions += 1;
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
}

function option(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  if (!process.argv[index + 1] || process.argv.length !== index + 2) throw new Error(`${name} requires one final value`);
  return process.argv[index + 1];
}

function safeError(error) {
  return error instanceof Error ? { name: error.name, message: error.message } : { name: 'Error', message: String(error) };
}
