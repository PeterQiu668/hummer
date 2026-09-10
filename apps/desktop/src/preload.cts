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
  fork: (run: Run, checkpoint: { sequence: number; nativeTurnId: string }, sop?: string) => ipcRenderer.invoke('hummer:codex:fork', run.processId, checkpoint, sop),
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

contextBridge.exposeInMainWorld('hummerEngineProfiles', {
  list: (token: string | null) => ipcRenderer.invoke('hummer:engine-profiles:list', token),
});
contextBridge.exposeInMainWorld('hummerEngineCredentials', {
  configure: (request: unknown) => ipcRenderer.invoke('hummer:engine-credentials:configure', request),
  remove: (request: unknown) => ipcRenderer.invoke('hummer:engine-credentials:remove', request),
});
contextBridge.exposeInMainWorld('hummerDesktop', {
  platform: process.platform,
  runtime: process.env.HUMMER_RUNTIME_SHELL === 'claude' ? 'claude-code' : 'codex',
  cwd: process.env.HUMMER_RUNTIME_SHELL === 'claude' ? process.env.HUMMER_CLAUDE_CWD ?? process.cwd() : process.env.HUMMER_CODEX_CWD ?? process.cwd(),
});

contextBridge.exposeInMainWorld('hummerIdentity', {
  createCompany: (input: unknown) => ipcRenderer.invoke('hummer:identity:create-company', input),
  acceptInvitation: (input: unknown) => ipcRenderer.invoke('hummer:identity:accept-invitation', input),
  resumeSession: (token: string) => ipcRenderer.invoke('hummer:identity:resume', token),
  listTenants: (token: string) => ipcRenderer.invoke('hummer:identity:list-tenants', token),
  switchTenant: (token: string, tenantId: string) => ipcRenderer.invoke('hummer:identity:switch-tenant', { token, tenantId }),
  listMembers: (token: string) => ipcRenderer.invoke('hummer:identity:list-members', token),
  createInvitation: (token: string, input: unknown) => ipcRenderer.invoke('hummer:identity:create-invitation', { token, input }),
});

contextBridge.exposeInMainWorld('hummerPersistence', {
  listSessions: (token: string) => ipcRenderer.invoke('hummer:persistence:list-sessions', token),
  saveSession: (record: unknown) => ipcRenderer.invoke('hummer:persistence:save-session', record),
  appendEvent: (record: unknown) => ipcRenderer.invoke('hummer:persistence:append-event', record),
  verifyIntegrity: (token: string) => ipcRenderer.invoke('hummer:persistence:verify-integrity', token),
});

contextBridge.exposeInMainWorld('hummerOrganization', {
  listDigitalEmployees: (token: string) => ipcRenderer.invoke('hummer:organization:list-employees', token),
  hireDigitalEmployee: (request: unknown) => ipcRenderer.invoke('hummer:organization:hire-employee', request),
});

contextBridge.exposeInMainWorld('hummerProjects', {
  list: (token: string) => ipcRenderer.invoke('hummer:projects:list', token),
  create: (request: unknown) => ipcRenderer.invoke('hummer:projects:create', request),
  growthChain: (request: unknown) => ipcRenderer.invoke('hummer:projects:growth-chain', request),
  recordGrowthReview: (request: unknown) => ipcRenderer.invoke('hummer:projects:record-growth-review', request),
});
contextBridge.exposeInMainWorld('hummerEnvironmentDoctor', {
  check: () => ipcRenderer.invoke('hummer:environment:check'),
  openInstallGuide: () => ipcRenderer.invoke('hummer:environment:install-guide'),
});
contextBridge.exposeInMainWorld('hummerApprovalPolicy', {
  preview: (request: unknown) => ipcRenderer.invoke('hummer:approval-policy:preview', request),
  authorize: (request: unknown) => ipcRenderer.invoke('hummer:approval-policy:authorize', request),
  evidence: (request: unknown) => ipcRenderer.invoke('hummer:approval-policy:evidence', request),
});

contextBridge.exposeInMainWorld('hummerExecutionNodes', {
  list: (token: string) => ipcRenderer.invoke('hummer:execution-nodes:list', token),
  killAll: (token: string) => ipcRenderer.invoke('hummer:execution-nodes:kill-all', token),
});

contextBridge.exposeInMainWorld('hummerOutcomes', {
  define: (request: unknown) => ipcRenderer.invoke('hummer:outcomes:define', request),
  record: (request: unknown) => ipcRenderer.invoke('hummer:outcomes:record', request),
  recordCost: (request: unknown) => ipcRenderer.invoke('hummer:outcomes:record-cost', request),
  receipt: (request: unknown) => ipcRenderer.invoke('hummer:outcomes:receipt', request),
  sessionCost: (request: unknown) => ipcRenderer.invoke('hummer:outcomes:session-cost', request),
  list: (token: string) => ipcRenderer.invoke('hummer:outcomes:list', token),
  exportReceipt: (request: unknown) => ipcRenderer.invoke('hummer:outcomes:export-receipt', request),
});

contextBridge.exposeInMainWorld('hummerRuntimeConnectors', {
  list: () => ipcRenderer.invoke('hummer:runtime-connectors:list'),
  subscribe: (callback: (records: unknown[]) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, records: unknown[]) => callback(records);
    ipcRenderer.on(CONNECTORS_CHANGED, listener);
    return () => ipcRenderer.removeListener(CONNECTORS_CHANGED, listener);
  },
});
