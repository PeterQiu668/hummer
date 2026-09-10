import { describe, expect, it } from 'vitest';
import { resolveRequestedRuntime } from './runtimeFactory';

describe('runtime factory selection', () => {
  it('uses the desktop host runtime by default', () => {
    expect(resolveRequestedRuntime(undefined, 'codex')).toBe('codex');
    expect(resolveRequestedRuntime(undefined, 'claude-code')).toBe('claude');
  });

  it('keeps a browser without a host on the honest mock runtime', () => {
    expect(resolveRequestedRuntime(undefined, undefined)).toBe('mock');
  });

  it('honors an explicit test or feature-flag override', () => {
    expect(resolveRequestedRuntime('mock', 'codex')).toBe('mock');
  });
});
