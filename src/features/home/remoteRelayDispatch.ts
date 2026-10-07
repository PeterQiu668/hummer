import { configureRemoteRelayExecutionNodes } from '../execution-nodes/executionNodeClient';
import {
  RemoteRelayClient,
  type RemoteRelayApprovalRequest,
  type RemoteRelayClientOptions,
  type RemoteRelayNode,
} from '../execution-nodes/remoteRelayClient';
import type { StartWorkDispatchIntentPort } from './startWorkDispatch';
import type { BatchDispatchNode, BatchDispatchPort, BatchRuntime } from './batchDispatch';
import type { FleetControlPort } from './FleetControlPanel';
import { currentIdentity } from '../identity/identityClient';
import {
  configureRemoteCapabilityCatalog,
  type CapabilityInstallerBoundary,
} from '../capabilities/capabilityCatalogClient';
import {
  configureRemotePublicMarketplace,
  type PublicCapabilityInstallerBoundary,
} from '../capabilities/publicMarketClient';

export type RemoteRelayDeploymentConfig = Pick<RemoteRelayClientOptions, 'baseUrl' | 'getBadge'> & {
  /** Optional trusted host/service boundary; omitting it keeps the catalog read-only. */
  capabilityInstaller?: CapabilityInstallerBoundary;
  /** Optional trusted public-package installer; omitting it keeps the public market read-only. */
  publicCapabilityInstaller?: PublicCapabilityInstallerBoundary;
};

declare global {
  interface Window {
    /** One-shot browser deployment injection, consumed before React renders. */
    hummerRemoteRelayDeployment?: RemoteRelayDeploymentConfig;
  }
}

let deployment: {
  client: RemoteRelayClient;
  disposeExecutionNodes: () => void;
  disposeCapabilityCatalog: () => void;
  disposePublicMarketplace: () => void;
} | null = null;

/**
 * Deployment-only in-memory injection. Call before rendering the web app.
 * Neither the base URL nor the badge provider is inferred from URL/localStorage.
 */
export function configureRemoteRelayDeployment(config: RemoteRelayDeploymentConfig): () => void {
  const client = new RemoteRelayClient(config);
  deployment?.disposeExecutionNodes();
  deployment?.disposeCapabilityCatalog();
  deployment?.disposePublicMarketplace();
  const current = {
    client,
    disposeExecutionNodes: configureRemoteRelayExecutionNodes(client),
    disposeCapabilityCatalog: configureRemoteCapabilityCatalog(client, config.capabilityInstaller),
    disposePublicMarketplace: configureRemotePublicMarketplace(client, config.publicCapabilityInstaller),
  };
  deployment = current;
  return () => {
    if (deployment !== current) return;
    current.disposeExecutionNodes();
    current.disposeCapabilityCatalog();
    current.disposePublicMarketplace();
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

export function remoteFleetControlPort(): FleetControlPort | undefined {
  const client = deployment?.client;
  if (!client) return undefined;
  return {
    listTasks: () => client.listTasks(),
    listApprovalRequests: () => client.listApprovalRequests(),
    async decideApproval(input) {
      const identity = currentIdentity();
      if (!identity) throw new Error('当前没有有效的身份会话。');
      const request = await client.getApprovalRequest(input.requestId);
      const requestedScope = scopeFromRequest(request);
      const decision = {
        schema: 'hummer.approval-decision',
        version: 1,
        decisionId: `decision-${crypto.randomUUID()}`,
        requestId: input.requestId,
        tenantId: identity.tenant.id,
        deciderActorRef: `human:${identity.membership.humanUserId}`,
        decidedAt: new Date().toISOString(),
        decision: input.decision,
        ...(input.rationale ? { rationale: input.rationale } : {}),
        ...(input.decision === 'approved' ? { grantedScope: requestedScope } : {}),
      };
      return client.decideApproval(input.requestId, decision);
    },
    stopTask: (taskId) => client.stopTask(taskId),
  };
}

function scopeFromRequest(request: RemoteRelayApprovalRequest): Record<string, unknown> {
  const scope = request.requestedScope
    ?? (request.request && typeof request.request === 'object' ? request.request.requestedScope : undefined);
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
    throw new Error('Relay 审批请求缺少受控授权范围。');
  }
  const expiresAt = typeof request.expiresAt === 'string'
    ? request.expiresAt
    : (typeof request.request?.expiresAt === 'string' ? request.request.expiresAt : undefined);
  if (!expiresAt) throw new Error('Relay 审批请求缺少授权到期时间。');
  return { ...(scope as Record<string, unknown>), expiresAt };
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
