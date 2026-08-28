import { join, resolve } from 'node:path';
import { app, ipcMain } from 'electron';
import { enrichRuntimeEventEvidence } from './persistence-runtime.js';
import { openPersistence, type DesktopPersistence, type HireDigitalEmployeeInput } from './persistence/index.js';
import type { AuthorizeApprovalInput } from './persistence/approval-policy-store.js';
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
export interface PersistenceHostOptions {
  stopAll?: () => Promise<number>;
}


const CHANNELS = [
  'hummer:persistence:list-sessions',
  'hummer:persistence:save-session',
  'hummer:persistence:append-event',
  'hummer:persistence:verify-integrity',
  'hummer:organization:list-employees',
  'hummer:organization:hire-employee',
  'hummer:approval-policy:authorize',
  'hummer:execution-nodes:list',
  'hummer:execution-nodes:kill-all',
] as const;

export function registerPersistenceHost(options: PersistenceHostOptions = {}): PersistenceHostRegistration {
  const dataDirectory = resolve(process.env.HUMMER_DATA_DIR ?? join(app.getPath('userData'), 'facts'));
  const workspaceDirectory = resolve(process.env.HUMMER_CODEX_CWD ?? process.cwd());
  const persistence = openPersistence({ dataDirectory });
  persistence.runtimeEvents.interruptStaleRealSessions(new Date().toISOString());
  const nodeId = 'node_local';
  const runtimeId = process.env.HUMMER_RUNTIME_SHELL === 'claude' ? 'claude-code' : 'codex-cli';
  persistence.executionNodes.registerLocal({ id: nodeId, tenantId: 'tenant_demo', displayName: process.env.COMPUTERNAME ?? '本机执行节点', runtimeId, cwd: workspaceDirectory, permissionScope: `${process.env.HUMMER_CODEX_SANDBOX ?? 'workspace-write'}; approval-required`, lastSeenAt: new Date().toISOString() });

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
  ipcMain.handle('hummer:organization:list-employees', (_event, tenantId: string) => {
    return persistence.organization.listDigitalEmployees(tenantId);
  });
  ipcMain.handle('hummer:organization:hire-employee', (_event, request: HireDigitalEmployeeInput) => persistence.organization.hireDigitalEmployee(request));
  ipcMain.handle('hummer:approval-policy:authorize', (_event, request: AuthorizeApprovalInput) => {
    return persistence.approvalPolicies.authorize(request);
  });
  ipcMain.handle('hummer:execution-nodes:list', (_event, tenantId: string) => persistence.executionNodes.list(tenantId));
  ipcMain.handle('hummer:execution-nodes:kill-all', async () => {
    const killed = await options.stopAll?.() ?? 0;
    return { killed };
  });

  return {
    databasePath: persistence.databasePath,
    close: () => {
      CHANNELS.forEach((channel) => ipcMain.removeHandler(channel));
      persistence.executionNodes.markOffline(nodeId, new Date().toISOString());
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
