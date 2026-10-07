import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error node-agent is strict checkJs ESM and does not publish declarations in this alpha slice.
import { NodeAgentDaemon, validateNodeDaemonConfig } from '../../node-agent/src/daemon.mjs';
import { CapabilityGrantRegistry, createStaticBadgeTokenAuthenticator } from '../src/badge-auth.js';
import { createSharedFleetValidators } from '../src/contract-adapter.js';
import { FleetService } from '../src/fleet-service.js';
import { createFleetRelayServer } from '../src/fastify-transport.js';
import { SqliteFleetStore } from '../src/sqlite-store.js';
import { SqliteTaskGrantAuthority } from '../src/sqlite-task-grant-authority.js';

const TENANT = 'tenant-read-e2e';
const NODE = 'node-read-e2e';
const WORK = 'work-read-e2e';
const TASK = 'task-read-e2e';
const PATH = 'inputs/report.txt';
const CANARY = 'PRIVATE-FILE-BODY-40a377';
const NODE_BADGE = 'node-badge-read-e2e';
const CONTROL_BADGE = 'control-badge-read-e2e';
const GRANT_TOKEN = `hgr_${'r'.repeat(43)}`;

const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

describe('real HTTP read attestation path', () => {
  it('executes one explicitly approved read through SQLite grant authority without leaking file bytes', { timeout: 45_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'hummer-read-e2e-'));
    const workspaceRoot = join(root, 'workspace');
    const receiptRoot = join(root, 'receipts');
    const journalPath = join(root, 'execution.jsonl');
    const fleetDatabase = join(root, 'fleet.sqlite');
    const grantDatabase = join(root, 'task-grants.sqlite');
    await mkdir(join(workspaceRoot, 'inputs'), { recursive: true });
    await writeFile(join(workspaceRoot, PATH), CANARY, 'utf8');

    const store = new SqliteFleetStore(fleetDatabase);
    cleanup.push(() => store.close());
    const authority = new SqliteTaskGrantAuthority(grantDatabase);
    cleanup.push(() => authority.close());
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const authenticator = createStaticBadgeTokenAuthenticator([
      {
        token: NODE_BADGE, tokenId: 'node-read-e2e', tenantId: TENANT, actorRef: `system:${NODE}`, nodeId: NODE,
        scopes: ['node.register', 'node.heartbeat', 'task.claim', 'task.event', 'stream.connect', 'approval.request', 'approval.consume'],
        expiresAt: future,
      },
      {
        token: CONTROL_BADGE, tokenId: 'control-read-e2e', tenantId: TENANT, actorRef: 'human:operator',
        scopes: ['node.read', 'task.read', 'task.enqueue', 'approval.read', 'approval.decide'], expiresAt: future,
      },
    ]);
    const service = new FleetService(store, createSharedFleetValidators());
    const relay = createFleetRelayServer(service, { authenticator, taskGrantAuthenticator: authority });
    cleanup.push(async () => { relay.events.close(); await relay.app.close(); });
    const baseUrl = await relay.app.listen({ host: '127.0.0.1', port: 0 });

    const logs: unknown[] = [];
    const daemon = new NodeAgentDaemon({
      config: validateNodeDaemonConfig({
        schema: 'hummer.node-agent-config', version: 3, nodeId: NODE, tenantId: TENANT,
        relayBaseUrl: `${baseUrl}/`, badgeTokenEnv: 'UNUSED_BADGE', grantTokenEnv: 'UNUSED_GRANT',
        grantExpiresAt: future,
        grantScopes: ['node.heartbeat', 'task.claim', 'approval.request', 'task.execute'],
        journalPath, receiptRoot, workspaceRoot,
        heartbeatIntervalMs: 15_000, pollIntervalMs: 100, approvalTtlMs: 300_000,
        runtime: { provider: 'codex' }, capabilities: ['fs.read'],
        mcp: { endpoint: 'stdio://hummer-local', tools: ['fs_read'] }, approval: { riskClass: 'unknown' },
      }),
      badgeToken: NODE_BADGE,
      grantToken: GRANT_TOKEN,
      probeRunner: { resolve: async () => null, version: async () => ({ exitCode: 1, stdout: '', stderr: '' }) },
      logger: (entry: unknown) => logs.push(entry),
    });
    cleanup.push(() => daemon.close('test-complete'));
    await daemon.start();

    await request(baseUrl, '/v1/tasks/enqueue', CONTROL_BADGE, {
      schema: 'hummer.task-envelope', version: 1,
      workOrderTask: {
        schema: 'hummer.work-order-task', version: 1, title: 'Attest approved report',
        target: 'Hash one explicitly approved file', expectedDeliverable: 'SHA-256 attestation metadata',
      },
      tenantId: TENANT, targetNodeId: NODE, targetRuntime: 'codex', idempotencyKey: TASK,
      leaseMs: 30_000, approvalPolicyRef: 'policy-human-confirmation', grantRef: `grant:${TASK}`,
      expiresAt: future, originRef: WORK,
      executionPlan: { kind: 'fs.read.attest.v1', path: PATH, maxBytes: 4096 },
    });

    let approval;
    try {
      approval = await waitForApproval(baseUrl, 15_000);
    } catch (error) {
      const taskState = await request(baseUrl, `/v1/control/tasks/${TASK}`, CONTROL_BADGE);
      throw new Error(`${String(error)}; task=${JSON.stringify(taskState)}; logs=${JSON.stringify(logs)}`);
    }
    expect(approval.requestedScope).toEqual({ capabilities: ['task.execute', 'fs.read'], paths: [PATH], maxUses: 1 });
    expect(JSON.stringify(approval)).not.toContain(CANARY);
    const approvalExpiry = approval.expiresAt as string;

    const registry = new CapabilityGrantRegistry({ tokenFactory: () => GRANT_TOKEN });
    registry.issue({
      authorityRef: 'authority:operator', tenantId: TENANT, nodeId: NODE, workOrderId: WORK,
      issuedToRunId: approval.runId, capabilities: ['task.execute', 'fs.read'], paths: [PATH],
      expiresAt: approvalExpiry, maxUses: 1,
    }, {
      grantId: TASK, tenantId: TENANT, nodeId: NODE, workOrderId: WORK,
      issuedToRunId: approval.runId, capabilities: ['task.execute', 'fs.read'], paths: [PATH],
      expiresAt: approvalExpiry, maxUses: 1,
    });
    authority.importSnapshot({ schema: 'hummer.task-grant-snapshot', version: 1, tenantId: TENANT, grants: registry.snapshot(TENANT) });

    await request(baseUrl, `/v1/approval-requests/${approval.requestId}/decision`, CONTROL_BADGE, {
      schema: 'hummer.approval-decision', version: 1, decisionId: 'decision-read-e2e',
      requestId: approval.requestId, tenantId: TENANT, decision: 'approved',
      deciderActorRef: 'human:operator', decidedAt: new Date().toISOString(),
      grantedScope: { capabilities: ['task.execute', 'fs.read'], paths: [PATH], expiresAt: approvalExpiry, maxUses: 1 },
    });

    const completed = await waitForTask(baseUrl, 'completed', 20_000);
    expect(completed.status).toBe('completed');
    expect(authority.snapshot(TENANT)[0]).toMatchObject({ usedCount: 1, status: 'exhausted' });
    await expect(authority.consume({
      token: GRANT_TOKEN, grantRef: `grant:${TASK}`, tenantId: TENANT, workOrderId: WORK,
      nodeId: NODE, issuedToRunId: approval.runId,
      capabilities: ['task.execute', 'fs.read'], paths: [PATH], maxUses: 1, now: new Date().toISOString(),
    })).resolves.toEqual({ ok: false, reason: 'uses_exhausted' });
    const receiptFiles = (await readdir(receiptRoot)).filter((name) => name.endsWith('.json') && !name.startsWith('.'));
    expect(receiptFiles).toHaveLength(1);
    const receipt = await readFile(join(receiptRoot, receiptFiles[0]!), 'utf8');
    const digest = createHash('sha256').update(CANARY, 'utf8').digest('hex');
    expect(JSON.stringify(logs)).not.toContain(CANARY);
    expect(JSON.stringify(logs)).not.toContain(GRANT_TOKEN);
    for (const name of await readdir(root)) {
      if (name === 'workspace' || name === 'receipts') continue;
      const bytes = await readFile(join(root, name));
      expect(bytes.includes(Buffer.from(CANARY))).toBe(false);
      expect(bytes.includes(Buffer.from(GRANT_TOKEN))).toBe(false);
    }
    expect(receipt).not.toContain(CANARY);
    expect(receipt).not.toContain(GRANT_TOKEN);
    expect(receipt).toContain(digest);
    expect(receipt).toContain(`\"evidenceRef\":\"evidence://sha256/${digest}\"`);
    expect(receipt).toContain(`\"relativePath\":\"${PATH}\"`);
  });
});

async function request(baseUrl: string, path: string, token: string, body?: unknown): Promise<any> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`${path} failed ${response.status}: ${JSON.stringify(payload)}`);
  return payload;
}

async function waitForApproval(baseUrl: string, timeoutMs: number): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const payload = await request(baseUrl, '/v1/control/approval-requests', CONTROL_BADGE);
    if (payload.approvalRequests?.[0]) return payload.approvalRequests[0];
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('timed out waiting for approval request');
}

async function waitForTask(baseUrl: string, status: string, timeoutMs: number): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const payload = await request(baseUrl, `/v1/control/tasks/${TASK}`, CONTROL_BADGE);
    if (payload.task?.status === status) return payload.task;
    if (['failed', 'stopped'].includes(payload.task?.status)) throw new Error(`task became ${payload.task.status}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for task ${status}`);
}
