import { describe, expect, it } from 'vitest';
import { replaceSandboxArgument, resolveCodexSandbox } from './codex-sandbox.js';

describe('Codex sandbox configuration', () => {
  it('forces legacy initial and forked session requests to read-only', () => {
    expect(resolveCodexSandbox('workspace-write')).toBe('read-only');
    expect(resolveCodexSandbox('read-only')).toBe('read-only');
  });

  it('keeps exec-jsonl arguments consistent with the effective sandbox', () => {
    expect(replaceSandboxArgument(['exec', '--json', '--sandbox', 'workspace-write', '-'], 'read-only'))
      .toEqual(['exec', '--json', '--sandbox', 'read-only', '-']);
  });
});
