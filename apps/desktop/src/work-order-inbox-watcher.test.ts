import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { WorkOrderInboxWatcher } from './work-order-inbox-watcher.js';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

describe('work order inbox watcher', () => {
  it('ignores existing files and emits each newly stable file once', async () => {
    const workspace = temporaryDirectory();
    const inbox = join(workspace, 'inbox');
    mkdirSync(inbox);
    writeFileSync(join(inbox, 'existing.xlsx'), 'already there');
    const onFile = vi.fn();
    const watcher = new WorkOrderInboxWatcher();
    watcher.watch({ tenantId: 'tenant_1', workspaceDirectory: workspace, inboxDirectory: inbox, onFile, settleMs: 40 });

    writeFileSync(join(inbox, 'new.xlsx'), 'new order');
    await waitUntil(() => onFile.mock.calls.length === 1);
    writeFileSync(join(inbox, 'new.xlsx'), 'new order');
    await delay(100);

    expect(onFile).toHaveBeenCalledTimes(1);
    expect(onFile).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant_1', relativePath: 'inbox\\new.xlsx' }));
    watcher.close();
  });

  it('rejects an inbox outside the runtime workspace', () => {
    const watcher = new WorkOrderInboxWatcher();
    expect(() => watcher.watch({
      tenantId: 'tenant_1', workspaceDirectory: temporaryDirectory(), inboxDirectory: temporaryDirectory(), onFile: vi.fn(),
    })).toThrow(/outside the workspace/i);
  });
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'hummer-inbox-'));
  directories.push(directory);
  return directory;
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate() && Date.now() < deadline) await delay(20);
  if (!predicate()) throw new Error('Timed out waiting for inbox file');
}
