import { describe, expect, it } from 'vitest';
import {
  claudeEngineDisclosure,
  redactClaudeSecrets,
  validateClaudeInvocation,
  type ClaudeHostInvocation,
} from './claude-host-contract.js';

const validInvocation: ClaudeHostInvocation = {
  command: 'claude',
  args: ['--print', '--input-format', 'stream-json', '--output-format', 'stream-json', '--permission-mode', 'manual', '--verbose'],
  stdin: '{"type":"user"}',
  initialPrompt: 'read a file',
  protocol: 'stream-json',
};

describe('Claude desktop host contract', () => {
  it('accepts the bounded stream-json invocation and rejects permission bypass', () => {
    expect(() => validateClaudeInvocation(validInvocation)).not.toThrow();
    expect(() => validateClaudeInvocation({
      ...validInvocation,
      args: [...validInvocation.args, '--dangerously-skip-permissions'],
    })).toThrow(/never starts Claude Code/);
  });

  it('keeps provider details in the audit disclosure', () => {
    expect(claudeEngineDisclosure('claude-sonnet-4-6')).toEqual({
      providerName: 'Anthropic',
      modelName: 'claude-sonnet-4-6',
      dataDomain: 'api.anthropic.com',
      sandbox: 'claude-permissions',
      tier: 'flagship',
    });
  });

  it('redacts both supported Claude credentials before wire logging', () => {
    const raw = 'api=sk-ant-secret token=oauth-secret';
    const redacted = redactClaudeSecrets(raw, {
      ANTHROPIC_API_KEY: 'sk-ant-secret',
      ANTHROPIC_AUTH_TOKEN: 'oauth-secret',
    });
    expect(redacted).not.toContain('sk-ant-secret');
    expect(redacted).not.toContain('oauth-secret');
    expect(redacted).toContain('[REDACTED:ANTHROPIC_API_KEY]');
    expect(redacted).toContain('[REDACTED:ANTHROPIC_AUTH_TOKEN]');
  });
});
