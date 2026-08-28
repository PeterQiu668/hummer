import { contextBridge, ipcRenderer } from 'electron';

interface Run { processId: string; nativeSessionId?: string }
interface Envelope { processId: string; index: number; message: unknown }
interface Subscription { callback: (message: unknown) => void; seen: Set<number> }

const EVENT = 'hummer:codex:event';
const subscriptions = new Map<string, Set<Subscription>>();
const CLAUDE_EVENT = 'hummer:claude:event';
const claudeSubscriptions = new Map<string, Set<Subscription>>();
const CONNECTORS_CHANGED = 'hummer:runtime-connectors:changed';

function deliver(envelope: Envelope): void {
  subscriptions.get(envelope.processId)?.forEach((subscription) => {
    if (subscription.seen.has(envelope.index)) return;
    subscription.seen.add(envelope.index);
    subscription.callback(envelope.message);
  });
}
function deliverClaude(envelope: Envelope): void {
  claudeSubscriptions.get(envelope.processId)?.forEach((subscription) => {
    if (subscription.seen.has(envelope.index)) return;
    subscription.seen.add(envelope.index);
    subscription.callback(envelope.message);
  });
}


ipcRenderer.on(EVENT, (_event, envelope: Envelope) => deliver(envelope));

ipcRenderer.on(CLAUDE_EVENT, (_event, envelope: Envelope) => deliverClaude(envelope));
contextBridge.exposeInMainWorld('hummerCodexCliHost', {
  start: (request: unknown) => ipcRenderer.invoke('hummer:codex:start', request),
  subscribe: (run: Run, callback: (message: unknown) => void) => {
    const subscription: Subscription = { callback, seen: new Set() };
    const group = subscriptions.get(run.processId) ?? new Set<Subscription>();
    group.add(subscription);
    subscriptions.set(run.processId, group);
    void ipcRenderer.invoke('hummer:codex:replay', run.processId).then((events: Envelope[]) => events.forEach(deliver));
    return () => {
      group.delete(subscription);
      if (!group.size) subscriptions.delete(run.processId);
    };
  },
  respondToApproval: (run: Run, id: string, approved: boolean) => ipcRenderer.invoke('hummer:codex:respond-approval', run.processId, id, approved),
  sendHumanMessage: (run: Run, text: string) => ipcRenderer.invoke('hummer:codex:steer', run.processId, text),
  stop: (run: Run) => ipcRenderer.invoke('hummer:codex:stop', run.processId),
});

contextBridge.exposeInMainWorld('hummerClaudeCliHost', {
  start: (request: unknown) => ipcRenderer.invoke('hummer:claude:start', request),
  subscribe: (run: Run, callback: (message: unknown) => void) => {
    const subscription: Subscription = { callback, seen: new Set() };
    const group = claudeSubscriptions.get(run.processId) ?? new Set<Subscription>();
    group.add(subscription);
    claudeSubscriptions.set(run.processId, group);
    void ipcRenderer.invoke('hummer:claude:replay', run.processId).then((events: Envelope[]) => events.forEach(deliverClaude));
    return () => {
      group.delete(subscription);
      if (!group.size) claudeSubscriptions.delete(run.processId);
    };
  },
  respondToApproval: (run: Run, id: string, approved: boolean) => ipcRenderer.invoke('hummer:claude:respond-approval', run.processId, id, approved),
  sendHumanMessage: (run: Run, text: string) => ipcRenderer.invoke('hummer:claude:steer', run.processId, text),
  stop: (run: Run) => ipcRenderer.invoke('hummer:claude:stop', run.processId),
});
contextBridge.exposeInMainWorld('hummerDesktop', {
  platform: process.platform,
  runtime: process.env.HUMMER_RUNTIME_SHELL === 'claude' ? 'claude-code' : 'codex',
  cwd: process.env.HUMMER_RUNTIME_SHELL === 'claude' ? process.env.HUMMER_CLAUDE_CWD ?? process.cwd() : process.env.HUMMER_CODEX_CWD ?? process.cwd(),
});

contextBridge.exposeInMainWorld('hummerPersistence', {
  listSessions: () => ipcRenderer.invoke('hummer:persistence:list-sessions'),
  saveSession: (record: unknown) => ipcRenderer.invoke('hummer:persistence:save-session', record),
  appendEvent: (record: unknown) => ipcRenderer.invoke('hummer:persistence:append-event', record),
  verifyIntegrity: () => ipcRenderer.invoke('hummer:persistence:verify-integrity'),
});

contextBridge.exposeInMainWorld('hummerOrganization', {
  listDigitalEmployees: (tenantId: string) => ipcRenderer.invoke('hummer:organization:list-employees', tenantId),
  hireDigitalEmployee: (request: unknown) => ipcRenderer.invoke('hummer:organization:hire-employee', request),
});

contextBridge.exposeInMainWorld('hummerApprovalPolicy', {
  authorize: (request: unknown) => ipcRenderer.invoke('hummer:approval-policy:authorize', request),
});

contextBridge.exposeInMainWorld('hummerExecutionNodes', {
  list: (tenantId: string) => ipcRenderer.invoke('hummer:execution-nodes:list', tenantId),
  killAll: () => ipcRenderer.invoke('hummer:execution-nodes:kill-all'),
});

contextBridge.exposeInMainWorld('hummerRuntimeConnectors', {
  list: () => ipcRenderer.invoke('hummer:runtime-connectors:list'),
  subscribe: (callback: (records: unknown[]) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, records: unknown[]) => callback(records);
    ipcRenderer.on(CONNECTORS_CHANGED, listener);
    return () => ipcRenderer.removeListener(CONNECTORS_CHANGED, listener);
  },
});
