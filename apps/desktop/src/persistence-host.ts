import { join, resolve } from 'node:path';
import { app, ipcMain } from 'electron';
import { enrichRuntimeEventEvidence } from './persistence-runtime.js';
import { openPersistence, type DesktopPersistence } from './persistence/index.js';
import type { JsonValue } from './persistence/canonical-json.js';
import type { PersistableRuntimeEvent } from './persistence/runtime-event-store.js';

interface SessionRecordRequest {
  plan: Record<string, unknown>;
  handle: Record<string, unknown>;
}

interface AppendEventRequest extends SessionRecordRequest {
  event: Record<string, unknown>;
}

export interface PersistenceHostRegistration {
  databasePath: string;
  close(): void;
}

const CHANNELS = [
  'hummer:persistence:list-sessions',
  'hummer:persistence:save-session',
  'hummer:persistence:append-event',
  'hummer:persistence:verify-integrity',
] as const;

export function registerPersistenceHost(): PersistenceHostRegistration {
  const dataDirectory = resolve(process.env.HUMMER_DATA_DIR ?? join(app.getPath('userData'), 'facts'));
  const workspaceDirectory = resolve(process.env.HUMMER_CODEX_CWD ?? process.cwd());
  const persistence = openPersistence({ dataDirectory });

  ipcMain.handle('hummer:persistence:list-sessions', () => listSessions(persistence));
  ipcMain.handle('hummer:persistence:save-session', (_event, request: SessionRecordRequest) => {
    saveSession(persistence, request);
  });
  ipcMain.handle('hummer:persistence:append-event', (_event, request: AppendEventRequest) => {
    const descriptor = descriptorFromRequest(request);
    const event = asRuntimeEvent(request.event);
    const persisted = enrichRuntimeEventEvidence(persistence, event, workspaceDirectory);
    persistence.runtimeEvents.save(persisted, {
      tenantId: descriptor.tenantId,
      runtimeId: descriptor.runtimeId,
      correlationId: `corr_${descriptor.sessionId}`,
      workOrderId: descriptor.workOrderId,
    });
    return persisted;
  });
  ipcMain.handle('hummer:persistence:verify-integrity', () => persistence.verifyDomainEventIntegrity());

  return {
    databasePath: persistence.databasePath,
    close: () => {
      CHANNELS.forEach((channel) => ipcMain.removeHandler(channel));
      persistence.close();
    },
  };
}

function listSessions(persistence: DesktopPersistence): Array<Record<string, JsonValue>> {
  return persistence.runtimeEvents.listSessions().map((descriptor) => ({
    plan: descriptor.plan,
    handle: descriptor.handle,
    events: persistence.runtimeEvents.listBySession(descriptor.sessionId) as JsonValue,
  }));
}

function saveSession(persistence: DesktopPersistence, request: SessionRecordRequest): void {
  const descriptor = descriptorFromRequest(request);
  persistence.runtimeEvents.saveSession({
    ...descriptor,
    startedAt: new Date().toISOString(),
    plan: asJsonValue(request.plan),
    handle: asJsonValue(request.handle),
  });
}

function descriptorFromRequest(request: SessionRecordRequest) {
  const sessionId = requiredString(request.handle, 'sessionId');
  const runtimeId = requiredString(request.handle, 'runtimeId');
  const planId = requiredString(request.plan, 'id');
  return {
    sessionId,
    runtimeId,
    tenantId: 'tenant_demo',
    workOrderId: `wo_${planId.replace(/^plan_/, '')}`,
  };
}

function asRuntimeEvent(value: Record<string, unknown>): PersistableRuntimeEvent {
  const normalized = JSON.parse(JSON.stringify(value)) as PersistableRuntimeEvent;
  if (!Array.isArray(normalized.evidenceRefs)) normalized.evidenceRefs = [];
  return normalized;
}

function asJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function requiredString(value: Record<string, unknown>, key: string): string {
  const result = value[key];
  if (typeof result !== 'string' || !result) throw new TypeError(`Persistence request requires ${key}`);
  return result;
}
