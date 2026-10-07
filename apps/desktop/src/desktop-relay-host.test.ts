import { afterEach, describe, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      electron.handlers.set(channel, handler);
    }),
    removeHandler: vi.fn((channel: string) => { electron.handlers.delete(channel); }),
  },
}));

vi.mock('electron', () => ({ ipcMain: electron.ipcMain }));

import {
  DESKTOP_RELAY_CHANNELS,
  DesktopRelayError,
  consumeDesktopRelayTrustedConfig,
  readDesktopRelayTrustedConfig,
  registerDesktopRelayHost,
  type DesktopRelayHostRegistration,
} from './desktop-relay-host.js';

const registrations: DesktopRelayHostRegistration[] = [];
const BADGE = 'opaque-main-only-badge-value';
const TENANT = 'tenant-a';
const ACTOR = 'account:account-a';
const TOKEN = 'desktop-session-token';
const NOW = new Date('2026-10-07T08:00:00.000Z');

afterEach(() => {
  registrations.splice(0).forEach((registration) => registration.close());
  electron.handlers.clear();
  vi.clearAllMocks();
});

describe('trusted Desktop Relay main-process bridge', () => {
  it('requires a complete trusted config and rejects plaintext non-loopback URLs', () => {
    expect(readDesktopRelayTrustedConfig({})).toBeNull();
    expect(() => readDesktopRelayTrustedConfig({ HUMMER_RELAY_BASE_URL: 'https://relay.example.test' }))
      .toThrow('configuration is incomplete');
    expect(() => register({ baseUrl: 'http://relay.example.test' })).toThrow('must use HTTPS');
    expect(() => register({ baseUrl: 'file:///relay' })).toThrow('must use HTTPS');
    expect(() => register({ baseUrl: 'https://user:pass@relay.example.test' })).toThrow('must not contain credentials');
    expect(() => register({ baseUrl: 'http://127.0.0.1:8787' })).not.toThrow();
  });

  it('consumes the badge environment entry immediately after trusted bootstrap', () => {
    const env = {
      HUMMER_RELAY_BASE_URL: 'https://relay.example.test',
      HUMMER_RELAY_BADGE_TOKEN: BADGE,
      HUMMER_RELAY_TENANT_ID: TENANT,
      HUMMER_RELAY_ACTOR_REF: ACTOR,
    } as NodeJS.ProcessEnv;

    expect(consumeDesktopRelayTrustedConfig(env)).toEqual({
      baseUrl: 'https://relay.example.test', badgeToken: BADGE, tenantId: TENANT, actorRef: ACTOR,
    });
    expect(env.HUMMER_RELAY_BADGE_TOKEN).toBeUndefined();
  });

  it('authenticates local and remote identities before serving the complete renderer control port', async () => {
    const requests: Array<{ url: string; init: RequestInit; body: unknown }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      const body = typeof init.body === 'string' ? JSON.parse(init.body) as unknown : undefined;
      requests.push({ url, init, body });
      expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${BADGE}`);
      if (url.endsWith('/v1/control/session')) return json({ session: { tenantId: TENANT, actorRef: ACTOR } });
      if (url.endsWith('/v1/control/nodes')) return json({ nodes: [node()] });
      if (url.endsWith('/v1/tasks/enqueue')) return json({ task: task('task-1', body as Record<string, unknown>), inserted: true });
      if (url.endsWith('/v1/control/tasks')) return json({ tasks: [task()] });
      if (url.endsWith('/v1/control/approval-requests')) return json({ approvalRequests: [approval()] });
      if (url.endsWith('/v1/control/approval-requests/request-1')) return json({ approvalRequest: approval() });
      if (url.endsWith('/v1/approval-requests/request-1/decision')) {
        return json({ decision: { ...(body as Record<string, unknown>), createdAt: NOW.toISOString() } });
      }
      if (url.endsWith('/v1/approval-requests/request-1/revoke')) {
        return json({ revocation: { tenantId: TENANT, requestId: 'request-1', actorRef: ACTOR, revokedAt: NOW.toISOString() } });
      }
      if (url.endsWith('/v1/control/tasks/task-1')) return json({ task: task() });
      if (url.endsWith('/v1/tasks/task-1/stop')) return json({ task: { ...task(), status: 'blocked' } });
      throw new Error(`unexpected ${url}`);
    });
    const registration = register({ fetch: fetchMock as typeof fetch });

    expect(await invoke(DESKTOP_RELAY_CHANNELS.status)).toEqual({ configured: true });
    expect(await invoke(DESKTOP_RELAY_CHANNELS.listNodes, TOKEN)).toEqual([node()]);
    expect(await invoke(DESKTOP_RELAY_CHANNELS.enqueueTask, TOKEN, envelope())).toMatchObject({ inserted: true });
    expect(await invoke(DESKTOP_RELAY_CHANNELS.listTasks, TOKEN)).toEqual([task()]);
    expect(await invoke(DESKTOP_RELAY_CHANNELS.listApprovalRequests, TOKEN)).toEqual([approval()]);
    expect(await invoke(DESKTOP_RELAY_CHANNELS.decideApproval, {
      token: TOKEN, requestId: 'request-1', decision: 'approved', rationale: 'Reviewed by the signed-in account.',
    })).toMatchObject({ decision: { requestId: 'request-1', deciderActorRef: ACTOR, decision: 'approved' } });
    expect(await invoke(DESKTOP_RELAY_CHANNELS.revokeApproval, TOKEN, 'request-1'))
      .toMatchObject({ revocation: { requestId: 'request-1', actorRef: ACTOR } });
    expect(await invoke(DESKTOP_RELAY_CHANNELS.stopTask, TOKEN, 'task-1')).toMatchObject({ task: { status: 'blocked' } });

    const decisionRequest = requests.find((entry) => entry.url.endsWith('/v1/approval-requests/request-1/decision'));
    expect(decisionRequest?.body).toEqual({
      schema: 'hummer.approval-decision', version: 1, decisionId: 'decision-test',
      requestId: 'request-1', tenantId: TENANT, deciderActorRef: ACTOR,
      decidedAt: NOW.toISOString(), decision: 'approved', rationale: 'Reviewed by the signed-in account.',
      grantedScope: {
        capabilities: ['task.execute'], paths: ['outputs/report.md'], maxUses: 1,
        expiresAt: '2026-10-07T08:30:00.000Z',
      },
    });
    expect(JSON.stringify(requests.map((entry) => entry.body))).not.toContain(BADGE);
    expect(JSON.stringify(await invoke(DESKTOP_RELAY_CHANNELS.listTasks, TOKEN))).not.toContain(BADGE);
    registration.close();
  });

  it('rejects local tenant or actor mismatch before any network request', async () => {
    const fetchMock = vi.fn();
    const tenantMismatch = register({ fetch: fetchMock as typeof fetch, resolveIdentity: () => ({ tenantId: 'tenant-b', actorRef: ACTOR }) });
    await expect(invoke(DESKTOP_RELAY_CHANNELS.enqueueTask, TOKEN, envelope())).rejects.toMatchObject({ code: 'identity_mismatch' });
    expect(fetchMock).not.toHaveBeenCalled();
    tenantMismatch.close();

    const actorMismatch = register({ fetch: fetchMock as typeof fetch, resolveIdentity: () => ({ tenantId: TENANT, actorRef: 'account:other' }) });
    await expect(invoke(DESKTOP_RELAY_CHANNELS.stopTask, TOKEN, 'task-1')).rejects.toMatchObject({ code: 'identity_mismatch' });
    expect(fetchMock).not.toHaveBeenCalled();
    actorMismatch.close();
  });

  it('blocks a remotely mismatched badge identity before enqueue, decision, or stop mutation', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => json({ session: { tenantId: 'tenant-b', actorRef: ACTOR } }));
    register({ fetch: fetchMock as typeof fetch });

    for (const call of [
      () => invoke(DESKTOP_RELAY_CHANNELS.enqueueTask, TOKEN, envelope()),
      () => invoke(DESKTOP_RELAY_CHANNELS.decideApproval, { token: TOKEN, requestId: 'request-1', decision: 'denied' }),
      () => invoke(DESKTOP_RELAY_CHANNELS.stopTask, TOKEN, 'task-1'),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: 'relay_identity_mismatch' });
    }
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.every(([url]) => String(url).endsWith('/v1/control/session'))).toBe(true);
  });

  it('rejects cross-tenant nested task and approval bytes instead of returning them', async () => {
    const replies = [
      json({ session: { tenantId: TENANT, actorRef: ACTOR } }),
      json({ tasks: [{ ...task(), envelope: { ...envelope(), tenantId: 'tenant-b' } }] }),
      json({ session: { tenantId: TENANT, actorRef: ACTOR } }),
      json({ approvalRequests: [{
        ...approval(),
        request: { ...(approval().request as Record<string, unknown>), tenantId: 'tenant-b' },
      }] }),
    ];
    register({ fetch: vi.fn(async () => replies.shift()!) as typeof fetch });

    await expect(invoke(DESKTOP_RELAY_CHANNELS.listTasks, TOKEN)).rejects.toMatchObject({ code: 'tenant_mismatch' });
    await expect(invoke(DESKTOP_RELAY_CHANNELS.listApprovalRequests, TOKEN)).rejects.toMatchObject({ code: 'tenant_mismatch' });
  });

  it('does not accept renderer-provided scope and does not decide an expired request', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/v1/control/session')) return json({ session: { tenantId: TENANT, actorRef: ACTOR } });
      return json({ approvalRequest: approval({ expiresAt: '2026-10-07T07:59:59.000Z' }) });
    });
    register({ fetch: fetchMock as typeof fetch });

    await expect(invoke(DESKTOP_RELAY_CHANNELS.decideApproval, {
      token: TOKEN, requestId: 'request-1', decision: 'approved',
      grantedScope: { capabilities: ['workspace.admin'] },
    })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(fetchMock).not.toHaveBeenCalled();

    await expect(invoke(DESKTOP_RELAY_CHANNELS.decideApproval, {
      token: TOKEN, requestId: 'request-1', decision: 'approved',
    })).rejects.toMatchObject({ code: 'approval_expired' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/decision'))).toBe(false);
  });

  it('redacts the main-only badge from Relay errors and rejects untrusted subframes', async () => {
    const fetchMock = vi.fn(async () => json({ error: { code: 'bad', message: `do not echo ${BADGE}` } }, 403));
    register({ fetch: fetchMock as typeof fetch });

    let failure: unknown;
    try { await invoke(DESKTOP_RELAY_CHANNELS.listNodes, TOKEN); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(DesktopRelayError);
    expect(String((failure as Error).message)).not.toContain(BADGE);
    expect((failure as Error).message).toContain('[redacted]');

    await expect(invokeFrom({ senderFrame: { parent: {} } }, DESKTOP_RELAY_CHANNELS.listNodes, TOKEN))
      .rejects.toMatchObject({ code: 'untrusted_frame' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a successful Relay response that attempts to echo the main-only badge', async () => {
    const fetchMock = vi.fn(async () => json({
      session: { tenantId: TENANT, actorRef: ACTOR }, debug: BADGE,
    }));
    register({ fetch: fetchMock as typeof fetch });

    let failure: unknown;
    try { await invoke(DESKTOP_RELAY_CHANNELS.listNodes, TOKEN); } catch (error) { failure = error; }
    expect(failure).toMatchObject({ code: 'invalid_response' });
    expect((failure as Error).message).not.toContain(BADGE);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

function register(overrides: {
  baseUrl?: string;
  fetch?: typeof fetch;
  resolveIdentity?: (token: string) => { tenantId: string; actorRef: string };
} = {}): DesktopRelayHostRegistration {
  const registration = registerDesktopRelayHost({
    config: {
      baseUrl: overrides.baseUrl ?? 'https://relay.example.test',
      badgeToken: BADGE,
      tenantId: TENANT,
      actorRef: ACTOR,
    },
    resolveIdentity: overrides.resolveIdentity ?? (() => ({ tenantId: TENANT, actorRef: ACTOR })),
    fetch: overrides.fetch,
    now: () => NOW,
    decisionIdFactory: () => 'decision-test',
  });
  registrations.push(registration);
  return registration;
}

function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  return invokeFrom({ senderFrame: { parent: null } }, channel, ...args);
}

function invokeFrom(event: unknown, channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = electron.handlers.get(channel);
  if (!handler) throw new Error(`Missing IPC handler ${channel}`);
  return Promise.resolve().then(() => handler(event, ...args));
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

function envelope(): Record<string, unknown> {
  return { schema: 'hummer.task-envelope', version: 1, tenantId: TENANT, targetNodeId: 'node-a' };
}

function node(): Record<string, unknown> {
  return {
    nodeId: 'node-a', tenantId: TENANT, status: 'online', lastSeenAt: NOW.toISOString(),
    manifest: { runtimes: [{ kind: 'codex', available: true }], capabilities: ['task.execute'] },
  };
}

function task(taskId = 'task-1', taskEnvelope: Record<string, unknown> = envelope()): Record<string, unknown> {
  return { taskId, tenantId: TENANT, status: 'queued', envelope: taskEnvelope };
}

function approval(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const request = {
    schema: 'hummer.approval-request', version: 1, requestId: 'request-1', tenantId: TENANT,
    workOrderId: 'work-1', nodeId: 'node-a', runId: 'run-1', riskClass: 'write',
    action: 'task.execute', target: 'task-1', redactedPreview: 'safe preview',
    requestedScope: { capabilities: ['task.execute'], paths: ['outputs/report.md'], maxUses: 1 },
    expiresAt: '2026-10-07T08:30:00.000Z', requestedBy: 'system:node-a',
    ...overrides,
  };
  return { requestId: 'request-1', taskId: 'task-1', tenantId: TENANT, request, createdAt: NOW.toISOString() };
}
