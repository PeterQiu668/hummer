import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TaskEnvelope } from '@hummer/contracts';
import {
  configureRemoteRelayDeployment,
  consumeInjectedRemoteRelayDeployment,
  remoteBatchDispatchPort,
  remoteStartWorkDispatchPort,
} from './remoteRelayDispatch';
import { capabilityCatalogPort } from '../capabilities/capabilityCatalogClient';

const envelope = {
  schema: 'hummer.task-envelope', version: 1,
  workOrderTask: { schema: 'hummer.work-order-task', version: 1, title: '报告', target: '生成报告', expectedDeliverable: 'outputs/report.md' },
  tenantId: 'tenant-a', targetNodeId: 'node-a', targetRuntime: 'codex',
  idempotencyKey: 'delivery-test', leaseMs: 30_000, approvalPolicyRef: 'deny-default',
  expiresAt: '2026-10-07T09:00:00.000Z', originRef: 'work-a',
} satisfies TaskEnvelope;

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('remote Relay deployment dispatch', () => {
  it('stays unavailable until baseUrl and an in-memory badge provider are explicitly injected', () => {
    expect(remoteStartWorkDispatchPort()).toBeUndefined();
    expect(remoteBatchDispatchPort()).toBeUndefined();
    expect(capabilityCatalogPort()).toBeUndefined();
  });

  it('consumes the one-shot browser deployment injection before React boot', () => {
    vi.stubGlobal('window', {
      hummerRemoteRelayDeployment: {
        baseUrl: 'https://relay.example.test',
        getBadge: () => 'one-shot-badge',
      },
    });

    dispose = consumeInjectedRemoteRelayDeployment();

    expect(window.hummerRemoteRelayDeployment).toBeUndefined();
    expect(remoteStartWorkDispatchPort()).toBeDefined();
    expect(remoteBatchDispatchPort()).toBeDefined();
    expect(capabilityCatalogPort()).toBeDefined();
    expect(capabilityCatalogPort()?.installerAvailable).toBe(false);
  });

  it('one-shot consumes the trusted installer into a module closure without exposing a long-lived window bridge', () => {
    vi.stubGlobal('window', {
      hummerRemoteRelayDeployment: {
        baseUrl: 'https://relay.example.test',
        getBadge: () => 'one-shot-badge',
        capabilityInstaller: { evaluateAndInstall: vi.fn() },
      },
    });

    dispose = consumeInjectedRemoteRelayDeployment();

    expect(window.hummerRemoteRelayDeployment).toBeUndefined();
    expect(capabilityCatalogPort()?.installerAvailable).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(window, 'hummerCapabilityInstaller')).toBe(false);
  });

  it('connects start-work dispatch without storing or logging the Relay badge', async () => {
    const badge = 'relay-badge-secret';
    const setItem = vi.fn();
    vi.stubGlobal('localStorage', { getItem: vi.fn(), setItem, removeItem: vi.fn() });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ task: { taskId: 'delivery-test' }, inserted: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    dispose = configureRemoteRelayDeployment({
      baseUrl: 'https://relay.example.test',
      getBadge: () => badge,
    });

    await remoteStartWorkDispatchPort()!.record({
      schema: 'hummer.start-work-dispatch-intent', version: 1, status: 'pending',
      planId: 'plan-a', confirmedBy: 'human:boss', confirmedAt: '2026-10-07T08:00:00.000Z', envelope,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://relay.example.test/v1/tasks/enqueue');
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('authorization')).toBe(`Bearer ${badge}`);
    expect(setItem).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });
});
