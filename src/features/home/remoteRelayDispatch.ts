import { configureRemoteRelayExecutionNodes } from '../execution-nodes/executionNodeClient';
import {
  RemoteRelayClient,
  type RemoteRelayClientOptions,
  type RemoteRelayNode,
} from '../execution-nodes/remoteRelayClient';
import type { StartWorkDispatchIntentPort } from './startWorkDispatch';
import type { BatchDispatchNode, BatchDispatchPort, BatchRuntime } from './batchDispatch';

export type RemoteRelayDeploymentConfig = Pick<RemoteRelayClientOptions, 'baseUrl' | 'getBadge'>;

declare global {
  interface Window {
    /** One-shot browser deployment injection, consumed before React renders. */
    hummerRemoteRelayDeployment?: RemoteRelayDeploymentConfig;
  }
}

let deployment: {
  client: RemoteRelayClient;
  disposeExecutionNodes: () => void;
} | null = null;

/**
 * Deployment-only in-memory injection. Call before rendering the web app.
 * Neither the base URL nor the badge provider is inferred from URL/localStorage.
 */
export function configureRemoteRelayDeployment(config: RemoteRelayDeploymentConfig): () => void {
  const client = new RemoteRelayClient(config);
  deployment?.disposeExecutionNodes();
  const current = {
    client,
    disposeExecutionNodes: configureRemoteRelayExecutionNodes(client),
  };
  deployment = current;
  return () => {
    if (deployment !== current) return;
    current.disposeExecutionNodes();
    deployment = null;
  };
}

export function consumeInjectedRemoteRelayDeployment(): (() => void) | undefined {
  if (typeof window === 'undefined' || window.hummerDesktop || !window.hummerRemoteRelayDeployment) {
    return undefined;
  }
  const config = window.hummerRemoteRelayDeployment;
  window.hummerRemoteRelayDeployment = undefined;
  return configureRemoteRelayDeployment(config);
}

export function remoteStartWorkDispatchPort(): StartWorkDispatchIntentPort | undefined {
  const client = deployment?.client;
  if (!client) return undefined;
  return {
    async record(intent) {
      await client.enqueueTask(intent.envelope);
    },
  };
}

export function remoteBatchDispatchPort(): BatchDispatchPort | undefined {
  const client = deployment?.client;
  if (!client) return undefined;
  return {
    listNodes: async () => (await client.listNodes()).flatMap(toBatchNode),
    enqueueBatch: (envelopes) => client.enqueueBatch(envelopes),
  };
}

function toBatchNode(node: RemoteRelayNode): BatchDispatchNode[] {
  const runtimes = Array.isArray(node.manifest.runtimes) ? node.manifest.runtimes : [];
  const runtime = runtimes
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
    .find((entry) => entry.available === true && isBatchRuntime(entry.kind));
  if (!runtime) return [];
  return [{ id: node.nodeId, label: node.nodeId, runtime: runtime.kind as BatchRuntime, status: node.status }];
}

function isBatchRuntime(value: unknown): value is BatchRuntime {
  return value === 'codex' || value === 'claude' || value === 'deepseek'
    || value === 'cli-other' || value === 'gui-exec';
}
