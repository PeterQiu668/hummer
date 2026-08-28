import type { RuntimeAdapter } from './adapter';
import { CodexRuntimeAdapter, type CodexCliHost } from './codexRuntimeAdapter';
import { FailoverRuntimeAdapter } from './failoverRuntimeAdapter';
import { MockRuntimeAdapter } from './mockRuntimeAdapter';
import runtimePricing from './runtime-pricing.json';
import type { RuntimePricing } from './pricing';

declare global {
  interface Window {
    hummerCodexCliHost?: CodexCliHost;
    hummerDesktop?: { platform: string; runtime: 'codex'; cwd: string };
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
  return new MockRuntimeAdapter();
}
