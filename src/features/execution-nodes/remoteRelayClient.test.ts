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

  it('reads the tenant-scoped capability catalog through the authenticated Relay route', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('https://relay.example.test/v1/capabilities');
      return new Response(JSON.stringify({ capabilities: [validOwnerCatalogItem()] }), { status: 200 });
    });
    const client = new RemoteRelayClient({
      baseUrl: 'https://relay.example.test',
      getBadge: () => 'opaque-badge',
      fetch: fetchMock as typeof fetch,
    });

    expect((await client.listCapabilities()).map((item) => item.record.packageId)).toEqual(['cap-draft']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails closed when a catalog item has malformed nested provenance or permissions', async () => {
    const client = new RemoteRelayClient({
      baseUrl: 'https://relay.example.test',
      getBadge: () => 'opaque-badge',
      fetch: vi.fn(async () => new Response(JSON.stringify({ capabilities: [{
        access: 'owner',
        record: {
          tenantId: 'tenant-a', packageId: 'cap-a', packageVersion: 1, packageDigest: 'a'.repeat(64),
          author: { title: 'shallow object without provenance' }, trialRecord: null, status: 'draft',
          sourceTaskId: 'task-a', artifactEventId: 'artifact-a', completedEventId: 'completed-a', createdAt: '2026-10-07T08:00:00.000Z',
        },
        share: null,
      }] }), { status: 200 })) as typeof fetch,
    });

    await expect(client.listCapabilities()).rejects.toMatchObject({ status: 502, code: 'invalid_response' });
  });
});

function validOwnerCatalogItem() {
  return {
    access: 'owner',
    record: {
      tenantId: 'tenant-a', packageId: 'cap-draft', packageVersion: 1, packageDigest: 'a'.repeat(64),
      author: {
        schema: 'hummer.capability-package-author-input', version: 1, tenantId: 'tenant-a', packageId: 'cap-draft', packageVersion: 1,
        title: 'Draft capability', goal: 'Create a reviewable result.', preset: 'team-sop',
        capabilityTrack: { responsibilities: [], workflows: [], standards: [], heuristics: [], pitfalls: [], examples: [] },
        behaviorTrack: { expressionPreferences: [], interactionRules: [], corrections: [] },
        runtimeProfile: 'codex-default', toolIds: [], requiredCapabilities: [], acceptanceCriteria: ['Result exists.'],
        sourceBoundary: { apps: [], windows: [], includePaths: [], excludePaths: [] },
        provenance: { demoSessionIds: ['demo-1'], expertActorRef: 'expert:owner', nodeId: 'node-a', device: 'Windows', runtime: 'codex', runtimeVersion: '1.0.0', agentVersion: '1.0.0', capturedAt: '2026-10-07T08:00:00.000Z' },
        evidenceRefs: ['evidence-1'], failureNotes: [], declaredPermissions: [], regressionSuiteRef: 'regression-1', receiptRef: 'receipt-1', status: 'draft', deletionAudit: {},
      },
      trialRecord: null, status: 'draft', sourceTaskId: 'task-a', artifactEventId: 'artifact-a', completedEventId: 'completed-a', createdAt: '2026-10-07T08:00:00.000Z',
    },
    share: null,
  };
}
