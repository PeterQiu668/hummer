import { spawn } from 'node:child_process';
import { TextLineDecoder } from './wire-log.js';

export interface McpProbeResult {
  serverName: 'hummer_local';
  toolNames: string[];
}

export function probeLocalMcp(input: {
  executable: string;
  serverScript: string;
  workspace: string;
  timeoutMs?: number;
}): Promise<McpProbeResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(input.executable, [input.serverScript], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', HUMMER_MCP_WORKSPACE: input.workspace },
    });
    const decoder = new TextLineDecoder();
    let stderr = '';
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!child.killed) child.kill();
      callback();
    };
    const timer = setTimeout(() => finish(() => reject(new Error(`MCP handshake timed out${stderr ? `: ${stderr.slice(-500)}` : ''}`))), input.timeoutMs ?? 10_000);
    child.stderr.on('data', (chunk: Buffer) => { stderr = `${stderr}${chunk.toString('utf8')}`.slice(-2_000); });
    child.on('error', (error) => finish(() => reject(error)));
    child.on('close', (code) => {
      if (!settled) finish(() => reject(new Error(stderr.trim() || `MCP server exited with code ${code ?? 'unknown'}`)));
    });
    child.stdout.on('data', (chunk: Buffer) => {
      try {
        for (const line of decoder.push(chunk)) {
          const response = JSON.parse(line) as { id?: number; result?: { tools?: Array<{ name?: string }> }; error?: { message?: string } };
          if (response.error) throw new Error(response.error.message || 'MCP server returned an error');
          if (response.id === 1) {
            child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
            child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`);
          }
          if (response.id === 2) {
            const toolNames = (response.result?.tools ?? []).flatMap((tool) => typeof tool.name === 'string' ? [tool.name] : []);
            for (const required of ['fs_read', 'doc_extract']) {
              if (!toolNames.includes(required)) throw new Error(`MCP server did not advertise ${required}`);
            }
            finish(() => resolve({ serverName: 'hummer_local', toolNames }));
          }
        }
      } catch (error) {
        finish(() => reject(error instanceof Error ? error : new Error(String(error))));
      }
    });
    child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'hummer-desktop-probe', version: '0.6.0' } },
    })}\n`);
  });
}
