import { describe, expect, it, vi } from 'vitest';
import { listEngineProfiles } from './engineProfileClient';

describe('customer engine profile catalog', () => {
  it('uses the desktop catalog and never exposes internal profiles', async () => {
    const bridge = {
      list: vi.fn().mockResolvedValue([
        { id: 'deepseek-standard', tier: 'standard' as const, label: '\u6807\u51c6', available: true, dataDomain: 'api.deepseek.com' },
        { id: 'openai-codex-validation', tier: 'flagship' as const, label: '\u65d7\u8230', available: true, dataDomain: 'chatgpt.com' },
      ]),
    };

    await expect(listEngineProfiles(bridge)).resolves.toEqual([
      { id: 'deepseek-standard', tier: 'standard', label: '\u6807\u51c6', available: true, dataDomain: 'api.deepseek.com' },
    ]);
    expect(bridge.list).toHaveBeenCalledWith(null);
  });

  it('authenticates the desktop catalog lookup with the current session token', async () => {
    const bridge = { list: vi.fn().mockResolvedValue([]) };

    await listEngineProfiles(bridge, 'session-token');

    expect(bridge.list).toHaveBeenCalledWith('session-token');
  });

  it('keeps a safe public catalog in browser prototype mode', async () => {
    const profiles = await listEngineProfiles();
    expect(profiles.map((profile) => profile.id)).toEqual(['deepseek-standard', 'zhipu-enhanced', 'openai-flagship']);
    expect(profiles.find((profile) => profile.id === 'zhipu-enhanced')).toMatchObject({ available: false });
  });
});
