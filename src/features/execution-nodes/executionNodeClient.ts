import { currentSessionToken } from '../identity/identityClient';

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
  list(): Promise<ExecutionNodeRecord[]>;
  killAll(): Promise<{ killed: number }>;
}
interface DesktopExecutionNodeHost {
  list(token: string): Promise<ExecutionNodeRecord[]>;
  killAll(token: string): Promise<{ killed: number }>;
}
declare global { interface Window { hummerExecutionNodes?: DesktopExecutionNodeHost } }

export function desktopExecutionNodePort(): ExecutionNodePort | undefined {
  if (typeof window === 'undefined' || !window.hummerExecutionNodes) return undefined;
  const host = window.hummerExecutionNodes;
  return {
    list: () => host.list(requireToken()),
    killAll: () => host.killAll(requireToken()),
  };
}
function requireToken(): string {
  const token = currentSessionToken();
  if (!token) throw new Error('Execution node access requires an authenticated session');
  return token;
}
