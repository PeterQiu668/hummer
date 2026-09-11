import { readdirSync, watch, type FSWatcher } from 'node:fs';
import { lstat, readdir, stat } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { requireWorkspaceDirectory } from './workspace-file-guard.js';

export interface InboxFileEvent {
  tenantId: string;
  absolutePath: string;
  relativePath: string;
}

interface WatchOptions {
  tenantId: string;
  workspaceDirectory: string;
  inboxDirectory: string;
  onFile(event: InboxFileEvent): void | Promise<void>;
  settleMs?: number;
}

interface ActiveWatcher { watcher: FSWatcher; timers: Map<string, NodeJS.Timeout>; signatures: Set<string> }

export class WorkOrderInboxWatcher {
  private readonly active = new Map<string, ActiveWatcher>();

  watch(options: WatchOptions): void {
    const inbox = requireWorkspaceDirectory(options.workspaceDirectory, options.inboxDirectory);
    this.stop(options.tenantId);
    const signatures = new Set<string>();
    for (const entry of readdirSyncSafe(inbox)) signatures.add(entry);
    const timers = new Map<string, NodeJS.Timeout>();
    const watcher = watch(inbox, { persistent: false }, (_event, filename) => {
      if (!filename) return;
      const name = filename.toString();
      const previous = timers.get(name);
      if (previous) clearTimeout(previous);
      timers.set(name, setTimeout(() => {
        timers.delete(name);
        void this.emitIfNew(options, inbox, name, signatures);
      }, options.settleMs ?? 300));
    });
    this.active.set(options.tenantId, { watcher, timers, signatures });
  }

  stop(tenantId: string): void {
    const current = this.active.get(tenantId);
    if (!current) return;
    current.timers.forEach((timer) => clearTimeout(timer));
    current.watcher.close();
    this.active.delete(tenantId);
  }

  close(): void {
    [...this.active.keys()].forEach((tenantId) => this.stop(tenantId));
  }

  private async emitIfNew(options: WatchOptions, inbox: string, name: string, signatures: Set<string>): Promise<void> {
    const absolutePath = resolve(inbox, name);
    try {
      if ((await lstat(absolutePath)).isSymbolicLink()) return;
      const before = await stat(absolutePath);
      if (!before.isFile()) return;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, options.settleMs ?? 300));
      const after = await stat(absolutePath);
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) return;
      const signature = `${name}:${after.size}:${after.mtimeMs}`;
      if (signatures.has(signature) || signatures.has(name)) return;
      signatures.add(name);
      signatures.add(signature);
      await options.onFile({
        tenantId: options.tenantId,
        absolutePath,
        relativePath: relative(resolve(options.workspaceDirectory), absolutePath),
      });
    } catch {
      // A file can disappear or remain locked while another process is still copying it.
    }
  }
}

function readdirSyncSafe(directory: string): string[] {
  try {
    return readdirSync(directory);
  } catch {
    return [];
  }
}
