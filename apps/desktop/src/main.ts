import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { registerCodexHost, stopAllCodexRuns } from './codex-host.js';
import { registerPersistenceHost, type PersistenceHostRegistration } from './persistence-host.js';
import { registerClaudeHost, stopAllClaudeRuns } from './claude-host.js';
import { inspectRuntimeEnvironment } from './runtime-environment-doctor.js';
import { WorkspaceExecBroker } from './workspace-exec-broker.js';
import { WorkspaceExecService } from './workspace-exec-service.js';

const currentDirectory = fileURLToPath(new URL('.', import.meta.url));
let persistenceHost: PersistenceHostRegistration | undefined;
let workspaceExecBroker: WorkspaceExecBroker | undefined;
let workspaceExecService: WorkspaceExecService | undefined;
let workspaceExecCheck: Promise<ReturnType<WorkspaceExecService['currentHealth']>> | undefined;

async function createWindow(): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 720,
    show: false,
    backgroundColor: '#f7f7f4',
    webPreferences: {
      preload: join(currentDirectory, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  window.once('ready-to-show', () => window.show());
  const rendererUrl = process.env.HUMMER_RENDERER_URL;
  if (rendererUrl) await window.loadURL(rendererUrl);
  else await window.loadFile(app.isPackaged
    ? resolve(process.resourcesPath, 'renderer/index.html')
    : resolve(currentDirectory, '../../../dist/index.html'));
  return window;
}

app.whenReady().then(async () => {
  persistenceHost = registerPersistenceHost({ stopAll: async () => (await stopAllCodexRuns()) + stopAllClaudeRuns() });
  workspaceExecService = new WorkspaceExecService({
    workspaceRoot: resolve(process.env.HUMMER_EXEC_WORKSPACE_ROOT ?? join(app.getPath('userData'), 'workspace')),
  });
  workspaceExecBroker = new WorkspaceExecBroker({
    service: workspaceExecService,
    onExecuted: (context, result, request, directory) => persistenceHost!.recordWorkspaceExecResult(context, result, request, directory),
  });
  await workspaceExecBroker.start();
  await runWorkspaceExecCheck();
  ipcMain.handle('hummer:environment:check', async (_event, force = false) => {
    const health = force || !workspaceExecService?.currentHealth()
      ? await runWorkspaceExecCheck()
      : workspaceExecService.currentHealth();
    return inspectRuntimeEnvironment(process.env, undefined, health);
  });
  ipcMain.handle('hummer:environment:install-guide', () => shell.openExternal('https://www.npmjs.com/package/@openai/codex'));
  registerCodexHost({
    resolveCredential: persistenceHost.resolveEngineCredential,
    recordMcpConnectorStatus: persistenceHost.recordMcpConnectorStatus,
    authorizeMcpTool: persistenceHost.authorizeMcpTool,
    createWorkspaceExecLease: (context) => workspaceExecBroker!.createLease(context),
    revokeWorkspaceExecLease: (token) => workspaceExecBroker?.revoke(token),
  });
  registerClaudeHost();
  await createWindow();
  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow();
  });
});

app.on('before-quit', () => {
  ipcMain.removeHandler('hummer:environment:check');
  ipcMain.removeHandler('hummer:environment:install-guide');
  persistenceHost?.close();
  void workspaceExecBroker?.close();
  workspaceExecBroker = undefined;
  workspaceExecService = undefined;
  persistenceHost = undefined;
});

async function runWorkspaceExecCheck() {
  if (!workspaceExecService || !persistenceHost) return null;
  if (!workspaceExecCheck) {
    workspaceExecCheck = workspaceExecService.selfCheck().then((health) => {
      persistenceHost?.recordWorkspaceExecHealth(health);
      return health;
    }).finally(() => { workspaceExecCheck = undefined; });
  }
  return workspaceExecCheck;
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
