import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextLineDecoder } from './wire-log.js';

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number;
  method?: string;
  params?: unknown;
}

export function handleMcpRequest(request: JsonRpcRequest, workspaceDirectory: string): Record<string, unknown> | undefined {
  if (request.id === undefined && request.method?.startsWith('notifications/')) return undefined;
  const id = request.id ?? null;
  try {
    if (request.method === 'initialize') return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: protocolVersion(request.params),
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'hummer-local-tools', version: '0.5.0' },
      },
    };
    if (request.method === 'ping') return { jsonrpc: '2.0', id, result: {} };
    if (request.method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: [FS_READ_TOOL] } };
    if (request.method === 'tools/call') {
      const params = record(request.params);
      if (params.name !== 'fs_read') return failure(id, -32601, `Unknown tool ${String(params.name ?? '')}`);
      const args = record(params.arguments);
      const requestedPath = typeof args.path === 'string' ? args.path : '';
      if (!requestedPath) return failure(id, -32602, 'fs_read requires path');
      const result = readWorkspaceFile(workspaceDirectory, requestedPath);
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          structuredContent: result,
          isError: false,
        },
      };
    }
    return failure(id, -32601, `Unknown method ${String(request.method ?? '')}`);
  } catch (error) {
    return failure(id, -32000, error instanceof Error ? error.message : String(error));
  }
}

export function readWorkspaceFile(workspaceDirectory: string, requestedPath: string) {
  const workspace = realpathSync(workspaceDirectory);
  const candidate = resolve(workspace, requestedPath);
  const fromWorkspace = relative(workspace, candidate);
  if (fromWorkspace === '..' || fromWorkspace.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(fromWorkspace)) {
    throw new Error('fs_read path is outside the workspace');
  }
  const actual = realpathSync(candidate);
  const actualFromWorkspace = relative(workspace, actual);
  if (actualFromWorkspace === '..' || actualFromWorkspace.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(actualFromWorkspace)) {
    throw new Error('fs_read symbolic link resolves outside the workspace');
  }
  const stats = statSync(actual);
  if (!stats.isFile()) throw new Error('fs_read accepts files only');
  if (stats.size > 1_048_576) throw new Error('fs_read refuses files larger than 1 MiB');
  const bytes = readFileSync(actual);
  return {
    path: requestedPath,
    content: bytes.toString('utf8'),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: bytes.length,
  };
}

const FS_READ_TOOL = {
  name: 'fs_read',
  title: 'Read workspace file',
  description: 'Read one UTF-8 text file inside the HUMMER workspace. Read-only; paths outside the workspace are rejected.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['path'],
    properties: { path: { type: 'string', minLength: 1 } },
  },
};

function protocolVersion(params: unknown): string {
  const value = record(params).protocolVersion;
  return typeof value === 'string' && value ? value : '2025-06-18';
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function failure(id: string | number | null, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function startServer(): void {
  const workspace = process.env.HUMMER_MCP_WORKSPACE;
  if (!workspace) throw new Error('HUMMER_MCP_WORKSPACE is required');
  const decoder = new TextLineDecoder();
  process.stdin.on('data', (chunk: Buffer) => decoder.push(chunk).forEach((line) => respond(line, workspace)));
  process.stdin.on('end', () => decoder.finish().forEach((line) => respond(line, workspace)));
}

function respond(line: string, workspace: string): void {
  try {
    const response = handleMcpRequest(JSON.parse(line) as JsonRpcRequest, workspace);
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify(failure(null, -32700, error instanceof Error ? error.message : String(error)))}\n`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) startServer();
