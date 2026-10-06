export interface RemoteRelayNode {
  nodeId: string;
  tenantId: string;
  status: 'online' | 'offline';
  lastSeenAt: string;
  manifest: Record<string, unknown>;
}

export interface RemoteRelayTask {
  taskId: string;
  tenantId: string;
  status: 'queued' | 'leased' | 'blocked' | 'completed' | 'failed';
  envelope: Record<string, unknown>;
  [key: string]: unknown;
}

export interface RemoteRelayApprovalRequest {
  requestId: string;
  tenantId: string;
  taskId: string;
  request: Record<string, unknown>;
  [key: string]: unknown;
}

export interface RemoteRelayClientOptions {
  baseUrl: string;
  getBadge: () => string | null;
  fetch?: typeof fetch;
}

export interface RemoteRelayBatchSuccess {
  index: number;
  ok: true;
  result: unknown;
}

export interface RemoteRelayBatchFailure {
  index: number;
  ok: false;
  status: number;
  code: string;
  message: string;
}

export type RemoteRelayBatchResult = RemoteRelayBatchSuccess | RemoteRelayBatchFailure;

export class RemoteRelayError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RemoteRelayError';
  }
}

export class RemoteRelayClient {
  readonly #baseUrl: string;
  readonly #getBadge: () => string | null;
  readonly #fetch: typeof fetch;

  constructor(options: RemoteRelayClientOptions) {
    const baseUrl = new URL(options.baseUrl);
    if (baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
      throw new Error('Remote Relay URL must not contain credentials, query, or fragment');
    }
    this.#baseUrl = baseUrl.toString().replace(/\/$/, '');
    this.#getBadge = options.getBadge;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async listNodes(): Promise<readonly RemoteRelayNode[]> {
    return (await this.request<{ nodes: RemoteRelayNode[] }>('/v1/control/nodes')).nodes;
  }

  async getNode(nodeId: string): Promise<RemoteRelayNode> {
    return (await this.request<{ node: RemoteRelayNode }>(`/v1/control/nodes/${encodeURIComponent(nodeId)}`)).node;
  }

  async listTasks(): Promise<readonly RemoteRelayTask[]> {
    return (await this.request<{ tasks: RemoteRelayTask[] }>('/v1/control/tasks')).tasks;
  }

  async getTask(taskId: string): Promise<RemoteRelayTask> {
    return (await this.request<{ task: RemoteRelayTask }>(`/v1/control/tasks/${encodeURIComponent(taskId)}`)).task;
  }

  async listApprovalRequests(): Promise<readonly RemoteRelayApprovalRequest[]> {
    return (await this.request<{ approvalRequests: RemoteRelayApprovalRequest[] }>('/v1/control/approval-requests')).approvalRequests;
  }

  async getApprovalRequest(requestId: string): Promise<RemoteRelayApprovalRequest> {
    return (await this.request<{ approvalRequest: RemoteRelayApprovalRequest }>(
      `/v1/control/approval-requests/${encodeURIComponent(requestId)}`,
    )).approvalRequest;
  }

  enqueueTask(envelope: unknown): Promise<unknown> {
    return this.request('/v1/tasks/enqueue', {
      method: 'POST',
      body: JSON.stringify(envelope),
    });
  }

  async enqueueBatch(envelopes: readonly unknown[]): Promise<readonly RemoteRelayBatchResult[]> {
    const results: RemoteRelayBatchResult[] = [];
    for (let index = 0; index < envelopes.length; index += 1) {
      try {
        results.push({ index, ok: true, result: await this.enqueueTask(envelopes[index]) });
      } catch (error) {
        if (error instanceof RemoteRelayError) {
          results.push({ index, ok: false, status: error.status, code: error.code, message: error.message });
        } else {
          results.push({ index, ok: false, status: 0, code: 'network_error', message: 'Relay request failed' });
        }
      }
    }
    return results;
  }

  private async request<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    const badge = this.#getBadge();
    if (!badge) throw new RemoteRelayError(401, 'missing_token', 'Relay badge is required');
    const response = await this.#fetch(`${this.#baseUrl}${path}`, {
      ...init,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${badge}`,
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...init.headers,
      },
    });
    const payload = await parseResponse(response);
    if (!response.ok) {
      const error = asErrorPayload(payload);
      throw new RemoteRelayError(response.status, error.code, error.message);
    }
    return payload as T;
  }
}

async function parseResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new RemoteRelayError(response.status, 'invalid_response', 'Relay returned an invalid response');
  }
}

function asErrorPayload(payload: unknown): { code: string; message: string } {
  if (!payload || typeof payload !== 'object' || !('error' in payload)) {
    return { code: 'relay_error', message: 'Relay request was rejected' };
  }
  const error = (payload as { error?: unknown }).error;
  if (!error || typeof error !== 'object') {
    return { code: 'relay_error', message: 'Relay request was rejected' };
  }
  const candidate = error as { code?: unknown; message?: unknown };
  return {
    code: typeof candidate.code === 'string' ? candidate.code : 'relay_error',
    message: typeof candidate.message === 'string' ? candidate.message : 'Relay request was rejected',
  };
}
