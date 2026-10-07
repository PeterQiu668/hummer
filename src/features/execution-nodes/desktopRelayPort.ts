import { currentSessionToken } from '../identity/identityClient';
import type { StartWorkDispatchIntentPort } from '../home/startWorkDispatch';
import type {
  RemoteRelayApprovalRequest,
  RemoteRelayNode,
  RemoteRelayTask,
} from './remoteRelayClient';
import { toExecutionNode, type ExecutionNodePort } from './executionNodeClient';

export interface DesktopRelayStatus {
  configured: boolean;
}

export interface DesktopRelayDecisionInput {
  requestId: string;
  decision: 'approved' | 'denied';
  rationale?: string;
}

export interface DesktopRelayRendererHost {
  status(): Promise<DesktopRelayStatus>;
  listNodes(token: string): Promise<readonly RemoteRelayNode[]>;
  enqueueTask(token: string, envelope: unknown): Promise<unknown>;
  listTasks(token: string): Promise<readonly RemoteRelayTask[]>;
  listApprovalRequests(token: string): Promise<readonly RemoteRelayApprovalRequest[]>;
  decideApproval(input: DesktopRelayDecisionInput & { token: string }): Promise<unknown>;
  revokeApproval(token: string, requestId: string): Promise<unknown>;
  stopTask(token: string, taskId: string): Promise<unknown>;
}

export interface DesktopRelayPort {
  listNodes(): Promise<readonly RemoteRelayNode[]>;
  enqueueTask(envelope: unknown): Promise<unknown>;
  listTasks(): Promise<readonly RemoteRelayTask[]>;
  listApprovalRequests(): Promise<readonly RemoteRelayApprovalRequest[]>;
  decideApproval(input: DesktopRelayDecisionInput): Promise<unknown>;
  revokeApproval(requestId: string): Promise<unknown>;
  stopTask(taskId: string): Promise<unknown>;
}

declare global {
  interface Window {
    hummerDesktopRelay?: DesktopRelayRendererHost;
  }
}

export async function isDesktopRelayConfigured(): Promise<boolean> {
  const host = relayHost();
  if (!host) return false;
  const status = await host.status();
  return status.configured === true;
}

export function desktopRelayPort(): DesktopRelayPort | undefined {
  const host = relayHost();
  if (!host) return undefined;
  return {
    listNodes: () => host.listNodes(requireToken()),
    enqueueTask: (envelope) => host.enqueueTask(requireToken(), envelope),
    listTasks: () => host.listTasks(requireToken()),
    listApprovalRequests: () => host.listApprovalRequests(requireToken()),
    decideApproval: (input) => host.decideApproval({ token: requireToken(), ...input }),
    revokeApproval: (requestId) => host.revokeApproval(requireToken(), requestId),
    stopTask: (taskId) => host.stopTask(requireToken(), taskId),
  };
}

export function desktopRelayExecutionNodePort(): Pick<ExecutionNodePort, 'list'> | undefined {
  const relay = desktopRelayPort();
  if (!relay) return undefined;
  return { list: async () => (await relay.listNodes()).map(toExecutionNode) };
}

export function desktopRelayStartWorkDispatchPort(): StartWorkDispatchIntentPort | undefined {
  const relay = desktopRelayPort();
  if (!relay) return undefined;
  return { record: async (intent) => { await relay.enqueueTask(intent.envelope); } };
}

function relayHost(): DesktopRelayRendererHost | undefined {
  return typeof window === 'undefined' ? undefined : window.hummerDesktopRelay;
}

function requireToken(): string {
  const token = currentSessionToken();
  if (!token) throw new Error('Desktop Relay requires an authenticated session');
  return token;
}
