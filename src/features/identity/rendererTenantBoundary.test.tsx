// @vitest-environment jsdom
import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { draftPlanFromPrompt } from '../sessions/model/session';
import { createDefaultSessionStore, MemorySessionStore } from '../sessions/persistence/sessionStore';
import { useAppStore, activateTenantAppStore } from '../../store/useAppStore';
import { IdentityProvider, useIdentity } from './IdentityProvider';
import { clearIdentity, resumeIdentity, switchTenant as switchIdentityTenant, type IdentityContext, type IdentityHost } from './identityClient';
import { tenantCacheKey } from './tenantCache';

function identityContext(tenantId: string, tenantName: string): IdentityContext {
  return {
    account: { id: 'account-1', email: 'owner@example.test', phone: null, displayName: 'Owner' },
    tenant: { id: tenantId, name: tenantName, slug: tenantId },
    membership: { id: `membership-${tenantId}`, tenantId, accountId: 'account-1', humanUserId: 'human-1', role: 'owner' },
    session: { id: 'session-1', token: 'session-token', accountId: 'account-1', currentTenantId: tenantId, expiresAt: '2099-01-01T00:00:00.000Z' },
  };
}

function TenantProbe() {
  const identity = useIdentity();
  const [draft, setDraft] = useState('');
  return <div>
    <span>{identity.identity.tenant.name}</span>
    <input aria-label="tenant draft" value={draft} onChange={(event) => setDraft(event.target.value)} />
    <button type="button" onClick={() => { void identity.switchTenant('tenant-provider-b'); }}>switch</button>
  </div>;
}

afterEach(() => {
  delete window.hummerIdentity;
  delete window.hummerPersistence;
  localStorage.clear();
});

describe('[TEN-P0E-RENDERER-CACHE] authenticated renderer tenant boundary', () => {
  it('remounts the renderer tree and clears shared app memory when the authenticated tenant changes', async () => {
    const tenantA = identityContext('tenant-provider-a', 'Tenant A');
    const tenantB = identityContext('tenant-provider-b', 'Tenant B');
    const host: IdentityHost = {
      createCompany: vi.fn(),
      acceptInvitation: vi.fn(),
      resumeSession: vi.fn().mockResolvedValue(tenantA),
      listTenants: vi.fn().mockResolvedValue([tenantA.tenant, tenantB.tenant]),
      switchTenant: vi.fn().mockResolvedValue(tenantB),
      listMembers: vi.fn().mockResolvedValue([]),
      createInvitation: vi.fn(),
    };
    window.hummerIdentity = host;
    localStorage.setItem('hummer.auth.session', 'session-token');
    render(<IdentityProvider><TenantProbe /></IdentityProvider>);

    expect(await screen.findByText('Tenant A')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('tenant draft'), { target: { value: 'tenant-a-secret-draft' } });
    useAppStore.setState({ workbenchPrefill: { assignee: 'A employee', prompt: 'tenant-a-secret-task' } });
    fireEvent.click(screen.getByRole('button', { name: 'switch' }));

    expect(await screen.findByText('Tenant B')).toBeInTheDocument();
    expect(screen.getByLabelText('tenant draft')).toHaveValue('');
    expect(useAppStore.getState().workbenchPrefill).toBeNull();
    expect(host.switchTenant).toHaveBeenCalledWith('session-token', 'tenant-provider-b');
  });

  it('removes legacy and previous-tenant caches while keeping current business records tenant-scoped', async () => {
    localStorage.setItem('hummer-v6', JSON.stringify({ state: { auditLog: ['tenant-a-secret'] } }));
    localStorage.setItem('hummer-marketplace-hires', JSON.stringify({ employee_secret: true }));
    localStorage.setItem('hummer-avatar-employee_secret', 'data:image/png;base64,secret');
    await activateTenantAppStore('tenant-cache-a');

    expect(localStorage.getItem('hummer-v6')).toBeNull();
    expect(localStorage.getItem('hummer-marketplace-hires')).toBeNull();
    expect(localStorage.getItem('hummer-avatar-employee_secret')).toBeNull();
    useAppStore.setState({
      workbenchPrefill: { assignee: 'tenant-a-employee', prompt: 'tenant-a-secret-task' },
      auditLog: [{ id: 'secret', ts: 'now', actor: 'A', action: 'secret', target: 'tenant-a-secret-result', result: 'ok', hash: 'hash' }],
    });
    const appStateKey = tenantCacheKey('tenant-cache-a', 'app-state');
    const hiresKey = tenantCacheKey('tenant-cache-a', 'marketplace-hires');
    localStorage.setItem(hiresKey, JSON.stringify({ employee_secret: true }));

    const persisted = localStorage.getItem(appStateKey) ?? '';
    expect(persisted).not.toContain('tenant-a-secret-task');
    expect(persisted).toContain('tenant-a-secret-result');
    await activateTenantAppStore('tenant-cache-b');

    expect(localStorage.getItem(appStateKey)).toBeNull();
    expect(localStorage.getItem(hiresKey)).toBeNull();
    expect(useAppStore.getState().workbenchPrefill).toBeNull();
    expect(useAppStore.getState().auditLog.some((entry) => entry.target === 'tenant-a-secret-result')).toBe(false);
  });

  it('partitions memory sessions and rejects reusing an old runtime handle after tenant switch', async () => {
    let tenantId = 'tenant-session-a';
    const store = new MemorySessionStore(() => tenantId);
    const planA = draftPlanFromPrompt('tenant-a-secret-session');
    const handleA = { runtimeId: 'mock', sessionId: 'runtime-handle-a' };
    await store.saveSession(planA, handleA);
    await store.appendEvent(handleA, planA, {
      sessionId: handleA.sessionId,
      sequence: 1,
      occurredAt: '2026-10-07T00:00:00.000Z',
      actorRef: 'employee:a',
      type: 'status',
      status: 'delivered',
      reason: 'tenant-a-secret-result',
      evidenceRefs: [],
    });

    tenantId = 'tenant-session-b';
    await expect(store.listSessions()).resolves.toEqual([]);
    await expect(store.appendEvent(handleA, planA, {
      sessionId: handleA.sessionId,
      sequence: 2,
      occurredAt: '2026-10-07T00:00:01.000Z',
      actorRef: 'employee:a',
      type: 'status',
      status: 'running',
      evidenceRefs: [],
    })).rejects.toThrow(/current tenant/);

    const planB = draftPlanFromPrompt('tenant-b-session');
    const handleB = { runtimeId: 'mock', sessionId: 'runtime-handle-b' };
    await store.saveSession(planB, handleB);
    expect((await store.listSessions()).map((record) => record.handle.sessionId)).toEqual(['runtime-handle-b']);

    tenantId = 'tenant-session-a';
    const tenantARecords = await store.listSessions();
    expect(tenantARecords.map((record) => record.handle.sessionId)).toEqual(['runtime-handle-a']);
    expect(JSON.stringify(tenantARecords)).toContain('tenant-a-secret-result');
  });

  it('clears the authenticated tenant cache when the identity session is cleared', async () => {
    const context = identityContext('tenant-logout', 'Logout tenant');
    window.hummerIdentity = {
      createCompany: vi.fn(), acceptInvitation: vi.fn(), resumeSession: vi.fn().mockResolvedValue(context),
      listTenants: vi.fn(), switchTenant: vi.fn(), listMembers: vi.fn(), createInvitation: vi.fn(),
    };
    localStorage.setItem('hummer.auth.session', 'session-token');
    await resumeIdentity();
    const cacheKey = tenantCacheKey('tenant-logout', 'marketplace-hires');
    localStorage.setItem(cacheKey, JSON.stringify({ secret: true }));

    clearIdentity();

    expect(localStorage.getItem(cacheKey)).toBeNull();
    expect(localStorage.getItem('hummer.auth.session')).toBeNull();
  });

  it('fails closed when an old desktop session-store instance is used after tenant switch', async () => {
    const tenantA = identityContext('tenant-desktop-store-a', 'Desktop A');
    const tenantB = identityContext('tenant-desktop-store-b', 'Desktop B');
    window.hummerIdentity = {
      createCompany: vi.fn(), acceptInvitation: vi.fn(), resumeSession: vi.fn().mockResolvedValue(tenantA),
      listTenants: vi.fn(), switchTenant: vi.fn().mockResolvedValue(tenantB), listMembers: vi.fn(), createInvitation: vi.fn(),
    };
    const listSessions = vi.fn().mockResolvedValue([]);
    window.hummerPersistence = {
      listSessions,
      saveSession: vi.fn(),
      appendEvent: vi.fn(),
      verifyIntegrity: vi.fn(),
    };
    localStorage.setItem('hummer.auth.session', 'session-token');
    await resumeIdentity();
    const tenantAStore = createDefaultSessionStore();
    await expect(tenantAStore.listSessions()).resolves.toEqual([]);

    await switchIdentityTenant('tenant-desktop-store-b');

    await expect(tenantAStore.listSessions()).rejects.toThrow(/after switching tenant/);
    expect(listSessions).toHaveBeenCalledTimes(1);
  });
});
