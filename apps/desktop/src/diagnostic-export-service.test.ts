import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { exportDesktopDiagnosticBundle } from './diagnostic-export-service.js';
import type { RuntimeEnvironmentStatus } from './runtime-environment-doctor.js';

const directories: string[] = [];
const TOKEN = 'auth-token-canary-123456789';
const TENANT = 'tenant-raw-canary';

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function environment(version = '0.153.4'): RuntimeEnvironmentStatus {
  return {
    ready: true,
    node: { available: true, version: '22.22.2', source: 'embedded' },
    codex: {
      available: true,
      compatible: true,
      expectedVersion: '0.153.4',
      version,
      executable: 'C:\\customer-private\\codex.cmd',
      issue: 'customer-content-canary',
    },
    container: {
      available: true,
      runtime: 'podman',
      preferredRuntime: 'podman',
      productionRecommended: true,
      issue: 'customer-content-canary',
    },
    workspaceExec: null,
  };
}

describe('packaged Desktop diagnostic export service', () => {
  it('writes only generated allowlist summaries and hashes raw references', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'hummer-desktop-diagnostic-'));
    directories.push(directory);
    const destinationPath = join(directory, 'diagnostic.zip');
    const receipt = await exportDesktopDiagnosticBundle({
      destinationPath,
      generatedAt: '2026-10-07T12:00:00.000Z',
      appVersion: '0.6.0-internal.1',
      tenantRef: TENANT,
      nodeRef: 'node-raw-canary',
      authToken: TOKEN,
      environment: environment(),
    });

    expect(receipt.manifest.inventory.map((file) => file.path)).toEqual([
      'config/runtime-summary.json',
      'receipts/diagnostic-export.json',
    ]);
    const archive = readFileSync(destinationPath);
    expect(archive.includes(Buffer.from(TOKEN))).toBe(false);
    expect(archive.includes(Buffer.from(TENANT))).toBe(false);
    expect(archive.includes(Buffer.from('customer-content-canary'))).toBe(false);
    expect(archive.includes(Buffer.from('C:\\customer-private'))).toBe(false);
  });

  it('leaves no partial output when a generated allowlist file contains the live secret', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'hummer-desktop-diagnostic-failure-'));
    directories.push(directory);
    const destinationPath = join(directory, 'should-not-exist.zip');
    await expect(exportDesktopDiagnosticBundle({
      destinationPath,
      generatedAt: '2026-10-07T12:00:00.000Z',
      appVersion: '0.6.0-internal.1',
      tenantRef: TENANT,
      nodeRef: 'node-raw-canary',
      authToken: TOKEN,
      environment: environment(TOKEN),
    })).rejects.toThrow('explicit secret');
    expect(existsSync(destinationPath)).toBe(false);
  });

  it('never overwrites an existing destination', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'hummer-desktop-diagnostic-existing-'));
    directories.push(directory);
    const destinationPath = join(directory, 'existing.zip');
    writeFileSync(destinationPath, 'keep-me', { flag: 'wx' });
    await expect(exportDesktopDiagnosticBundle({
      destinationPath,
      generatedAt: '2026-10-07T12:00:00.000Z',
      appVersion: '0.6.0-internal.1',
      tenantRef: TENANT,
      nodeRef: 'node-raw-canary',
      authToken: TOKEN,
      environment: environment(),
    })).rejects.toThrow();
    expect(readFileSync(destinationPath, 'utf8')).toBe('keep-me');
  });
});
