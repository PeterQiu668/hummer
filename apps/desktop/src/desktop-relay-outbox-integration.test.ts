import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => electron.handlers.set(channel, handler)),
    removeHandler: vi.fn((channel: string) => electron.handlers.delete(channel)),
  },
}));

vi.mock('electron', () => ({ ipcMain: electron.ipcMain }));

import { DESKTOP_RELAY_CHANNELS, registerDesktopRelayHost } from './desktop-relay-host.js';
import { openPersistence, type DesktopPersistence } from './persistence/index.js';

const directories: string[] = [];
const BADGE = 'outbox-main-only-badge-never-persist-123456';
const NOW = new Date('2026-10-07T08:00:00.000Z');

afterEach(() => {
  electron.handlers.clear();
  vi.clearAllMocks();
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

describe('Desktop Relay durable outbox integration', () => {
  it('commits the pending row before the first network request and persists no credential bytes', async () => {
    const directory = temporaryDirectory();
    const persistence = openPersistence({ dataDirectory: directory, now: () => NOW });
    const identity = createIdentity(persistence);
    const envelope = taskEnvelope(identity.tenantId);
    let observedBeforeNetwork = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      const pending = persistence.fleetDispatchOutbox.listPending(identity.tenantId, identity.actorRef);
      expect(pending).toHaveLength(1);
      expect(pending[0]).toMatchObject({ status: 'pending', attemptCount: 1, idempotencyKey: envelope.idempotencyKey });
      observedBeforeNetwork = true;
      if (url.endsWith('/v1/control/session')) return json({ session: { tenantId: identity.tenantId, actorRef: identity.actorRef } });
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return json({ inserted: true, task: relayTask(body, identity.tenantId) });
    });
    const registration = register(persistence, identity, fetchMock as typeof fetch);

    await expect(invoke(DESKTOP_RELAY_CHANNELS.enqueueTask, identity.token, envelope)).resolves.toMatchObject({ inserted: true });
    expect(observedBeforeNetwork).toBe(true);
    expect(persistence.fleetDispatchOutbox.listPending(identity.tenantId, identity.actorRef)).toEqual([]);
    registration.close();
    persistence.close();
    expect(databaseBytes(directory).includes(BADGE)).toBe(false);
    expect(databaseBytes(directory).includes(identity.token)).toBe(false);
  });

  it('replays identical bytes after a response-lost restart and converges on one logical Relay task', async () => {
    const directory = temporaryDirectory();
    const accepted = new Map<string, string>();
    let first = openPersistence({ dataDirectory: directory, now: () => NOW });
    const identity = createIdentity(first);
    const envelope = taskEnvelope(identity.tenantId);
    let firstRegistration = register(first, identity, vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      if (url.endsWith('/v1/control/session')) return json({ session: { tenantId: identity.tenantId, actorRef: identity.actorRef } });
      const body = String(init.body);
      accepted.set(envelope.idempotencyKey, body);
      throw new Error('response lost after Relay commit');
    }) as typeof fetch);

    await expect(invoke(DESKTOP_RELAY_CHANNELS.enqueueTask, identity.token, envelope)).rejects.toMatchObject({ code: 'network_error' });
    expect(first.fleetDispatchOutbox.listPending(identity.tenantId, identity.actorRef)[0])
      .toMatchObject({ attemptCount: 1, lastErrorCode: 'network_error' });
    firstRegistration.close();
    first.close();

    first = openPersistence({ dataDirectory: directory, now: () => NOW });
    let replayBody = '';
    firstRegistration = register(first, identity, vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      if (url.endsWith('/v1/control/session')) return json({ session: { tenantId: identity.tenantId, actorRef: identity.actorRef } });
      replayBody = String(init.body);
      const stored = accepted.get(envelope.idempotencyKey);
      expect(replayBody).toBe(stored);
      const body = JSON.parse(replayBody) as Record<string, unknown>;
      return json({ inserted: false, task: relayTask(body, identity.tenantId) });
    }) as typeof fetch);

    await expect(firstRegistration.replayPending()).resolves.toEqual({ delivered: 1, failed: 0 });
    expect(accepted).toHaveLength(1);
    const delivered = first.fleetDispatchOutbox.stage({
      tenantId: identity.tenantId, actorRef: identity.actorRef, envelope, occurredAt: NOW.toISOString(),
    });
    expect(delivered).toMatchObject({ status: 'delivered', attemptCount: 2, relayInserted: false });
    expect(first.fleetDispatchOutbox.listPending(identity.tenantId, identity.actorRef)).toEqual([]);
    firstRegistration.close();
    first.close();
  });

  it('keeps a mismatched successful Relay response pending and records only a safe error code', async () => {
    const directory = temporaryDirectory();
    const persistence = openPersistence({ dataDirectory: directory, now: () => NOW });
    const identity = createIdentity(persistence);
    const envelope = taskEnvelope(identity.tenantId);
    const registration = register(persistence, identity, vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/v1/control/session')) return json({ session: { tenantId: identity.tenantId, actorRef: identity.actorRef } });
      return json({ inserted: true, task: { ...relayTask(envelope, identity.tenantId), taskId: 'different-task' } });
    }) as typeof fetch);

    await expect(invoke(DESKTOP_RELAY_CHANNELS.enqueueTask, identity.token, envelope)).rejects.toThrow('does not match');
    expect(persistence.fleetDispatchOutbox.listPending(identity.tenantId, identity.actorRef)[0])
      .toMatchObject({ status: 'pending', attemptCount: 1, lastErrorCode: 'relay_response_mismatch' });
    registration.close();
    persistence.close();
  });
});

function register(
  persistence: DesktopPersistence,
  identity: { tenantId: string; actorRef: string; token: string },
  fetchImpl: typeof fetch,
) {
  return registerDesktopRelayHost({
    config: { baseUrl: 'https://relay.example.test', badgeToken: BADGE, tenantId: identity.tenantId, actorRef: identity.actorRef },
    resolveIdentity: (token) => {
      const context = persistence.identity.resumeSession(token);
      return { tenantId: context.tenant.id, actorRef: `account:${context.account.id}` };
    },
    outbox: persistence.fleetDispatchOutbox,
    outboxRetryIntervalMs: 0,
    fetch: fetchImpl,
    now: () => NOW,
  });
}

function createIdentity(persistence: DesktopPersistence) {
  const context = persistence.identity.createCompany({
    companyName: 'Outbox integration tenant', displayName: 'Owner', email: `owner-${directories.length}@example.test`,
  });
  return { tenantId: context.tenant.id, actorRef: `account:${context.account.id}`, token: context.session.token };
}

function taskEnvelope(tenantId: string) {
  return {
    schema: 'hummer.task-envelope', version: 1,
    workOrderTask: {
      schema: 'hummer.work-order-task', version: 1, title: 'Durable dispatch',
      target: 'Prove response-loss recovery', expectedDeliverable: 'outputs/outbox.md',
    },
    tenantId, targetNodeId: 'node-outbox', targetRuntime: 'codex', idempotencyKey: 'delivery-outbox-integration',
    leaseMs: 30_000, approvalPolicyRef: 'policy-human-confirmation', expiresAt: '2026-10-07T09:00:00.000Z',
    originRef: 'work-outbox-integration',
  };
}

function relayTask(envelope: Record<string, unknown>, tenantId: string) {
  return { taskId: envelope.idempotencyKey, tenantId, status: 'queued', envelope };
}

function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = electron.handlers.get(channel);
  if (!handler) throw new Error(`Missing IPC handler ${channel}`);
  return Promise.resolve().then(() => handler({ senderFrame: { parent: null } }, ...args));
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'hummer-desktop-outbox-'));
  directories.push(directory);
  return directory;
}

function databaseBytes(directory: string): string {
  return readdirSync(directory)
    .filter((name) => name.startsWith('hummer.sqlite3'))
    .map((name) => readFileSync(join(directory, name)))
    .reduce((combined, bytes) => `${combined}${bytes.toString('latin1')}`, '');
}
