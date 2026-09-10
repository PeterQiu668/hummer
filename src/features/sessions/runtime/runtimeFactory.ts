import type { RuntimeAdapter } from './adapter';
import { CodexRuntimeAdapter, type CodexCliHost } from './codexRuntimeAdapter';
import { ClaudeRuntimeAdapter, type ClaudeCliHost } from './claudeRuntimeAdapter';
import { FailoverRuntimeAdapter } from './failoverRuntimeAdapter';
import { MockRuntimeAdapter } from './mockRuntimeAdapter';
import runtimePricing from './runtime-pricing.json';
import type { RuntimePricing } from './pricing';
import { currentSessionToken } from '../../identity/identityClient';

declare global {
  interface Window {
    hummerCodexCliHost?: CodexCliHost;
    hummerClaudeCliHost?: ClaudeCliHost;
    hummerDesktop?: { platform: string; runtime: 'codex' | 'claude-code'; cwd: string };
  }
}

export function createDefaultRuntimeAdapter(): RuntimeAdapter {
  const requested = resolveRequestedRuntime(
    import.meta.env.VITE_HUMMER_RUNTIME_ADAPTER,
    typeof window !== 'undefined' ? window.hummerDesktop?.runtime : undefined,
  );
  if (requested === 'codex' && typeof window !== 'undefined' && window.hummerCodexCliHost) {
    const codex = new CodexRuntimeAdapter({
      enabled: true,
      host: window.hummerCodexCliHost,
      cwd: window.hummerDesktop?.cwd ?? import.meta.env.VITE_HUMMER_CODEX_CWD,
      protocol: import.meta.env.VITE_HUMMER_CODEX_PROTOCOL === 'exec-jsonl' ? 'exec-jsonl' : 'app-server-jsonrpc',
      pricing: runtimePricing as RuntimePricing,
      getAuthToken: currentSessionToken,
    });
    return new FailoverRuntimeAdapter(codex, new MockRuntimeAdapter());
  }
  if (requested === 'claude' && typeof window !== 'undefined' && window.hummerClaudeCliHost) {
    const claude = new ClaudeRuntimeAdapter({
      enabled: true,
      host: window.hummerClaudeCliHost,
      cwd: window.hummerDesktop?.cwd ?? import.meta.env.VITE_HUMMER_CLAUDE_CWD,
    });
    return new FailoverRuntimeAdapter(claude, new MockRuntimeAdapter());
  }
  return new MockRuntimeAdapter();
}

export function resolveRequestedRuntime(
  configured: 'mock' | 'codex' | 'claude' | undefined,
  desktopRuntime: 'codex' | 'claude-code' | undefined,
): 'mock' | 'codex' | 'claude' {
  if (configured) return configured;
  if (desktopRuntime === 'codex') return 'codex';
  if (desktopRuntime === 'claude-code') return 'claude';
  return 'mock';
}
