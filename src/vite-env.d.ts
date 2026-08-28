/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_HUMMER_RUNTIME_ADAPTER?: 'mock' | 'codex' | 'claude';
  readonly VITE_HUMMER_CLAUDE_CWD?: string;
  readonly VITE_HUMMER_CODEX_CWD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
