export type CodexSandbox = 'read-only' | 'workspace-write';

export function resolveCodexSandbox(requested: CodexSandbox, configured?: string): CodexSandbox {
  return configured === 'read-only' || configured === 'workspace-write' ? configured : requested;
}

export function replaceSandboxArgument(args: string[], sandbox: CodexSandbox): string[] {
  const index = args.indexOf('--sandbox');
  if (index < 0) return [...args];
  const next = [...args];
  next[index + 1] = sandbox;
  return next;
}
