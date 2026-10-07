import { join } from 'node:path';
import { app, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { exportDesktopDiagnosticBundle, type DesktopDiagnosticExportReceipt } from './diagnostic-export-service.js';
import type { RuntimeEnvironmentStatus } from './runtime-environment-doctor.js';

export const DIAGNOSTIC_EXPORT_CHANNEL = 'hummer:diagnostics:export';

export interface DiagnosticExportHostOptions {
  resolveTenantId(token: string): string;
  getEnvironment(): Promise<RuntimeEnvironmentStatus> | RuntimeEnvironmentStatus;
  nodeRef?: string;
  chooseDestination?: (defaultPath: string) => Promise<string | null>;
}

export interface DiagnosticExportHostRegistration {
  close(): void;
}

export type RendererDiagnosticExportReceipt = Omit<DesktopDiagnosticExportReceipt, 'path' | 'manifest'>;

export function registerDiagnosticExportHost(options: DiagnosticExportHostOptions): DiagnosticExportHostRegistration {
  ipcMain.handle(DIAGNOSTIC_EXPORT_CHANNEL, async (event: IpcMainInvokeEvent, token: string): Promise<RendererDiagnosticExportReceipt | null> => {
    requireTrustedMainFrame(event);
    if (typeof token !== 'string' || token.length < 8) throw new Error('An authenticated desktop session is required');
    const tenantRef = options.resolveTenantId(token);
    const generatedAt = new Date().toISOString();
    const defaultPath = join(app.getPath('documents'), `HUMMER-diagnostics-${generatedAt.replace(/[:.]/g, '-')}.zip`);
    const destinationPath = options.chooseDestination
      ? await options.chooseDestination(defaultPath)
      : await chooseDestination(defaultPath);
    if (!destinationPath) return null;
    const { path: _path, manifest: _manifest, ...receipt } = await exportDesktopDiagnosticBundle({
      destinationPath,
      generatedAt,
      appVersion: app.getVersion(),
      tenantRef,
      nodeRef: options.nodeRef ?? 'local-desktop',
      authToken: token,
      environment: await options.getEnvironment(),
    });
    return receipt;
  });
  return { close: () => ipcMain.removeHandler(DIAGNOSTIC_EXPORT_CHANNEL) };
}

function requireTrustedMainFrame(event: IpcMainInvokeEvent): void {
  if (!event.senderFrame || event.senderFrame.parent !== null) {
    throw new Error('Diagnostic export is restricted to the trusted top-level renderer');
  }
}

async function chooseDestination(defaultPath: string): Promise<string | null> {
  const selected = await dialog.showSaveDialog({
    title: '导出脱敏诊断包',
    defaultPath,
    buttonLabel: '导出诊断包',
    filters: [{ name: 'ZIP archive', extensions: ['zip'] }],
    properties: ['createDirectory', 'showOverwriteConfirmation'],
  });
  return selected.canceled ? null : selected.filePath ?? null;
}
