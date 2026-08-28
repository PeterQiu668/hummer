import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openPersistence } from './database.js';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

describe('ExecutionNodeStore', () => {
  it('reports real host health, permission scope and the current persisted session', () => {
    const directory = mkdtempSync(join(tmpdir(), 'hummer-node-'));
    directories.push(directory);
    const persistence = openPersistence({ dataDirectory: directory });
    persistence.executionNodes.registerLocal({ id: 'node_local', tenantId: 'tenant_demo', displayName: '本机执行节点', runtimeId: 'codex-cli', cwd: 'C:\\workspace', permissionScope: 'workspace-write; approval-required', lastSeenAt: '2026-08-28T11:00:00.000Z' });
    persistence.runtimeEvents.saveSession({ sessionId: 'ses_node', tenantId: 'tenant_demo', runtimeId: 'codex-cli', startedAt: '2026-08-28T11:00:01.000Z', plan: { id: 'plan_node' }, handle: { runtimeId: 'codex-cli', sessionId: 'ses_node' } });

    expect(persistence.executionNodes.list('tenant_demo')).toEqual([expect.objectContaining({
      id: 'node_local', status: 'online', cwd: 'C:\\workspace', currentSessionId: 'ses_node',
    })]);
    persistence.executionNodes.markOffline('node_local', '2026-08-28T11:05:00.000Z');
    expect(persistence.executionNodes.list('tenant_demo')[0].status).toBe('offline');
    persistence.close();
  });
});
