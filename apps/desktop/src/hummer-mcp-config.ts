export function buildHummerMcpProviderArgs(input: {
  executable: string;
  serverScript: string;
  workspace: string;
}): string[] {
  return [
    '-c', `mcp_servers.hummer_local.command=${tomlLiteral(input.executable)}`,
    '-c', `mcp_servers.hummer_local.args=[${tomlLiteral(input.serverScript)}]`,
    '-c', "mcp_servers.hummer_local.env.ELECTRON_RUN_AS_NODE='1'",
    '-c', `mcp_servers.hummer_local.env.HUMMER_MCP_WORKSPACE=${tomlLiteral(input.workspace)}`,
    '-c', 'mcp_servers.hummer_local.startup_timeout_sec=15',
  ];
}

function tomlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
