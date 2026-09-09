import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(join(root, path), 'utf8'));
}

describe('generated runtime configuration', () => {
  it('keeps engine profiles generated from one canonical catalog', () => {
    const canonical = readJson('packages/config/src/engine-profiles.json') as {
      defaultProfileId: string;
      profiles: Array<Record<string, unknown> & { customerVisible?: boolean; tier: string }>;
    };
    const desktop = readJson('apps/desktop/src/config/engine-profiles.json');
    const browser = readJson('src/features/engines/engine-profiles.json') as {
      profiles: Array<{ id: string }>;
    };

    expect(desktop).toEqual(canonical);
    expect(browser.profiles).toEqual(canonical.profiles
      .filter((profile) => profile.customerVisible !== false)
      .map((profile) => ({
        id: profile.id,
        tier: profile.tier,
        label: profile.tier === 'standard' ? '\u6807\u51c6' : profile.tier === 'enhanced' ? '\u589e\u5f3a' : '\u65d7\u8230',
        available: profile.available !== false,
        dataDomain: profile.dataDomain,
        ...(profile.compatibilityNote ? { compatibilityNote: profile.compatibilityNote } : {}),
      })));
    expect(browser.profiles.some((profile) => profile.id === 'openai-codex-validation')).toBe(false);
  });

  it('keeps desktop and renderer pricing generated from one canonical table', () => {
    const canonical = readJson('packages/config/src/runtime-pricing.json');

    expect(readJson('apps/desktop/src/config/deepseek-pricing.json')).toEqual(canonical);
    expect(readJson('src/features/sessions/runtime/runtime-pricing.json')).toEqual(canonical);
  });
});
