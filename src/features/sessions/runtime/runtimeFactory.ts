import type { RuntimeAdapter } from './adapter';
import { CodexRuntimeAdapter, type CodexCliHost } from './codexRuntimeAdapter';
import { ClaudeRuntimeAdapter, type ClaudeCliHost } from './claudeRuntimeAdapter';
import { FailoverRuntimeAdapter } from './failoverRuntimeAdapter';
import { MockRuntimeAdapter } from './mockRuntimeAdapter';
import runtimePricing from './runtime-pricing.json';
import type { RuntimePricing } from './pricing';

declare global {
  interface Window {
    hummerCodexCliHost?: CodexCliHost;
    hummerClaudeCliHost?: ClaudeCliHost;
    hummerDesktop?: { platform: string; runtime: 'codex' | 'claude-code'; cwd: string };
  }
}

export function createDefaultRuntimeAdapter(): RuntimeAdapter {
  const requested = import.meta.env.VITE_HUMMER_RUNTIME_ADAPTER;
  if (requested === 'codex' && typeof window !== 'undefined' && window.hummerCodexCliHost) {
    const codex = new CodexRuntimeAdapter({
      enabled: true,
      host: window.hummerCodexCliHost,
      cwd: window.hummerDesktop?.cwd ?? import.meta.env.VITE_HUMMER_CODEX_CWD,
      protocol: import.meta.env.VITE_HUMMER_CODEX_PROTOCOL === 'app-server-jsonrpc' ? 'app-server-jsonrpc' : 'exec-jsonl',
      pricing: runtimePricing as RuntimePricing,
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
