import { currentSessionToken } from '../identity/identityClient';
import type { RemoteRelayClient, RemoteRelayNode } from './remoteRelayClient';

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

let configuredRemoteRelay: Pick<RemoteRelayClient, 'listNodes'> | null = null;

/** Browser Relay access is opt-in and keeps the badge inside the caller-owned client. */
export function configureRemoteRelayExecutionNodes(
  client: Pick<RemoteRelayClient, 'listNodes'>,
): () => void {
  configuredRemoteRelay = client;
  return () => {
    if (configuredRemoteRelay === client) configuredRemoteRelay = null;
  };
}

export function desktopExecutionNodePort(): ExecutionNodePort | undefined {
  if (typeof window !== 'undefined' && window.hummerExecutionNodes) {
    const host = window.hummerExecutionNodes;
    return {
      list: () => host.list(requireToken()),
      killAll: () => host.killAll(requireToken()),
    };
  }
  if (!configuredRemoteRelay) return undefined;
  const remoteRelay = configuredRemoteRelay;
  return {
    list: async () => (await remoteRelay.listNodes()).map(toExecutionNode),
    killAll: async () => {
      throw new Error('Remote Relay execution-node control is read-only');
    },
  };
}
function requireToken(): string {
  const token = currentSessionToken();
  if (!token) throw new Error('Execution node access requires an authenticated session');
  return token;
}

export function toExecutionNode(node: RemoteRelayNode): ExecutionNodeRecord {
  const runtimes = Array.isArray(node.manifest.runtimes) ? node.manifest.runtimes : [];
  const availableRuntime = runtimes.find((entry) => entry && typeof entry === 'object'
    && (entry as { available?: unknown }).available === true);
  const runtimeId = availableRuntime && typeof (availableRuntime as { kind?: unknown }).kind === 'string'
    ? (availableRuntime as { kind: string }).kind
    : 'unknown';
  const capabilities = Array.isArray(node.manifest.capabilities)
    ? node.manifest.capabilities.filter((entry): entry is string => typeof entry === 'string')
    : [];
  return {
    id: node.nodeId,
    tenantId: node.tenantId,
    displayName: node.nodeId,
    runtimeId,
    status: node.status,
    cwd: 'remote',
    permissionScope: capabilities.join(', ') || 'none',
    currentSessionId: null,
    lastSeenAt: node.lastSeenAt,
  };
}
