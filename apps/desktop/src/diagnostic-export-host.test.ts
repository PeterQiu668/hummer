import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => {
  let handler: ((event: unknown, token: string) => unknown) | undefined;
  return {
    app: { getPath: vi.fn(() => 'C:\\synthetic-documents'), getVersion: vi.fn(() => '0.6.0-internal.1') },
    dialog: { showSaveDialog: vi.fn() },
    ipcMain: {
      handle: vi.fn((_channel: string, next: typeof handler) => { handler = next; }),
      removeHandler: vi.fn(() => { handler = undefined; }),
    },
    getHandler: () => handler,
  };
});

vi.mock('electron', () => ({ app: electron.app, dialog: electron.dialog, ipcMain: electron.ipcMain }));

import { registerDiagnosticExportHost } from './diagnostic-export-host.js';

const directories: string[] = [];
afterEach(() => {
  vi.clearAllMocks();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const environment = {
  ready: true,
  node: { available: true as const, version: '22.22.2', source: 'embedded' as const },
  codex: { available: true, compatible: true, expectedVersion: '0.153.4', version: '0.153.4' },
  container: { available: true, runtime: 'podman' as const, preferredRuntime: 'podman' as const, productionRecommended: true },
  workspaceExec: null,
};

describe('trusted diagnostic export IPC', () => {
  it('authenticates the token, owns destination selection, and returns only a receipt', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'hummer-diagnostic-ipc-'));
    directories.push(directory);
    const destination = join(directory, 'diagnostic.zip');
    const resolveTenantId = vi.fn(() => 'tenant-private');
    const registration = registerDiagnosticExportHost({
      resolveTenantId,
      getEnvironment: () => environment,
      chooseDestination: async () => destination,
    });
    const handler = electron.getHandler();
    const result = await handler?.({ senderFrame: { parent: null } }, 'session-token-123456') as { path?: string; manifest?: unknown; archiveSha256: string };

    expect(resolveTenantId).toHaveBeenCalledWith('session-token-123456');
    expect(result.path).toBeUndefined();
    expect(result.manifest).toBeUndefined();
    expect(result.archiveSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result)).not.toContain('session-token-123456');
    registration.close();
  });

  it('rejects a subframe before identity or file selection', async () => {
    const resolveTenantId = vi.fn(() => 'tenant-private');
    const chooseDestination = vi.fn(async () => null);
    const registration = registerDiagnosticExportHost({ resolveTenantId, getEnvironment: () => environment, chooseDestination });
    const handler = electron.getHandler();

    await expect(handler?.({ senderFrame: { parent: {} } }, 'session-token-123456')).rejects.toThrow('top-level renderer');
    expect(resolveTenantId).not.toHaveBeenCalled();
    expect(chooseDestination).not.toHaveBeenCalled();
    registration.close();
  });
});
