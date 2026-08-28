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
  listSessions(): Promise<PersistedSessionRecord[]>;
  saveSession(record: { plan: SessionPlan; handle: RuntimeHandle }): Promise<void>;
  appendEvent(record: { plan: SessionPlan; handle: RuntimeHandle; event: RuntimeEvent }): Promise<RuntimeEvent>;
  verifyIntegrity(): Promise<{ valid: boolean; checked: number; brokenEventId?: string; reason?: string }>;
}

declare global {
  interface Window {
    hummerPersistence?: DesktopPersistenceHost;
  }
}

export class MemorySessionStore implements SessionStore {
  private readonly records = new Map<string, PersistedSessionRecord>();

  async listSessions(): Promise<PersistedSessionRecord[]> {
    return [...this.records.values()].map(cloneRecord);
  }

  async saveSession(plan: SessionPlan, handle: RuntimeHandle): Promise<void> {
    const existing = this.records.get(handle.sessionId);
    this.records.set(handle.sessionId, { plan: clone(plan), handle: clone(handle), events: existing?.events ?? [] });
  }

  async appendEvent(handle: RuntimeHandle, plan: SessionPlan, event: RuntimeEvent): Promise<RuntimeEvent> {
    const record = this.records.get(handle.sessionId) ?? { plan: clone(plan), handle: clone(handle), events: [] };
    if (!record.events.some((item) => item.sequence === event.sequence)) record.events.push(clone(event));
    record.events.sort((left, right) => left.sequence - right.sequence);
    this.records.set(handle.sessionId, record);
    return clone(event);
  }
}

export function createDefaultSessionStore(): SessionStore {
  if (typeof window !== 'undefined' && window.hummerPersistence) return new DesktopSessionStore(window.hummerPersistence);
  return new MemorySessionStore();
}

class DesktopSessionStore implements SessionStore {
  constructor(private readonly host: DesktopPersistenceHost) {}

  listSessions(): Promise<PersistedSessionRecord[]> {
    return this.host.listSessions();
  }

  saveSession(plan: SessionPlan, handle: RuntimeHandle): Promise<void> {
    return this.host.saveSession({ plan, handle });
  }

  appendEvent(handle: RuntimeHandle, plan: SessionPlan, event: RuntimeEvent): Promise<RuntimeEvent> {
    return this.host.appendEvent({ plan, handle, event });
  }
}

function cloneRecord(record: PersistedSessionRecord): PersistedSessionRecord {
  return clone(record);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
