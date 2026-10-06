import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CapabilityInstallGateDecision } from '@hummer/contracts';
import {
  CapabilityInstallError,
  capabilityCatalogPort,
  configureRemoteCapabilityCatalog,
  verifyInstallBoundaryResult,
  type CapabilityInstallRequest,
} from './capabilityCatalogClient';

const request: CapabilityInstallRequest = {
  packageId: 'cap-research',
  packageVersion: 1,
  packageDigest: 'a'.repeat(64),
  shareId: 'share-research',
  shareDigest: 'b'.repeat(64),
  targetTenantId: 'tenant-b',
};

function decision(overrides: Partial<CapabilityInstallGateDecision> = {}): CapabilityInstallGateDecision {
  return {
    schema: 'hummer.capability-install-gate-decision',
    version: 1,
    gateId: 'gate-research',
    shareId: request.shareId,
    targetTenantId: request.targetTenantId,
    decision: 'approved',
    reasons: ['all_checks_passed'],
    packageDigest: request.packageDigest,
    shareDigest: request.shareDigest,
    requestDigest: 'c'.repeat(64),
    decidedBy: 'system:capability-install-gate',
    evaluatedAt: '2026-10-07T08:00:00.000Z',
    ...overrides,
  };
}

let disposeCatalog: (() => void) | undefined;

afterEach(() => {
  disposeCatalog?.();
  disposeCatalog = undefined;
  vi.unstubAllGlobals();
});

describe('capability catalog install boundary', () => {
  it('stays unavailable until a Remote Relay reader is explicitly configured', () => {
    expect(capabilityCatalogPort()).toBeUndefined();
  });

  it('accepts success only when the approved decision binds package, share and request digests', () => {
    const result = verifyInstallBoundaryResult(request, {
      installed: true,
      requestDigest: 'c'.repeat(64),
      decision: decision(),
    });

    expect(result).toMatchObject({ packageId: 'cap-research', shareId: 'share-research', requestDigest: 'c'.repeat(64) });
    expect(() => verifyInstallBoundaryResult(request, {
      installed: true,
      requestDigest: 'c'.repeat(64),
      decision: decision({ packageDigest: 'd'.repeat(64) }),
    })).toThrowError(expect.objectContaining<Partial<CapabilityInstallError>>({ code: 'decision_binding_invalid' }));
  });

  it('never converts a denied gate result into an installed state', () => {
    expect(() => verifyInstallBoundaryResult(request, {
      installed: false,
      requestDigest: 'c'.repeat(64),
      decision: decision({ decision: 'denied', reasons: ['static_check_failed'] }),
    })).toThrowError(expect.objectContaining<Partial<CapabilityInstallError>>({ code: 'install_denied' }));
  });

  it('does not persist reader or installer configuration', () => {
    const setItem = vi.fn();
    vi.stubGlobal('localStorage', { getItem: vi.fn(), setItem, removeItem: vi.fn() });
    disposeCatalog = configureRemoteCapabilityCatalog({ listCapabilities: vi.fn().mockResolvedValue([]) }, {
      evaluateAndInstall: vi.fn(),
    });
    expect(capabilityCatalogPort()).toBeDefined();
    expect(setItem).not.toHaveBeenCalled();
    disposeCatalog();
    disposeCatalog = undefined;
    expect(capabilityCatalogPort()).toBeUndefined();
  });
});
