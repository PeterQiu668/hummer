import { currentSessionToken, requireCurrentTenantId } from '../../identity/identityClient';
import type { SessionPlan } from '../model/session';
import type { RuntimeEvent, RuntimeHandle } from '../runtime/adapter';

export interface PersistedSessionRecord {
  handle: RuntimeHandle;
  plan: SessionPlan;
  events: RuntimeEvent[];
}

export interface SessionStore {
  listSessions(): Promise<PersistedSessionRecord[]>;
  saveSession(plan: SessionPlan, handle: RuntimeHandle): Promise<void>;
  appendEvent(handle: RuntimeHandle, plan: SessionPlan, event: RuntimeEvent): Promise<RuntimeEvent>;
}

interface DesktopPersistenceHost {
  listSessions(token: string): Promise<PersistedSessionRecord[]>;
  saveSession(record: { token: string; plan: SessionPlan; handle: RuntimeHandle }): Promise<void>;
  appendEvent(record: { token: string; plan: SessionPlan; handle: RuntimeHandle; event: RuntimeEvent }): Promise<RuntimeEvent>;
  verifyIntegrity(token: string): Promise<{ valid: boolean; checked: number; brokenEventId?: string; reason?: string }>;
}

declare global {
  interface Window {
    hummerPersistence?: DesktopPersistenceHost;
  }
}

export class MemorySessionStore implements SessionStore {
  private readonly recordsByTenant = new Map<string, Map<string, PersistedSessionRecord>>();
  private readonly handleOwners = new Map<string, string>();

  constructor(private readonly resolveTenantId: () => string = requireCurrentTenantId) {}

  async listSessions(): Promise<PersistedSessionRecord[]> {
    return [...this.partition().values()].map(cloneRecord);
  }

  async saveSession(plan: SessionPlan, handle: RuntimeHandle): Promise<void> {
    const tenantId = this.currentTenantId();
    this.assertHandleTenant(handle.sessionId, tenantId);
    const records = this.partition(tenantId);
    const existing = records.get(handle.sessionId);
    records.set(handle.sessionId, { plan: clone(plan), handle: clone(handle), events: existing?.events ?? [] });
    this.handleOwners.set(handle.sessionId, tenantId);
  }

  async appendEvent(handle: RuntimeHandle, plan: SessionPlan, event: RuntimeEvent): Promise<RuntimeEvent> {
    const tenantId = this.currentTenantId();
    this.assertHandleTenant(handle.sessionId, tenantId);
    const records = this.partition(tenantId);
    const record = records.get(handle.sessionId) ?? { plan: clone(plan), handle: clone(handle), events: [] };
    if (!record.events.some((item) => item.sequence === event.sequence)) record.events.push(clone(event));
    record.events.sort((left, right) => left.sequence - right.sequence);
    records.set(handle.sessionId, record);
    this.handleOwners.set(handle.sessionId, tenantId);
    return clone(event);
  }

  private currentTenantId(): string {
    const tenantId = this.resolveTenantId();
    if (!tenantId) throw new Error('Memory session cache requires an authenticated tenant');
    return tenantId;
  }

  private partition(tenantId = this.currentTenantId()): Map<string, PersistedSessionRecord> {
    const existing = this.recordsByTenant.get(tenantId);
    if (existing) return existing;
    const created = new Map<string, PersistedSessionRecord>();
    this.recordsByTenant.set(tenantId, created);
    return created;
  }

  private assertHandleTenant(sessionId: string, tenantId: string): void {
    const owner = this.handleOwners.get(sessionId);
    if (owner && owner !== tenantId) throw new Error('Runtime handle is unavailable in the current tenant');
  }
}

export function createDefaultSessionStore(): SessionStore {
  const tenantId = requireCurrentTenantId();
  if (typeof window !== 'undefined' && window.hummerPersistence) return new DesktopSessionStore(window.hummerPersistence, tenantId);
  return new MemorySessionStore();
}

class DesktopSessionStore implements SessionStore {
  constructor(private readonly host: DesktopPersistenceHost, private readonly tenantId: string) {}

  async listSessions(): Promise<PersistedSessionRecord[]> {
    this.assertCurrentTenant();
    return await this.host.listSessions(requireSessionToken());
  }

  async saveSession(plan: SessionPlan, handle: RuntimeHandle): Promise<void> {
    this.assertCurrentTenant();
    await this.host.saveSession({ token: requireSessionToken(), plan, handle });
  }

  async appendEvent(handle: RuntimeHandle, plan: SessionPlan, event: RuntimeEvent): Promise<RuntimeEvent> {
    this.assertCurrentTenant();
    return await this.host.appendEvent({ token: requireSessionToken(), plan, handle, event });
  }

  private assertCurrentTenant(): void {
    if (requireCurrentTenantId() !== this.tenantId) throw new Error('Session store is unavailable after switching tenant');
  }
}

function requireSessionToken(): string {
  const token = currentSessionToken();
  if (!token) throw new Error('Desktop persistence requires an authenticated session');
  return token;
}

function cloneRecord(record: PersistedSessionRecord): PersistedSessionRecord {
  return clone(record);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
