import { contextBridge, ipcRenderer } from 'electron';

interface Run { processId: string; nativeSessionId?: string }
interface Envelope { processId: string; index: number; message: unknown }
interface Subscription { callback: (message: unknown) => void; seen: Set<number> }

const EVENT = 'hummer:codex:event';
const subscriptions = new Map<string, Set<Subscription>>();

function deliver(envelope: Envelope): void {
  subscriptions.get(envelope.processId)?.forEach((subscription) => {
    if (subscription.seen.has(envelope.index)) return;
    subscription.seen.add(envelope.index);
    subscription.callback(envelope.message);
  });
}

ipcRenderer.on(EVENT, (_event, envelope: Envelope) => deliver(envelope));

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

contextBridge.exposeInMainWorld('hummerDesktop', {
  platform: process.platform,
  runtime: 'codex',
  cwd: process.env.HUMMER_CODEX_CWD ?? process.cwd(),
});

contextBridge.exposeInMainWorld('hummerPersistence', {
  listSessions: () => ipcRenderer.invoke('hummer:persistence:list-sessions'),
  saveSession: (record: unknown) => ipcRenderer.invoke('hummer:persistence:save-session', record),
  appendEvent: (record: unknown) => ipcRenderer.invoke('hummer:persistence:append-event', record),
  verifyIntegrity: () => ipcRenderer.invoke('hummer:persistence:verify-integrity'),
});
