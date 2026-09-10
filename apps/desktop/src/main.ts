import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { registerCodexHost, stopAllCodexRuns } from './codex-host.js';
import { registerPersistenceHost, type PersistenceHostRegistration } from './persistence-host.js';
import { registerClaudeHost, stopAllClaudeRuns } from './claude-host.js';
import { inspectRuntimeEnvironment } from './runtime-environment-doctor.js';

const currentDirectory = fileURLToPath(new URL('.', import.meta.url));
let persistenceHost: PersistenceHostRegistration | undefined;

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
  ipcMain.handle('hummer:environment:check', () => inspectRuntimeEnvironment());
  ipcMain.handle('hummer:environment:install-guide', () => shell.openExternal('https://www.npmjs.com/package/@openai/codex'));
  persistenceHost = registerPersistenceHost({ stopAll: async () => (await stopAllCodexRuns()) + stopAllClaudeRuns() });
  registerCodexHost({ resolveCredential: persistenceHost.resolveEngineCredential });
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
  persistenceHost = undefined;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
