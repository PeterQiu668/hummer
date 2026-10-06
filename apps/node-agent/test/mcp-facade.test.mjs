import assert from 'node:assert/strict';
import test from 'node:test';

import { createMcpToolFacade } from '../src/mcp-facade.mjs';

test('exposes only the three HUMMER local tool names', () => {
  const facade = createMcpToolFacade({
    fs_read: async () => ({}),
    doc_extract: async () => ({}),
    workspace_exec: async () => ({}),
  });

  assert.deepEqual(facade.listTools().map((tool) => tool.name), ['fs_read', 'doc_extract', 'workspace_exec']);
});

test('rejects an unknown MCP tool fail-closed', async () => {
  const facade = createMcpToolFacade({});
  await assert.rejects(
    () => facade.invoke({ name: 'shell', arguments: {} }, { scopes: ['*'], approvalConfirmed: true }),
    { code: 'unknown_tool' },
  );
});

test('rejects workspace execution without explicit confirmation', async () => {
  let calls = 0;
  const facade = createMcpToolFacade({ workspace_exec: async () => { calls += 1; return {}; } });

  await assert.rejects(
    () => facade.invoke({ name: 'workspace_exec', arguments: {} }, { scopes: ['workspace.exec'], approvalConfirmed: false }),
    { code: 'approval_required' },
  );
  assert.equal(calls, 0);
});

test('rejects a known tool when the grant scope is absent', async () => {
  const facade = createMcpToolFacade({ fs_read: async () => ({}) });
  await assert.rejects(
    () => facade.invoke({ name: 'fs_read', arguments: { path: 'facts.txt' } }, { scopes: [], approvalConfirmed: false }),
    { code: 'scope_denied' },
  );
});

test('delegates authorized calls without implementing host IO in the facade', async () => {
  const facade = createMcpToolFacade({ fs_read: async (args) => ({ args, hash: 'sha256:demo' }) });
  const result = await facade.invoke(
    { name: 'fs_read', arguments: { path: 'facts.txt' } },
    { scopes: ['fs.read'], approvalConfirmed: false },
  );
  assert.deepEqual(result, { args: { path: 'facts.txt' }, hash: 'sha256:demo' });
});
