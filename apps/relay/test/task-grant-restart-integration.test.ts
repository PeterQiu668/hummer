import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CapabilityGrantRegistry,
  createStaticBadgeTokenAuthenticator,
  type BadgeScope,
} from '../src/badge-auth.js';
import { createSharedFleetValidators } from '../src/contract-adapter.js';
import { FleetService } from '../src/fleet-service.js';
import { createFleetRelayServer } from '../src/fastify-transport.js';
import { SqliteFleetStore } from '../src/sqlite-store.js';
import { SqliteTaskGrantAuthority } from '../src/sqlite-task-grant-authority.js';

const NOW = '2026-10-07T00:00:00.000Z';
const TENANT = 'tenant-a';
const NODE = 'node-a';
const TOKEN = `hgr_${'q'.repeat(43)}`;
const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

function badge(token: string, nodeId: string | undefined, scopes: readonly BadgeScope[]) {
  return {
    token, tokenId: `badge-${token}`, tenantId: TENANT,
    actorRef: nodeId ? `system:${nodeId}` : 'human:operator', nodeId,
    scopes, expiresAt: '2099-01-01T00:00:00.000Z',
  };
}

function authorization(token: string) { return { authorization: `Bearer ${token}` }; }

describe('durable task grant restart integration', () => {
  it('never reopens a consumed or revoked task grant after Relay restart', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'hummer-task-grant-restart-'));
    directories.push(directory);
    const fleetPath = resolve(directory, 'fleet.sqlite');
    const grantPath = resolve(directory, 'task-grants.sqlite');
    const seed = new CapabilityGrantRegistry({ now: () => new Date(NOW), tokenFactory: () => TOKEN });
    seed.issue({
      authorityRef: 'authority:operator', tenantId: TENANT, nodeId: NODE,
      workOrderId: 'work-1', issuedToRunId: 'run-1', capabilities: ['task.execute'],
      paths: ['outputs/report.md'], expiresAt: '2026-10-07T01:00:00.000Z', maxUses: 1,
    }, {
      grantId: 'task-1', tenantId: TENANT, nodeId: NODE,
      workOrderId: 'work-1', issuedToRunId: 'run-1', capabilities: ['task.execute'],
      paths: ['outputs/report.md'], expiresAt: '2026-10-07T00:30:00.000Z', maxUses: 1,
    });
    const initialAuthority = new SqliteTaskGrantAuthority(grantPath, { now: () => new Date(NOW) });
    initialAuthority.importSnapshot({
      schema: 'hummer.task-grant-snapshot', version: 1, tenantId: TENANT,
      grants: seed.snapshot(TENANT),
    });
    initialAuthority.close();

    const start = () => {
      const store = new SqliteFleetStore(fleetPath);
      const taskGrants = new SqliteTaskGrantAuthority(grantPath, { now: () => new Date(NOW) });
      const authenticator = createStaticBadgeTokenAuthenticator([
        badge('node-badge-value-long-enough-0001', NODE, [
          'node.register', 'task.claim', 'approval.request', 'approval.consume',
        ]),
        badge('control-badge-value-long-enough-01', undefined, ['task.enqueue', 'approval.decide']),
      ]);
      const service = new FleetService(store, createSharedFleetValidators(), { now: () => new Date(NOW) });
      const entry = createFleetRelayServer(service, {
        authenticator, taskGrantAuthenticator: taskGrants, now: () => new Date(NOW),
      });
      return { ...entry, store, taskGrants };
    };
    const close = async (entry: ReturnType<typeof start>) => {
      entry.events.close();
      await entry.app.close();
      entry.store.close();
      entry.taskGrants.close();
    };
    const nodeHeaders = authorization('node-badge-value-long-enough-0001');
    const controlHeaders = authorization('control-badge-value-long-enough-01');
    const grantHeaders = { ...nodeHeaders, 'x-hummer-task-grant': TOKEN };
    const route = `/v1/nodes/${NODE}/tasks/delivery-1/task-grant`;

    let entry = start();
    expect((await entry.app.inject({
      method: 'POST', url: '/v1/nodes/register', headers: nodeHeaders,
      payload: {
        schema: 'hummer.node-manifest', version: 1, nodeId: NODE, tenantIds: [TENANT],
        platform: 'win32', agentVersion: '0.1.0',
        runtimes: [{ kind: 'codex', available: true, pinnedVersion: '0.153.4' }],
        capabilities: ['fs.read'], mcp: { endpoint: 'stdio://hummer-local', tools: ['fs_read'] },
        load: { running: 0, queued: 0 },
      },
    })).statusCode).toBe(200);
    expect((await entry.app.inject({
      method: 'POST', url: '/v1/tasks/enqueue', headers: controlHeaders,
      payload: {
        schema: 'hummer.task-envelope', version: 1,
        workOrderTask: {
          schema: 'hummer.work-order-task', version: 1, title: 'Read report',
          target: 'Attest one report', expectedDeliverable: 'outputs/report.md',
        },
        tenantId: TENANT, targetNodeId: NODE, targetRuntime: 'codex',
        idempotencyKey: 'delivery-1', leaseMs: 30_000,
        approvalPolicyRef: 'policy-deny-by-default', grantRef: 'grant:task-1',
        expiresAt: '2026-10-07T01:00:00.000Z', originRef: 'work-1',
      },
    })).statusCode).toBe(200);
    expect((await entry.app.inject({
      method: 'POST', url: `/v1/nodes/${NODE}/tasks/claim`, headers: nodeHeaders,
    })).statusCode).toBe(200);
    expect((await entry.app.inject({
      method: 'POST', url: `/v1/nodes/${NODE}/tasks/delivery-1/approval-requests`, headers: nodeHeaders,
      payload: {
        schema: 'hummer.approval-request', version: 1, requestId: 'request-1', tenantId: TENANT,
        workOrderId: 'work-1', nodeId: NODE, runId: 'run-1', riskClass: 'write',
        action: 'task.execute', target: 'delivery-1', redactedPreview: 'Read one approved file',
        requestedScope: { capabilities: ['task.execute'], paths: ['outputs/report.md'], maxUses: 1 },
        expiresAt: '2026-10-07T01:00:00.000Z', requestedBy: `system:${NODE}`,
      },
    })).statusCode).toBe(200);
    expect((await entry.app.inject({
      method: 'POST', url: '/v1/approval-requests/request-1/decision', headers: controlHeaders,
      payload: {
        schema: 'hummer.approval-decision', version: 1, decisionId: 'decision-1',
        requestId: 'request-1', tenantId: TENANT, deciderActorRef: 'human:operator',
        decidedAt: NOW, decision: 'approved',
        grantedScope: {
          capabilities: ['task.execute'], paths: ['outputs/report.md'], maxUses: 1,
          expiresAt: '2026-10-07T00:30:00.000Z',
        },
      },
    })).statusCode).toBe(200);
    expect((await entry.app.inject({
      method: 'POST', url: `${route}/consume`, headers: grantHeaders, payload: { requestId: 'request-1' },
    })).statusCode).toBe(200);
    await close(entry);

    entry = start();
    expect((await entry.app.inject({
      method: 'POST', url: `${route}/consume`, headers: grantHeaders, payload: { requestId: 'request-1' },
    })).statusCode).toBe(401);
    expect((await entry.app.inject({
      method: 'POST', url: `${route}/checkpoint`, headers: grantHeaders, payload: { requestId: 'request-1' },
    })).statusCode).toBe(200);
    entry.taskGrants.revoke(TENANT, 'task-1', '2026-10-07T00:10:00.000Z');
    await close(entry);

    entry = start();
    expect((await entry.app.inject({
      method: 'POST', url: `${route}/checkpoint`, headers: grantHeaders, payload: { requestId: 'request-1' },
    })).statusCode).toBe(401);
    await close(entry);
    expect(readFileSync(grantPath).toString('latin1')).not.toContain(TOKEN);
  });
});
