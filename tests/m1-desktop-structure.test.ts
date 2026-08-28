import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');

describe('M1 desktop host boundary', () => {
  it('provides an Electron main process that loads the existing Vite renderer', () => {
    const mainPath = resolve(root, 'apps/desktop/src/main.ts');
    const preloadPath = resolve(root, 'apps/desktop/src/preload.cts');
    expect(existsSync(mainPath)).toBe(true);
    expect(existsSync(preloadPath)).toBe(true);

    const main = readFileSync(mainPath, 'utf8');
    expect(main).toContain('BrowserWindow');
    expect(main).toContain('HUMMER_RENDERER_URL');
    expect(main).toContain('contextIsolation: true');
  });

  it('never imports child_process from the React source tree', () => {
    const files = walk(resolve(root, 'src')).filter((path) => ['.ts', '.tsx'].includes(extname(path)));
    const offenders = files.filter((path) => /(?:node:)?child_process/.test(readFileSync(path, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('spawns Codex in the main process and exposes the existing host port from preload', () => {
    const host = readFileSync(resolve(root, 'apps/desktop/src/codex-host.ts'), 'utf8');
    const preload = readFileSync(resolve(root, 'apps/desktop/src/preload.cts'), 'utf8');
    expect(host).toContain("from 'node:child_process'");
    expect(host).toContain('spawn(');
    expect(preload).toContain("exposeInMainWorld('hummerCodexCliHost'");
  });

  it('keeps app-server lifecycle, approval, steer, and interrupt inside the desktop host', () => {
    const host = readFileSync(resolve(root, 'apps/desktop/src/codex-host.ts'), 'utf8');
    expect(host).toContain("requestRpc(state, 'thread/start'");
    expect(host).toContain("requestRpc(state, 'turn/start'");
    expect(host).toContain("requestRpc(state, 'turn/steer'");
    expect(host).toContain("requestRpc(state, 'turn/interrupt'");
    expect(host).toContain('respondToApproval');
    expect(host).toContain('runs.delete(processId)');
  });
});

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}
