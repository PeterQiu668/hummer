export interface RuntimeConnectorRecord {
  id: string;
  runtimeId: string;
  technicalName: string;
  transport: 'mcp';
  status: 'starting' | 'connected' | 'failed';
  checkedAt: string;
  sessionId: string | null;
  error: string | null;
}

export interface RuntimeConnectorPort {
  list(): Promise<RuntimeConnectorRecord[]>;
  subscribe(callback: (records: RuntimeConnectorRecord[]) => void): () => void;
}

declare global {
  interface Window {
    hummerRuntimeConnectors?: RuntimeConnectorPort;
  }
}

export function desktopRuntimeConnectorPort(): RuntimeConnectorPort | undefined {
  return typeof window === 'undefined' ? undefined : window.hummerRuntimeConnectors;
}
