export type CodexSandbox = 'read-only';
type LegacyCodexSandboxRequest = CodexSandbox | 'workspace-write';

export function resolveCodexSandbox(_requested: LegacyCodexSandboxRequest): CodexSandbox {
  return 'read-only';
}

export function replaceSandboxArgument(args: string[], sandbox: CodexSandbox): string[] {
  const index = args.indexOf('--sandbox');
  if (index < 0) return [...args];
  const next = [...args];
  next[index + 1] = sandbox;
  return next;
}
