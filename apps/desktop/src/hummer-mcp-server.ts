import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractDocument } from './document-extractor.js';
import { requireWorkspaceFile } from './workspace-file-guard.js';
import { TextLineDecoder } from './wire-log.js';
import { requestWorkspaceExecFromBroker } from './workspace-exec-broker.js';
import type { WorkspaceExecResult } from './workspace-exec-service.js';

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number;
  method?: string;
  params?: unknown;
}

type WorkspaceExecForwarder = (input: Parameters<typeof requestWorkspaceExecFromBroker>[0]) => Promise<WorkspaceExecResult>;

export async function handleMcpRequest(
  request: JsonRpcRequest,
  workspaceDirectory: string,
  executeWorkspace: WorkspaceExecForwarder = requestWorkspaceExecFromBroker,
): Promise<Record<string, unknown> | undefined> {
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
    if (request.method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: [FS_READ_TOOL, DOC_EXTRACT_TOOL, WORKSPACE_EXEC_TOOL] } };
    if (request.method === 'tools/call') {
      const params = record(request.params);
      if (params.name === 'workspace_exec') {
        const result = await executeWorkspace(workspaceExecInput(params.arguments));
        return {
          jsonrpc: '2.0', id,
          result: { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result, isError: false },
        };
      }
      if (params.name !== 'fs_read' && params.name !== 'doc_extract') return failure(id, -32601, `Unknown tool ${String(params.name ?? '')}`);
      const args = record(params.arguments);
      const requestedPath = typeof args.path === 'string' ? args.path : '';
      if (!requestedPath) return failure(id, -32602, `${params.name} requires path`);
      const result = params.name === 'fs_read'
        ? readWorkspaceFile(workspaceDirectory, requestedPath)
        : await extractDocument(workspaceDirectory, requestedPath);
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
  const file = requireWorkspaceFile({ workspaceDirectory, requestedPath, capability: 'fs_read', maxBytes: 1_048_576 });
  const bytes = readFileSync(file.absolutePath);
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

const DOC_EXTRACT_TOOL = {
  name: 'doc_extract',
  title: 'Extract local office document',
  description: 'Extract structured text from one XLSX, DOCX, or PDF inside the HUMMER workspace. Parsing stays on this computer.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['path'],
    properties: { path: { type: 'string', minLength: 1 } },
  },
};

const WORKSPACE_EXEC_TOOL = {
  name: 'workspace_exec',
  title: 'Execute inside an isolated order workspace',
  description: 'Stage source files and execute code inside the HUMMER-owned, offline order sandbox. Returns artifact hashes; the runtime never receives host shell access.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['argv', 'files'],
    properties: {
      argv: { type: 'array', minItems: 1, maxItems: 128, items: { type: 'string', minLength: 1 } },
      files: {
        type: 'array', maxItems: 64,
        items: {
          type: 'object', additionalProperties: false, required: ['path', 'content'],
          properties: { path: { type: 'string', minLength: 1 }, content: { type: 'string' } },
        },
      },
      timeoutMs: { type: 'integer', minimum: 1000, maximum: 300000 },
    },
  },
};

function workspaceExecInput(value: unknown): Parameters<typeof requestWorkspaceExecFromBroker>[0] {
  const input = record(value);
  const argv = Array.isArray(input.argv) ? input.argv.filter((item): item is string => typeof item === 'string') : [];
  const files = Array.isArray(input.files) ? input.files.map((item) => {
    const file = record(item);
    return { path: typeof file.path === 'string' ? file.path : '', content: typeof file.content === 'string' ? file.content : '' };
  }) : [];
  return { argv, files, ...(typeof input.timeoutMs === 'number' ? { timeoutMs: input.timeoutMs } : {}) };
}

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
  process.stdin.on('data', (chunk: Buffer) => decoder.push(chunk).forEach((line) => { void respond(line, workspace); }));
  process.stdin.on('end', () => decoder.finish().forEach((line) => { void respond(line, workspace); }));
}

async function respond(line: string, workspace: string): Promise<void> {
  try {
    const response = await handleMcpRequest(JSON.parse(line) as JsonRpcRequest, workspace);
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify(failure(null, -32700, error instanceof Error ? error.message : String(error)))}\n`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) startServer();
