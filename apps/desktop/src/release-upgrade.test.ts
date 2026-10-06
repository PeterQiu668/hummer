import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildSyntheticReleasePackage,
  getActiveReleaseVersion,
  initializeSyntheticInstall,
  listReleaseSwitchAudit,
  rehearseUpgrade,
} from './release-upgrade.js';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixture(): { installRoot: string; packagePath: string; packageSha256: string } {
  const root = mkdtempSync(join(tmpdir(), 'hummer-release-rehearsal-'));
  directories.push(root);
  const installRoot = join(root, 'synthetic-install');
  initializeSyntheticInstall(installRoot, '0.6.0-internal.1');
  const packageBytes = buildSyntheticReleasePackage({
    releaseVersion: '0.6.1-internal.1',
    compatibleFrom: '0.6.0',
    compatibleBefore: '0.7.0',
    files: [
      { path: 'app/app.bin', contents: 'synthetic-new-release' },
      { path: 'resources/version.txt', contents: '0.6.1-internal.1\n' },
    ],
  });
  const packagePath = join(root, 'release.hummer-package.json');
  writeFileSync(packagePath, packageBytes, { flag: 'wx' });
  return {
    installRoot,
    packagePath,
    packageSha256: createHash('sha256').update(packageBytes).digest('hex'),
  };
}

describe('W6 synthetic upgrade and rollback rehearsal', () => {
  it('UPGRADE-01 validates SHA-256 and compatibility before atomically activating a staged release', () => {
    const input = fixture();
    const result = rehearseUpgrade({ ...input, expectedPackageSha256: input.packageSha256 });

    expect(result).toMatchObject({
      previousVersion: '0.6.0-internal.1', activeVersion: '0.6.1-internal.1', atomicSwitch: 'sqlite-transaction',
    });
    expect(getActiveReleaseVersion(input.installRoot)).toBe('0.6.1-internal.1');
    expect(readFileSync(join(input.installRoot, 'versions', '0.6.1-internal.1', 'app', 'app.bin'), 'utf8'))
      .toBe('synthetic-new-release');
  });

  it('UPGRADE-02 rolls the activity pointer back when activation fails inside the atomic transaction', () => {
    const input = fixture();
    let observedDuringUncommittedSwitch = '';

    expect(() => rehearseUpgrade({
      ...input,
      expectedPackageSha256: input.packageSha256,
      faultInjector(phase) {
        if (phase === 'after-pointer-update') {
          observedDuringUncommittedSwitch = getActiveReleaseVersion(input.installRoot);
          throw new Error('synthetic activation failure: Bearer do-not-store-12345678');
        }
      },
    })).toThrow('synthetic activation failure');
    expect(observedDuringUncommittedSwitch).toBe('0.6.0-internal.1');
    expect(getActiveReleaseVersion(input.installRoot)).toBe('0.6.0-internal.1');
    expect(readFileSync(join(input.installRoot, 'versions', '0.6.0-internal.1', 'app.bin'), 'utf8'))
      .toBe('synthetic-old-release');
    expect(existsSync(join(input.installRoot, 'versions', '0.6.1-internal.1'))).toBe(false);
    expect(existsSync(join(input.installRoot, '.failed', `0.6.1-internal.1-${input.packageSha256.slice(0, 12)}`))).toBe(true);
    expect(listReleaseSwitchAudit(input.installRoot)).toEqual([expect.objectContaining({
      fromVersion: '0.6.0-internal.1', toVersion: '0.6.1-internal.1', status: 'rolled_back',
      reason: 'synthetic activation failure: Bearer [REDACTED]',
    })]);
  });

  it('UPGRADE-03 quarantines an after-stage failure without publishing the new release', () => {
    const input = fixture();
    expect(() => rehearseUpgrade({
      ...input,
      expectedPackageSha256: input.packageSha256,
      faultInjector(phase) {
        if (phase === 'after-stage') throw new Error('staged validation failed');
      },
    })).toThrow('staged validation failed');
    expect(getActiveReleaseVersion(input.installRoot)).toBe('0.6.0-internal.1');
    expect(existsSync(join(input.installRoot, '.staging', `0.6.1-internal.1-${input.packageSha256.slice(0, 12)}`))).toBe(false);
    expect(existsSync(join(input.installRoot, '.failed', `0.6.1-internal.1-${input.packageSha256.slice(0, 12)}`))).toBe(true);
    expect(listReleaseSwitchAudit(input.installRoot)[0]?.status).toBe('rolled_back');
  });

  it('UPGRADE-04 rejects a package whose external SHA-256 does not match', () => {
    const input = fixture();
    expect(() => rehearseUpgrade({ ...input, expectedPackageSha256: '0'.repeat(64) }))
      .toThrow('package SHA-256 mismatch');
    expect(getActiveReleaseVersion(input.installRoot)).toBe('0.6.0-internal.1');
  });

  it('UPGRADE-05 rejects incompatible packages without staging or switching them', () => {
    const input = fixture();
    const incompatible = buildSyntheticReleasePackage({
      releaseVersion: '1.0.0', compatibleFrom: '0.9.0', compatibleBefore: '1.1.0',
      files: [{ path: 'app.bin', contents: 'incompatible' }],
    });
    writeFileSync(input.packagePath, incompatible);
    const expectedPackageSha256 = createHash('sha256').update(incompatible).digest('hex');
    expect(() => rehearseUpgrade({ ...input, expectedPackageSha256 })).toThrow('is incompatible');
    expect(getActiveReleaseVersion(input.installRoot)).toBe('0.6.0-internal.1');
  });

  it('UPGRADE-06 refuses a real or unmarked install directory', () => {
    const input = fixture();
    const unmarked = mkdtempSync(join(tmpdir(), 'hummer-unmarked-install-'));
    directories.push(unmarked);
    expect(() => rehearseUpgrade({ ...input, installRoot: unmarked, expectedPackageSha256: input.packageSha256 }))
      .toThrow('synthetic-root marker');
  });

  it('UPGRADE-07 rejects Windows alternate-stream and device-name paths', () => {
    expect(() => buildSyntheticReleasePackage({
      releaseVersion: '0.6.1', compatibleFrom: '0.6.0', compatibleBefore: '0.7.0',
      files: [{ path: 'app.bin:secret', contents: 'unsafe' }],
    })).toThrow('Windows-unsafe');
    expect(() => buildSyntheticReleasePackage({
      releaseVersion: '0.6.1', compatibleFrom: '0.6.0', compatibleBefore: '0.7.0',
      files: [{ path: 'CON.txt', contents: 'unsafe' }],
    })).toThrow('Windows-unsafe');
  });
});
