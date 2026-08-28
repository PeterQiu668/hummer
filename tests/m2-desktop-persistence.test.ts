import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');

describe('M2 desktop persistence boundary', () => {
  it('owns SQLite in the Electron main process and exposes only an IPC host to the renderer', () => {
    const main = readFileSync(resolve(root, 'apps/desktop/src/main.ts'), 'utf8');
    const host = readFileSync(resolve(root, 'apps/desktop/src/persistence-host.ts'), 'utf8');
    const preload = readFileSync(resolve(root, 'apps/desktop/src/preload.cts'), 'utf8');

    expect(main).toContain('registerPersistenceHost');
    expect(host).toContain('openPersistence');
    expect(host).toContain("ipcMain.handle('hummer:persistence:append-event'");
    expect(preload).toContain("exposeInMainWorld('hummerPersistence'");
  });

  it('does not leak Electron or SQLite imports into product source', () => {
    const files = walk(resolve(root, 'src')).filter((path) => ['.ts', '.tsx'].includes(extname(path)));
    const offenders = files.filter((path) => /(?:from\s+['"]electron['"]|better-sqlite3)/.test(readFileSync(path, 'utf8')));
    expect(offenders).toEqual([]);
  });
});

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}
