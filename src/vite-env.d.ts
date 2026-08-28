/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_HUMMER_RUNTIME_ADAPTER?: 'mock' | 'codex';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
