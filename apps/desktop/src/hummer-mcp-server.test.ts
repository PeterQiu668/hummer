import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { handleMcpRequest } from './hummer-mcp-server.js';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

describe('HUMMER local MCP server', () => {
  it('lists only the two local MCP tools and returns file content with a digest', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'hummer-mcp-'));
    directories.push(workspace);
    writeFileSync(join(workspace, 'facts.txt'), 'trusted facts', 'utf8');

    await expect(handleMcpRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, workspace)).resolves.toMatchObject({
      id: 1,
      result: { tools: [{ name: 'fs_read' }, { name: 'doc_extract' }] },
    });
    const response = await handleMcpRequest({
      jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'fs_read', arguments: { path: 'facts.txt' } },
    }, workspace);
    expect(response).toMatchObject({ id: 2, result: { structuredContent: { path: 'facts.txt', content: 'trusted facts' } } });
    expect(JSON.stringify(response)).toMatch(/[a-f0-9]{64}/);
  });

  it('rejects traversal and every unregistered tool', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'hummer-mcp-'));
    directories.push(workspace);
    await expect(handleMcpRequest({
      jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'fs_read', arguments: { path: '../outside.txt' } },
    }, workspace)).resolves.toMatchObject({ id: 3, error: { code: -32000 } });
    await expect(handleMcpRequest({
      jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'external_send', arguments: {} },
    }, workspace)).resolves.toMatchObject({ id: 4, error: { code: -32601 } });
  });
});
