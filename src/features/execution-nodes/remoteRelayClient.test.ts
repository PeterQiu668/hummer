import { afterEach, describe, expect, it, vi } from 'vitest';
import { RemoteRelayClient } from './remoteRelayClient';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('RemoteRelayClient', () => {
  it('rejects plaintext remote and non-HTTP Relay URLs while allowing loopback development HTTP', () => {
    expect(() => new RemoteRelayClient({
      baseUrl: 'http://relay.example.test',
      getBadge: () => 'opaque-badge',
    })).toThrow('must use HTTPS');
    expect(() => new RemoteRelayClient({
      baseUrl: 'file:///tmp/relay',
      getBadge: () => 'opaque-badge',
    })).toThrow('must use HTTPS');
    expect(() => new RemoteRelayClient({
      baseUrl: 'http://localhost:8787',
      getBadge: () => 'opaque-badge',
    })).not.toThrow();
    expect(() => new RemoteRelayClient({
      baseUrl: 'http://127.0.0.1:8787',
      getBadge: () => 'opaque-badge',
    })).not.toThrow();
  });

  it('sends an in-memory badge to the authenticated read plane without persistence or logging', async () => {
    const badge = 'badge-sensitive-value';
    const setItem = vi.fn();
    vi.stubGlobal('localStorage', { getItem: vi.fn(), setItem, removeItem: vi.fn() });
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${badge}`);
      return new Response(JSON.stringify({ nodes: [{
        nodeId: 'node-a', tenantId: 'tenant-a', status: 'online', lastSeenAt: '2026-10-07T00:00:00Z', manifest: {},
      }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const client = new RemoteRelayClient({
      baseUrl: 'https://relay.example.test',
      getBadge: () => badge,
      fetch: fetchMock as typeof fetch,
    });

    expect((await client.listNodes()).map((node) => node.nodeId)).toEqual(['node-a']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(setItem).not.toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalled();
    expect(JSON.stringify(await client.listNodes())).not.toContain(badge);
  });

  it('submits mobile batches once per item and preserves partial 401/403 failures', async () => {
    const replies = [
      new Response(JSON.stringify({ task: { taskId: 'task-1' }, inserted: true }), { status: 200 }),
      new Response(JSON.stringify({ error: { code: 'scope_denied', message: 'badge does not grant task.enqueue' } }), { status: 403 }),
      new Response(JSON.stringify({ error: { code: 'invalid_token', message: 'Bearer badge token is invalid or expired' } }), { status: 401 }),
      new Response(JSON.stringify({ task: { taskId: 'task-4' }, inserted: true }), { status: 200 }),
    ];
    const fetchMock = vi.fn(async () => replies.shift()!);
    const client = new RemoteRelayClient({
      baseUrl: 'https://relay.example.test/',
      getBadge: () => 'opaque-badge',
      fetch: fetchMock as typeof fetch,
    });

    const result = await client.enqueueBatch([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]);

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(result).toEqual([
      { index: 0, ok: true, result: { task: { taskId: 'task-1' }, inserted: true } },
      { index: 1, ok: false, status: 403, code: 'scope_denied', message: 'badge does not grant task.enqueue' },
      { index: 2, ok: false, status: 401, code: 'invalid_token', message: 'Bearer badge token is invalid or expired' },
      { index: 3, ok: true, result: { task: { taskId: 'task-4' }, inserted: true } },
    ]);
  });

  it('returns one safe network failure without exposing the badge', async () => {
    const badge = 'badge-must-not-escape';
    const client = new RemoteRelayClient({
      baseUrl: 'https://relay.example.test',
      getBadge: () => badge,
      fetch: vi.fn(async () => { throw new Error(`network failure ${badge}`); }) as typeof fetch,
    });

    const result = await client.enqueueBatch([{ id: 1 }]);
    expect(result).toEqual([{ index: 0, ok: false, status: 0, code: 'network_error', message: 'Relay request failed' }]);
    expect(JSON.stringify(result)).not.toContain(badge);
  });
});
