export interface ExecutionNodeRecord {
  id: string;
  tenantId: string;
  displayName: string;
  runtimeId: string;
  status: 'online' | 'offline';
  cwd: string;
  permissionScope: string;
  currentSessionId: string | null;
  lastSeenAt: string;
}

export interface ExecutionNodePort {
  list(tenantId: string): Promise<ExecutionNodeRecord[]>;
  killAll(): Promise<{ killed: number }>;
}

declare global {
  interface Window {
    hummerExecutionNodes?: ExecutionNodePort;
  }
}

export function desktopExecutionNodePort(): ExecutionNodePort | undefined {
  return typeof window === 'undefined' ? undefined : window.hummerExecutionNodes;
}
