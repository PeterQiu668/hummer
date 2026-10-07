import { NodeAgentError } from './errors.mjs';

/** @typedef {{nodeId: string, tenantId?: string, grantToken?: string}} TransportContext */
/** @typedef {{initialDelayMs?: number, maxDelayMs?: number, maxAttempts?: number}} ReconnectOptions */
/** @typedef {{event: string, data: unknown, id?: string}} RelaySseEvent */

export class RelayClientError extends NodeAgentError {
  /**
   * @param {string} code
   * @param {string} message
   * @param {{statusCode?: number, retryable?: boolean}} [options]
   */
  constructor(code, message, options = {}) {
    super(code, message);
    this.name = 'RelayClientError';
    this.statusCode = options.statusCode;
    this.retryable = options.retryable ?? false;
  }
}

export class RelayHttpClient {
  /** @type {URL} */ #baseUrl;
  /** @type {string} */ #badgeToken;
  /** @type {typeof fetch} */ #fetch;
  /** @type {(delayMs: number) => Promise<void>} */ #sleep;
  /** @type {(entry: Readonly<Record<string, unknown>>) => void} */ #logger;
  /** @type {{initialDelayMs: number, maxDelayMs: number, maxAttempts: number}} */ #reconnect;

  /**
   * @param {{
   *   baseUrl: string,
   *   badgeToken: string,
   *   fetch?: typeof fetch,
   *   sleep?: (delayMs: number) => Promise<void>,
   *   logger?: (entry: Readonly<Record<string, unknown>>) => void,
   *   reconnect?: ReconnectOptions
   * }} options
   */
  constructor(options) {
    if (!options || typeof options !== 'object') throw new TypeError('Relay client options are required');
    if (typeof options.baseUrl !== 'string' || !options.baseUrl.trim()) throw new TypeError('Relay baseUrl is required');
    const baseUrl = new URL(options.baseUrl);
    if (!['http:', 'https:'].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password) {
      throw new TypeError('Relay baseUrl must be an HTTP(S) URL without credentials');
    }
    if (baseUrl.protocol === 'http:' && !isLoopbackHost(baseUrl.hostname)) {
      throw new TypeError('Plain HTTP Relay endpoints are allowed only on loopback');
    }
    if (typeof options.badgeToken !== 'string' || !options.badgeToken.trim()) throw new TypeError('Opaque Relay badge token is required');
    const initialDelayMs = options.reconnect?.initialDelayMs ?? 250;
    const maxDelayMs = options.reconnect?.maxDelayMs ?? 15_000;
    const maxAttempts = options.reconnect?.maxAttempts ?? 8;
    if (!Number.isFinite(initialDelayMs) || initialDelayMs < 0) throw new TypeError('initialDelayMs must be non-negative');
    if (!Number.isFinite(maxDelayMs) || maxDelayMs < initialDelayMs) throw new TypeError('maxDelayMs must be at least initialDelayMs');
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
      throw new TypeError('maxAttempts must be a positive finite integer');
    }
    this.#baseUrl = baseUrl;
    this.#badgeToken = options.badgeToken;
    this.#fetch = options.fetch ?? globalThis.fetch;
    if (typeof this.#fetch !== 'function') throw new TypeError('A fetch implementation is required');
    this.#sleep = options.sleep ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
    this.#logger = options.logger ?? (() => undefined);
    this.#reconnect = { initialDelayMs, maxDelayMs, maxAttempts };
  }

  /** @param {unknown} manifest @param {TransportContext} context */
  async registerNode(manifest, context) {
    return this.#request('POST', '/v1/nodes/register', manifest, context);
  }

  /** @param {unknown} manifest @param {TransportContext} context */
  async sendHeartbeat(manifest, context) {
    return this.#request('POST', `/v1/nodes/${segment(context.nodeId)}/heartbeat`, manifest, context);
  }

  /** @param {TransportContext} context */
  async claimTask(context) {
    const response = await this.#request('POST', `/v1/nodes/${segment(context.nodeId)}/tasks/claim`, undefined, context, true);
    if (response === null) return null;
    const task = requireRecord(requireRecord(response, 'claim response').task, 'claim task');
    const taskId = requireString(task.taskId, 'claim taskId');
    if (!Object.hasOwn(task, 'envelope')) throw new RelayClientError('invalid_relay_response', 'Relay claim is missing its task envelope');
    return { claimId: taskId, deliveryId: taskId, envelope: task.envelope };
  }

  /** Pending status is local-only; execution events are sent through submitRunEvent. */
  async reportClaimStatus() {}

  /** @param {unknown} event @param {TransportContext} context */
  async submitRunEvent(event, context) {
    const type = requireString(requireRecord(event, 'run event').type, 'run event type');
    if (type === 'started') return this.ackTask(event, context);
    if (type === 'completed') return this.completeTask(event, context);
    if (type === 'failed') return this.failTask(event, context);
    return this.sendTaskEvent(event, context);
  }

  /** @param {unknown} event @param {TransportContext} context */
  async ackTask(event, context) {
    return this.#request('POST', '/v1/tasks/ack', event, context);
  }

  /** @param {unknown} event @param {TransportContext} context */
  async sendTaskEvent(event, context) {
    return this.#request('POST', '/v1/tasks/events', event, context);
  }

  /** @param {unknown} event @param {TransportContext} context */
  async completeTask(event, context) {
    return this.#request('POST', '/v1/tasks/complete', event, context);
  }

  /** @param {unknown} event @param {TransportContext} context */
  async failTask(event, context) {
    return this.#request('POST', '/v1/tasks/fail', event, context);
  }

  /** @param {string} taskId @param {unknown} request @param {TransportContext} context */
  async submitApprovalRequest(taskId, request, context) {
    const response = requireRecord(await this.#request(
      'POST',
      `/v1/nodes/${segment(context.nodeId)}/tasks/${segment(taskId)}/approval-requests`,
      request,
      context,
    ), 'approval request response');
    return requireRecord(response.request, 'approval request record').request;
  }

  /** @param {string} requestId @param {unknown} decision */
  async decideApproval(requestId, decision) {
    const response = requireRecord(await this.#request(
      'POST', `/v1/approval-requests/${segment(requestId)}/decision`, decision,
    ), 'approval decision response');
    return requireRecord(response.decision, 'approval decision record').decisionRecord;
  }

  /** @param {string} taskId @param {string} requestId @param {TransportContext} context */
  async consumeApprovalDecision(taskId, requestId, context) {
    return this.#request(
      'POST',
      `/v1/nodes/${segment(context.nodeId)}/tasks/${segment(taskId)}/approval-requests/${segment(requestId)}/consume`,
      undefined,
      context,
    );
  }

  /** Outcome receipts remain owned by HUMMER and are not persisted by Relay. */
  async submitReceipt() {}

  /** @param {string} taskId */
  async stopTask(taskId) {
    return this.#request('POST', `/v1/tasks/${segment(taskId)}/stop`);
  }

  /** Publishes an already approved immutable eight-file bundle through a control badge. */
  async publishTrustedBundle(bundle) {
    return this.#request('POST', '/v1/trusted-bundles', bundle);
  }

  /** Downloads a node-bound bundle without writing to the filesystem. */
  async fetchTrustedBundle(bundleId, context) {
    const response = requireRecord(await this.#request(
      'GET', `/v1/nodes/${segment(context.nodeId)}/trusted-bundles/${segment(bundleId)}`, undefined, context,
    ), 'trusted bundle response');
    if (!Object.hasOwn(response, 'bundle')) throw new RelayClientError('invalid_relay_response', 'Relay trusted bundle response is missing bundle');
    return response.bundle;
  }

  /**
   * @param {{nodeId: string, onEvent?: (event: RelaySseEvent) => void|Promise<void>, onError?: (error: unknown) => void}} options
   */
  connectEvents(options) {
    const nodeId = requireString(options?.nodeId, 'nodeId');
    const controller = new AbortController();
    /** @type {(value?: unknown) => void} */
    let readyResolve = () => undefined;
    /** @type {(reason?: unknown) => void} */
    let readyReject = () => undefined;
    let readySettled = false;
    const ready = new Promise((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    });
    /** @param {unknown} [error] */
    const settleReady = (error) => {
      if (readySettled) return;
      readySettled = true;
      if (error === undefined) readyResolve(); else readyReject(error);
    };
    const done = this.#runEventLoop(nodeId, controller.signal, async (event) => {
      await options.onEvent?.(event);
    }, settleReady).catch((error) => {
      settleReady(error);
      options.onError?.(error);
      throw error;
    });
    return {
      ready,
      done,
      close: () => controller.abort(),
    };
  }

  /**
   * @param {{nodeId: string, pollOnce(): Promise<unknown>, stopClaim(claimId: string): unknown}} agent
   * @param {{onState?: (state: unknown) => void|Promise<void>, onError?: (error: unknown) => void}} [options]
   */
  connectAgent(agent, options = {}) {
    return this.connectEvents({
      nodeId: requireString(agent?.nodeId, 'agent nodeId'),
      onError: options.onError,
      onEvent: async ({ event, data }) => {
        if (event === 'task.available') {
          const state = await agent.pollOnce();
          await options.onState?.(state);
          return;
        }
        if (event === 'task.stop') {
          const taskId = requireString(requireRecord(data, 'task.stop data').taskId, 'task.stop taskId');
          const state = agent.stopClaim(taskId);
          await options.onState?.(state);
        }
      },
    });
  }

  /**
   * @param {string} nodeId
   * @param {AbortSignal} signal
   * @param {(event: RelaySseEvent) => Promise<void>} onEvent
   * @param {(error?: unknown) => void} settleReady
   */
  async #runEventLoop(nodeId, signal, onEvent, settleReady) {
    let attempt = 0;
    while (!signal.aborted) {
      attempt += 1;
      if (attempt > this.#reconnect.maxAttempts) {
        throw new RelayClientError('relay_reconnect_exhausted', 'Relay event reconnect attempts were exhausted');
      }
      try {
        const response = await this.#fetch(this.#url(`/v1/nodes/${segment(nodeId)}/events`), {
          method: 'GET', headers: this.#headers(false), signal,
        });
        if (!response.ok) throw await responseError(response, this.#badgeToken);
        if (!response.body) throw new RelayClientError('invalid_relay_response', 'Relay event stream has no response body', { retryable: true });
        this.#logger({ event: 'relay.stream.connected', attempt, statusCode: response.status });
        settleReady();
        await readSse(response.body, onEvent, signal);
        if (signal.aborted) break;
      } catch (error) {
        if (signal.aborted || isAbortError(error)) break;
        const normalized = normalizeNetworkError(error);
        if (!normalized.retryable) throw normalized;
        this.#logger({ event: 'relay.stream.disconnected', attempt, code: normalized.code });
      }
      if (attempt >= this.#reconnect.maxAttempts) {
        throw new RelayClientError('relay_reconnect_exhausted', 'Relay event reconnect attempts were exhausted');
      }
      const delay = Math.min(this.#reconnect.maxDelayMs, this.#reconnect.initialDelayMs * (2 ** (attempt - 1)));
      await this.#sleep(delay);
    }
  }

  /**
   * @param {'POST'|'GET'} method
   * @param {string} path
   * @param {unknown} [body]
   * @param {TransportContext} [_context]
   * @param {boolean} [allowEmpty]
   */
  async #request(method, path, body, _context, allowEmpty = false) {
    let response;
    try {
      response = await this.#fetch(this.#url(path), {
        method,
        headers: this.#headers(body !== undefined),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      throw normalizeNetworkError(error);
    }
    if (allowEmpty && response.status === 204) return null;
    if (!response.ok) throw await responseError(response, this.#badgeToken);
    if (response.status === 204) return null;
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new RelayClientError('invalid_relay_response', 'Relay returned invalid JSON');
    }
  }

  /** @param {string} path */
  #url(path) {
    return new URL(path.replace(/^\//, ''), ensureTrailingSlash(this.#baseUrl)).toString();
  }

  /** @param {boolean} json */
  #headers(json) {
    return {
      authorization: `Bearer ${this.#badgeToken}`,
      accept: 'application/json, text/event-stream',
      ...(json ? { 'content-type': 'application/json' } : {}),
    };
  }
}

/** @param {string} hostname */
function isLoopbackHost(hostname) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

/** @param {URL} url */
function ensureTrailingSlash(url) {
  const value = new URL(url);
  if (!value.pathname.endsWith('/')) value.pathname += '/';
  return value;
}

/** @param {unknown} value @param {string} label */
function requireRecord(value, label) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RelayClientError('invalid_relay_response', `${label} must be an object`);
  }
  return /** @type {Record<string, unknown>} */ (value);
}

/** @param {unknown} value @param {string} label */
function requireString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new RelayClientError('invalid_relay_response', `${label} must be a non-empty string`);
  return value;
}

/** @param {string} value */
function segment(value) {
  return encodeURIComponent(requireString(value, 'path identifier'));
}

/** @param {Response} response @param {string} secret */
async function responseError(response, secret) {
  let code = 'relay_request_failed';
  let message = `Relay request failed with status ${response.status}`;
  try {
    const body = requireRecord(await response.json(), 'Relay error');
    const error = requireRecord(body.error, 'Relay error detail');
    if (typeof error.code === 'string' && error.code.trim() && !error.code.includes(secret)) code = error.code;
    if (typeof error.message === 'string' && error.message.trim()) message = error.message.replaceAll(secret, '[REDACTED]');
  } catch {
    // Keep the status-only safe error. Never include request headers or credentials.
  }
  const retryable = response.status >= 500 || response.status === 408 || response.status === 429;
  return new RelayClientError(code, message, { statusCode: response.status, retryable });
}

/** @param {unknown} error */
function normalizeNetworkError(error) {
  if (error instanceof RelayClientError) return error;
  return new RelayClientError('relay_network_error', 'Relay network request failed', { retryable: true });
}

/** @param {unknown} error */
function isAbortError(error) {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError';
}

/**
 * @param {ReadableStream<Uint8Array>} body
 * @param {(event: RelaySseEvent) => Promise<void>} onEvent
 * @param {AbortSignal} signal
 */
async function readSse(body, onEvent, signal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const cancelOnAbort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancelOnAbort, { once: true });
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replaceAll('\r\n', '\n');
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const event = parseSseFrame(frame);
        if (event) await onEvent(event);
      }
    }
  } finally {
    signal.removeEventListener('abort', cancelOnAbort);
    await reader.cancel().catch(() => undefined);
  }
}

/** @param {string} frame */
function parseSseFrame(frame) {
  let event = 'message';
  let id;
  const data = [];
  for (const line of frame.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    const separator = line.indexOf(':');
    const field = separator < 0 ? line : line.slice(0, separator);
    const value = separator < 0 ? '' : line.slice(separator + 1).replace(/^ /, '');
    if (field === 'event') event = value;
    else if (field === 'id') id = value;
    else if (field === 'data') data.push(value);
  }
  if (data.length === 0) return null;
  const text = data.join('\n');
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new RelayClientError('invalid_sse_event', 'Relay event contained invalid JSON');
  }
  return { event, data: value, ...(id === undefined ? {} : { id }) };
}
