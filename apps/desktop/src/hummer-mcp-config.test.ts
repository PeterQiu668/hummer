import { describe, expect, it } from 'vitest';
import { buildHummerMcpProviderArgs } from './hummer-mcp-config.js';

describe('HUMMER MCP provider arguments', () => {
  it('actively injects the verified stdio server without putting secrets in argv', () => {
    const args = buildHummerMcpProviderArgs({
      executable: 'C:/HUMMER/electron.exe',
      serverScript: 'C:/HUMMER/hummer-mcp-server.js',
      workspace: 'C:/customer/workspace',
      disabledServerNames: ['node_repl', 'hummer_local', 'bad.name'],
    });

    expect(args.join(' ')).toContain('mcp_servers.hummer_local.command');
    expect(args.join(' ')).toContain('hummer-mcp-server.js');
    expect(args.join(' ')).toContain('ELECTRON_RUN_AS_NODE');
    expect(args.join(' ')).toContain('HUMMER_MCP_WORKSPACE');
    expect(args.join(' ')).toContain('features.shell_tool=false');
    expect(args).toContain('mcp_servers.node_repl.enabled=false');
    expect(args.join(' ')).not.toContain('bad.name');
    expect(args.join(' ')).toContain('HUMMER_EXEC_BROKER_PIPE');
    expect(args.join(' ')).toContain('HUMMER_EXEC_BROKER_TOKEN');
    expect(args.join(' ')).not.toMatch(/API_KEY|sk-[A-Za-z0-9]/);
    expect(args.join(' ')).not.toContain('broker-secret-value');
  });
});
