import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  children: [] as Array<{
    stdout: { write(value: string): boolean };
    stderr: { write(value: string): boolean };
    stdin: { write(value: string): boolean };
    killed: boolean;
    kill(): boolean;
  }>,
}));

vi.mock('electron', () => ({
  app: {
    getPath: () => process.cwd(),
    getVersion: () => 'test',
  },
  dialog: {},
  ipcMain: {
    handle: (channel: string, handler: (...args: any[]) => any) => harness.handlers.set(channel, handler),
    removeHandler: (channel: string) => harness.handlers.delete(channel),
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
}));

vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>();
  const { EventEmitter } = await import('node:events');
  const { PassThrough } = await import('node:stream');
  class FakeChild extends EventEmitter {
    readonly stdout = new PassThrough();
    readonly stderr = new PassThrough();
    readonly stdin = new PassThrough();
    killed = false;
    kill(): boolean {
      this.killed = true;
      return true;
    }
  }
  return {
    ...original,
    spawn: vi.fn(() => {
      const child = new FakeChild();
      harness.children.push(child);
      return child;
    }),
    spawnSync: vi.fn(() => ({ status: 0, stdout: 'codex-cli 0.153.4\n', stderr: '' })),
  };
});

import { registerCodexHost, stopAllCodexRuns } from './codex-host.js';
import { registerClaudeHost, stopAllClaudeRuns } from './claude-host.js';
import { stopAllForAuthenticatedTenant } from './persistence-host.js';

const tenants = new Map<string, string>();
const originalCodexPath = process.env.HUMMER_CODEX_PATH;
const originalClaudePath = process.env.HUMMER_CLAUDE_PATH;

function invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = harness.handlers.get(channel);
  if (!handler) throw new Error(`Missing IPC handler ${channel}`);
  return Promise.resolve().then(() => handler(...args));
}

function sender() {
  return {
    send: vi.fn(),
    isDestroyed: () => false,
  };
}

function codexRequest() {
  return {
    command: 'codex' as const,
    args: ['exec', '--json', '--sandbox', 'read-only', '-'],
    stdin: 'prove the tenant boundary',
    initialPrompt: 'prove the tenant boundary',
    protocol: 'exec-jsonl' as const,
    engineProfileId: 'deepseek-standard',
    sandbox: 'read-only' as const,
  };
}

function claudeRequest() {
  return {
    command: 'claude' as const,
    args: ['--print', '--input-format', 'stream-json', '--output-format', 'stream-json', '--permission-mode', 'manual'],
    stdin: JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'prove the tenant boundary' }] } }),
    initialPrompt: 'prove the tenant boundary',
    protocol: 'stream-json' as const,
  };
}

beforeAll(() => {
  process.env.HUMMER_CODEX_PATH = process.execPath;
  process.env.HUMMER_CLAUDE_PATH = process.execPath;
  const resolveTenantId = (token: string) => {
    const tenantId = tenants.get(token);
    if (!tenantId) throw new Error('Invalid authenticated session token');
    return tenantId;
  };
  registerCodexHost({ resolveTenantId });
  registerClaudeHost({ resolveTenantId });
});

afterAll(() => {
  if (originalCodexPath === undefined) delete process.env.HUMMER_CODEX_PATH;
  else process.env.HUMMER_CODEX_PATH = originalCodexPath;
  if (originalClaudePath === undefined) delete process.env.HUMMER_CLAUDE_PATH;
  else process.env.HUMMER_CLAUDE_PATH = originalClaudePath;
});

describe('[TEN-P0-DESKTOP-RUNTIME-IPC] desktop runtime IPC tenant boundary', () => {
  it('[TEN-W4-SURFACE-DESKTOP-IPC] rejects legacy anonymous and cross-tenant Codex start/replay/control/fork calls', async () => {
    tenants.set('codex-owner', 'tenant-codex-owner');
    tenants.set('codex-other', 'tenant-codex-other');
    const owner = sender();

    await expect(invoke('hummer:codex:start', { sender: owner }, codexRequest())).rejects.toThrow(/authenticated session token/);
    const run = await invoke<{ processId: string }>('hummer:codex:start', { sender: owner }, 'codex-owner', codexRequest());

    for (const [channel, args] of [
      ['hummer:codex:replay', [run.processId]],
      ['hummer:codex:stop', [run.processId]],
      ['hummer:codex:respond-approval', [run.processId, 'approval-1', true]],
      ['hummer:codex:steer', [run.processId, 'cross-tenant steer']],
      ['hummer:codex:fork', [run.processId, { sequence: 1, nativeTurnId: 'turn-1' }]],
    ] as const) {
      await expect(invoke(channel, { sender: sender() }, ...args)).rejects.toThrow();
      await expect(invoke(channel, { sender: sender() }, 'codex-other', ...args)).rejects.toThrow(/current tenant/);
    }
  });

  it('rejects legacy anonymous and cross-tenant Claude start/replay/control calls', async () => {
    tenants.set('claude-owner', 'tenant-claude-owner');
    tenants.set('claude-other', 'tenant-claude-other');
    const owner = sender();

    await expect(invoke('hummer:claude:start', { sender: owner }, claudeRequest())).rejects.toThrow(/authenticated session token/);
    const run = await invoke<{ processId: string }>('hummer:claude:start', { sender: owner }, 'claude-owner', claudeRequest());

    for (const [channel, args] of [
      ['hummer:claude:replay', [run.processId]],
      ['hummer:claude:stop', [run.processId]],
      ['hummer:claude:respond-approval', [run.processId, 'approval-1', true]],
      ['hummer:claude:steer', [run.processId, 'cross-tenant steer']],
    ] as const) {
      await expect(invoke(channel, { sender: sender() }, ...args)).rejects.toThrow();
      await expect(invoke(channel, { sender: sender() }, 'claude-other', ...args)).rejects.toThrow(/current tenant/);
    }
  });

  it('[TEN-W4-SIDE-RUNTIME-TOKEN] stops Codex and Claude event publication after the bound token switches tenant', async () => {
    tenants.set('codex-switch', 'tenant-switch-origin');
    const codexOwner = sender();
    const codexChildIndex = harness.children.length;
    await invoke('hummer:codex:start', { sender: codexOwner }, 'codex-switch', codexRequest());
    const codexChild = harness.children[codexChildIndex];
    tenants.set('codex-switch', 'tenant-switch-destination');
    codexChild.stdout.write(`${JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'secret' } })}\n`);
    expect(codexChild.killed).toBe(true);
    expect(codexOwner.send).not.toHaveBeenCalled();

    tenants.set('claude-switch', 'tenant-switch-origin');
    const claudeOwner = sender();
    const claudeChildIndex = harness.children.length;
    await invoke('hummer:claude:start', { sender: claudeOwner }, 'claude-switch', claudeRequest());
    const claudeChild = harness.children[claudeChildIndex];
    tenants.set('claude-switch', 'tenant-switch-destination');
    claudeChild.stdout.write(`${JSON.stringify({ type: 'result', subtype: 'success', result: 'secret' })}\n`);
    expect(claudeChild.killed).toBe(true);
    expect(claudeOwner.send).not.toHaveBeenCalled();
  });

  it('kills only runs belonging to the requested tenant', async () => {
    tenants.set('codex-scope-a', 'tenant-codex-scope-a');
    tenants.set('codex-scope-b', 'tenant-codex-scope-b');
    const codexAIndex = harness.children.length;
    await invoke('hummer:codex:start', { sender: sender() }, 'codex-scope-a', codexRequest());
    const codexBIndex = harness.children.length;
    await invoke('hummer:codex:start', { sender: sender() }, 'codex-scope-b', codexRequest());
    expect(await stopAllCodexRuns('tenant-codex-scope-a')).toBe(1);
    expect(harness.children[codexAIndex].killed).toBe(true);
    expect(harness.children[codexBIndex].killed).toBe(false);

    tenants.set('claude-scope-a', 'tenant-claude-scope-a');
    tenants.set('claude-scope-b', 'tenant-claude-scope-b');
    const claudeAIndex = harness.children.length;
    await invoke('hummer:claude:start', { sender: sender() }, 'claude-scope-a', claudeRequest());
    const claudeBIndex = harness.children.length;
    await invoke('hummer:claude:start', { sender: sender() }, 'claude-scope-b', claudeRequest());
    expect(stopAllClaudeRuns('tenant-claude-scope-a')).toBe(1);
    expect(harness.children[claudeAIndex].killed).toBe(true);
    expect(harness.children[claudeBIndex].killed).toBe(false);
  });

  it('resolves kill-all from the authenticated token and never accepts renderer tenant input', async () => {
    const stopAll = vi.fn(async () => 2);
    await expect(stopAllForAuthenticatedTenant(() => 'tenant-a', '', stopAll)).rejects.toThrow(/authenticated session token/);
    expect(stopAll).not.toHaveBeenCalled();

    await expect(stopAllForAuthenticatedTenant((token) => {
      expect(token).toBe('session-a');
      return 'tenant-a';
    }, 'session-a', stopAll)).resolves.toEqual({ killed: 2 });
    expect(stopAll).toHaveBeenCalledWith('tenant-a');
  });
});
