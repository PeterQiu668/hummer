import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CapabilityGrantRegistry } from '../src/badge-auth.js';
import { SqliteTaskGrantAuthority } from '../src/sqlite-task-grant-authority.js';

const relayRoot = resolve(import.meta.dirname, '..');
const bin = resolve(relayRoot, 'bin/hummer-relay.mjs');
const execFileAsync = promisify(execFile);
const children = new Set<ChildProcessWithoutNullStreams>();
const temporaryDirectories: string[] = [];

beforeAll(async () => {
  await execFileAsync(process.execPath, [
    resolve(relayRoot, '../../node_modules/typescript/bin/tsc'),
    '-p',
    resolve(relayRoot, 'tsconfig.cli.json'),
  ], { cwd: relayRoot });
  await execFileAsync(process.execPath, [resolve(relayRoot, 'scripts/prepare-cli-dist.mjs')], { cwd: relayRoot });
}, 20_000);

function config(databasePath: string, overrides: Record<string, unknown> = {}) {
  return {
    schema: 'hummer.relay-config', version: 2, host: '127.0.0.1', port: 0, databasePath,
    taskGrantDatabasePath: resolve(databasePath, '..', 'task-grants.sqlite'),
    badges: [{
      tokenEnv: 'HUMMER_RELAY_CONTROL_TOKEN', tokenId: 'control-1', tenantId: 'tenant-a',
      actorRef: 'human:operator', scopes: ['node.read'], expiresAt: '2099-01-01T00:00:00.000Z',
    }],
    ...overrides,
  };
}

async function tempConfig(value: unknown): Promise<{ directory: string; path: string; databasePath: string; taskGrantDatabasePath: string }> {
  const directory = await mkdtemp(resolve(tmpdir(), 'hummer-relay-cli-'));
  temporaryDirectories.push(directory);
  const path = resolve(directory, 'relay.json');
  const databasePath = resolve(directory, 'fleet.sqlite');
  const taskGrantDatabasePath = resolve(directory, 'task-grants.sqlite');
  await writeFile(path, `${JSON.stringify(value)}\n`, 'utf8');
  return { directory, path, databasePath, taskGrantDatabasePath };
}

function launch(configPath: string, token = 'r'.repeat(32)): ChildProcessWithoutNullStreams {
  const child = spawn(process.execPath, [bin, 'start', '--config', configPath], {
    cwd: relayRoot,
    env: { ...process.env, HUMMER_RELAY_CONTROL_TOKEN: token },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  children.add(child);
  child.once('exit', () => children.delete(child));
  return child;
}

function line(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolveLine, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error('timed out waiting for relay output')), 10_000);
    stream.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const index = buffer.indexOf('\n');
      if (index >= 0) {
        clearTimeout(timer);
        resolveLine(buffer.slice(0, index));
      }
    });
    stream.once('error', reject);
  });
}

function exit(child: ChildProcessWithoutNullStreams): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolveExit) => child.once('exit', (code, signal) => resolveExit({ code, signal })));
}

afterEach(async () => {
  for (const child of children) child.kill('SIGTERM');
  await Promise.all([...children].map(exit));
  children.clear();
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe('hummer-relay daemon', () => {
  it('imports a digest-only task grant snapshot without reading badge secrets', async () => {
    const initial = await tempConfig({});
    await writeFile(initial.path, `${JSON.stringify(config(initial.databasePath))}\n`, 'utf8');
    const token = `hgr_${'p'.repeat(43)}`;
    const registry = new CapabilityGrantRegistry({
      now: () => new Date('2026-10-07T00:00:00.000Z'),
      tokenFactory: () => token,
    });
    registry.issue({
      authorityRef: 'authority:operator', tenantId: 'tenant-a', nodeId: 'node-a',
      workOrderId: 'work-1', issuedToRunId: 'run-1', capabilities: ['task.execute'], paths: [],
      expiresAt: '2099-01-01T00:00:00.000Z', maxUses: 1,
    }, {
      grantId: 'task-1', tenantId: 'tenant-a', nodeId: 'node-a',
      workOrderId: 'work-1', issuedToRunId: 'run-1', capabilities: ['task.execute'], paths: [],
      expiresAt: '2099-01-01T00:00:00.000Z', maxUses: 1,
    });
    const snapshotPath = resolve(initial.directory, 'snapshot.json');
    await writeFile(snapshotPath, `${JSON.stringify({
      schema: 'hummer.task-grant-snapshot', version: 1, tenantId: 'tenant-a',
      grants: registry.snapshot('tenant-a'),
    })}\n`, 'utf8');

    const imported = await execFileAsync(process.execPath, [
      bin, 'grant-import', '--config', initial.path, '--snapshot', snapshotPath,
    ], { cwd: relayRoot, env: { ...process.env, HUMMER_RELAY_CONTROL_TOKEN: '' } });
    expect(JSON.parse(imported.stdout)).toMatchObject({
      schema: 'hummer.task-grant-import-result', version: 1, tenantId: 'tenant-a', inserted: 1, unchanged: 0,
    });
    expect(imported.stdout).not.toContain(token);

    const authority = new SqliteTaskGrantAuthority(initial.taskGrantDatabasePath);
    expect(authority.snapshot('tenant-a')).toHaveLength(1);
    authority.close();
  });

  it('starts on loopback, serves an authenticated control request, and closes on SIGTERM', async () => {
    const initial = await tempConfig({});
    await writeFile(initial.path, `${JSON.stringify(config(initial.databasePath))}\n`, 'utf8');
    const child = launch(initial.path);
    const stdoutLine = await line(child.stdout);
    const ready = JSON.parse(stdoutLine) as Record<string, unknown>;
    expect(ready).toMatchObject({ schema: 'hummer.relay-ready', version: 1 });
    expect(ready.address).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(ready.databaseRef).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(ready.taskGrantDatabaseRef).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(stdoutLine).not.toContain('r'.repeat(32));
    expect(stdoutLine).not.toContain(initial.databasePath);

    const response = await fetch(`${ready.address as string}/v1/control/session`, {
      headers: { authorization: `Bearer ${'r'.repeat(32)}` },
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ session: { tenantId: 'tenant-a', actorRef: 'human:operator' } });

    const closed = exit(child);
    child.kill('SIGTERM');
    const result = await closed;
    if (process.platform === 'win32') {
      // Node documents SIGTERM as unconditional termination on Windows;
      // interactive Ctrl+C still reaches the installed SIGINT handler.
      expect(result).toEqual({ code: null, signal: 'SIGTERM' });
    } else {
      expect(result).toEqual({ code: 0, signal: null });
    }
    expect(await readFile(initial.databasePath)).not.toHaveLength(0);
    expect(await readFile(initial.taskGrantDatabasePath)).not.toHaveLength(0);
  }, 20_000);

  it.each([
    ['unknown config field', (databasePath: string) => config(databasePath, { extra: true })],
    ['non-loopback host', (databasePath: string) => config(databasePath, { host: '0.0.0.0' })],
  ])('fails closed for %s', async (_label, makeConfig) => {
    const initial = await tempConfig({});
    await writeFile(initial.path, `${JSON.stringify(makeConfig(initial.databasePath))}\n`, 'utf8');
    const child = launch(initial.path);
    const stderrLine = await line(child.stderr);
    expect(JSON.parse(stderrLine)).toMatchObject({ schema: 'hummer.relay-error', version: 1 });
    expect(await exit(child)).toEqual({ code: 1, signal: null });
    expect(stderrLine).not.toContain('r'.repeat(32));
  });

  it('fails closed when the configured badge environment variable is absent', async () => {
    const initial = await tempConfig({});
    await writeFile(initial.path, `${JSON.stringify(config(initial.databasePath))}\n`, 'utf8');
    const child = launch(initial.path, '');
    const stderrLine = await line(child.stderr);
    expect(stderrLine).toContain('HUMMER_RELAY_CONTROL_TOKEN');
    expect(await exit(child)).toEqual({ code: 1, signal: null });
  });
});
