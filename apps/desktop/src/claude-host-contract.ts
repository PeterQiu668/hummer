export interface ClaudeHostInvocation {
  command: 'claude';
  args: string[];
  cwd?: string;
  stdin: string;
  initialPrompt: string;
  protocol: 'stream-json';
}

export interface ClaudeEngineDisclosure {
  providerName: 'Anthropic';
  modelName: string;
  dataDomain: 'api.anthropic.com';
  sandbox: 'claude-permissions';
  tier: 'flagship';
}

const REQUIRED_ARGUMENTS = [
  '--print',
  '--input-format', 'stream-json',
  '--output-format', 'stream-json',
  '--permission-mode', 'manual',
] as const;

export function validateClaudeInvocation(request: ClaudeHostInvocation): void {
  if (request.command !== 'claude') throw new Error('Only the Claude Code executable is allowed');
  if (request.protocol !== 'stream-json') throw new Error('Unsupported Claude Code protocol');
  if (!Array.isArray(request.args) || request.args.some((argument) => typeof argument !== 'string' || /[&|<>^]/.test(argument))) {
    throw new Error('Claude Code arguments contain unsupported shell metacharacters');
  }
  for (const required of REQUIRED_ARGUMENTS) {
    if (!request.args.includes(required)) throw new Error(`Claude Code invocation is missing required argument ${required}`);
  }
  if (request.args.includes('--dangerously-skip-permissions')) {
    throw new Error('HUMMER never starts Claude Code with dangerously skipped permissions');
  }
}

export function claudeEngineDisclosure(modelName = 'configured by Claude Code'): ClaudeEngineDisclosure {
  return {
    providerName: 'Anthropic',
    modelName,
    dataDomain: 'api.anthropic.com',
    sandbox: 'claude-permissions',
    tier: 'flagship',
  };
}

export function redactClaudeSecrets(raw: string, environment: NodeJS.ProcessEnv): string {
  let redacted = raw;
  for (const key of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']) {
    const secret = environment[key];
    if (secret) redacted = redacted.split(secret).join(`[REDACTED:${key}]`);
  }
  return redacted;
}
