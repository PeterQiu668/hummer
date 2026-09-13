export function buildHummerMcpProviderArgs(input: {
  executable: string;
  serverScript: string;
  workspace: string;
  disabledServerNames?: readonly string[];
}): string[] {
  return [
    '-c', 'features.shell_tool=false',
    ...[...new Set(input.disabledServerNames ?? [])]
      .filter((name) => name !== 'hummer_local' && /^[A-Za-z0-9_-]+$/.test(name))
      .flatMap((name) => ['-c', `mcp_servers.${name}.enabled=false`]),
    '-c', `mcp_servers.hummer_local.command=${tomlLiteral(input.executable)}`,
    '-c', `mcp_servers.hummer_local.args=[${tomlLiteral(input.serverScript)}]`,
    '-c', "mcp_servers.hummer_local.env.ELECTRON_RUN_AS_NODE='1'",
    '-c', `mcp_servers.hummer_local.env.HUMMER_MCP_WORKSPACE=${tomlLiteral(input.workspace)}`,
    '-c', "mcp_servers.hummer_local.env_vars=['HUMMER_EXEC_BROKER_PIPE','HUMMER_EXEC_BROKER_TOKEN']",
    '-c', "mcp_servers.hummer_local.enabled_tools=['fs_read','doc_extract','workspace_exec']",
    '-c', 'mcp_servers.hummer_local.startup_timeout_sec=15',
  ];
}

function tomlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
