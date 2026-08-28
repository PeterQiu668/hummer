import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';
import { registerCodexHost, stopAllCodexRuns } from './codex-host.js';
import { registerPersistenceHost, type PersistenceHostRegistration } from './persistence-host.js';
import { registerClaudeHost, stopAllClaudeRuns } from './claude-host.js';

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
  else await window.loadFile(resolve(currentDirectory, '../../../dist/index.html'));
  return window;
}

app.whenReady().then(async () => {
  registerCodexHost();
  persistenceHost = registerPersistenceHost({ stopAll: async () => (await stopAllCodexRuns()) + stopAllClaudeRuns() });
  registerClaudeHost();
  await createWindow();
  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow();
  });
});

app.on('before-quit', () => {
  persistenceHost?.close();
  persistenceHost = undefined;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
