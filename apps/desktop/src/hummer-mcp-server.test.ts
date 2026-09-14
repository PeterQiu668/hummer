import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { handleMcpRequest } from './hummer-mcp-server.js';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

describe('HUMMER local MCP server', () => {
  it('lists the three local MCP tools and returns file content with a digest', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'hummer-mcp-'));
    directories.push(workspace);
    writeFileSync(join(workspace, 'facts.txt'), 'trusted facts', 'utf8');

    await expect(handleMcpRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, workspace)).resolves.toMatchObject({
      id: 1,
      result: { tools: [{ name: 'fs_read' }, { name: 'doc_extract' }, { name: 'workspace_exec' }] },
    });
    const response = await handleMcpRequest({
      jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'fs_read', arguments: { path: 'facts.txt' } },
    }, workspace);
    expect(response).toMatchObject({ id: 2, result: { structuredContent: { path: 'facts.txt', content: 'trusted facts' } } });
    expect(JSON.stringify(response)).toMatch(/[a-f0-9]{64}/);
  });

  it('forwards workspace execution to the HUMMER main-process broker', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'hummer-mcp-'));
    directories.push(workspace);
    const execute = vi.fn().mockResolvedValue({ exitCode: 0, artifacts: [{ path: 'report.docx', sha256: 'a'.repeat(64), sizeBytes: 12 }] });

    const response = await handleMcpRequest({
      jsonrpc: '2.0', id: 5, method: 'tools/call', params: {
        name: 'workspace_exec', arguments: { argv: ['python', 'build.py'], files: [{ path: 'build.py', content: 'print(1)' }] },
      },
    }, workspace, execute);

    expect(execute).toHaveBeenCalledWith({ argv: ['python', 'build.py'], files: [{ path: 'build.py', content: 'print(1)' }] });
    expect(response).toMatchObject({ id: 5, result: { structuredContent: { exitCode: 0 } } });
  });

  it('returns a readable Chinese failure for a sandbox execution error', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'hummer-mcp-'));
    directories.push(workspace);
    const response = await handleMcpRequest({
      jsonrpc: '2.0', id: 6, method: 'tools/call', params: {
        name: 'workspace_exec', arguments: { argv: ['python', 'build.py'], files: [] },
      },
    }, workspace, vi.fn().mockRejectedValue(new Error('Container execution timed out after 120000ms')));

    expect(response).toMatchObject({ error: { code: -32000, message: '沙箱内任务超时，请缩小任务范围或检查运行依赖后重试。' } });
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
