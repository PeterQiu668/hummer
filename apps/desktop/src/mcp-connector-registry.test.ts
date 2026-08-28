import { beforeEach, describe, expect, it } from 'vitest';
import { clearRuntimeConnectors, listRuntimeConnectors, recordMcpStartupStatus } from './mcp-connector-registry.js';

beforeEach(() => clearRuntimeConnectors());

describe('runtime MCP connector registry', () => {
  it('records only real app-server startup status events and preserves technical audit facts', () => {
    expect(recordMcpStartupStatus({ method: 'turn/started', params: {} })).toBeUndefined();

    recordMcpStartupStatus({
      method: 'mcpServer/startupStatus/updated',
      params: {
        threadId: 'thread-1',
        name: 'node_repl',
        status: 'starting',
        error: null,
      },
    }, '2026-08-28T06:28:55.242Z');
    recordMcpStartupStatus({
      method: 'mcpServer/startupStatus/updated',
      params: {
        threadId: 'thread-1',
        name: 'node_repl',
        status: 'ready',
        error: null,
      },
    }, '2026-08-28T06:28:55.354Z');

    expect(listRuntimeConnectors()).toEqual([{
      id: 'node_repl',
      runtimeId: 'codex-cli',
      technicalName: 'node_repl',
      transport: 'mcp',
      status: 'connected',
      checkedAt: '2026-08-28T06:28:55.354Z',
      sessionId: 'thread-1',
      error: null,
    }]);
  });

  it('surfaces a failed handshake instead of retaining a stale connected claim', () => {
    recordMcpStartupStatus({
      method: 'mcpServer/startupStatus/updated',
      params: { name: 'codex_apps', status: 'failed', error: 'handshake failed' },
    });

    expect(listRuntimeConnectors()[0]).toMatchObject({
      id: 'codex_apps',
      status: 'failed',
      error: 'handshake failed',
    });
  });
});
