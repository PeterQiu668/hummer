import { describe, expect, it } from 'vitest';
import { replaceSandboxArgument, resolveCodexSandbox } from './codex-sandbox.js';

describe('Codex sandbox configuration', () => {
  it('applies an explicit host override to the initial and forked session policy', () => {
    expect(resolveCodexSandbox('workspace-write', 'read-only')).toBe('read-only');
    expect(resolveCodexSandbox('read-only', 'workspace-write')).toBe('workspace-write');
  });

  it('ignores unsupported configuration values', () => {
    expect(resolveCodexSandbox('read-only', 'danger-full-access')).toBe('read-only');
  });

  it('keeps exec-jsonl arguments consistent with the effective sandbox', () => {
    expect(replaceSandboxArgument(['exec', '--json', '--sandbox', 'workspace-write', '-'], 'read-only'))
      .toEqual(['exec', '--json', '--sandbox', 'read-only', '-']);
  });
});
