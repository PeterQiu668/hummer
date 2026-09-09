import { describe, expect, it } from 'vitest';
import {
  buildCodexProviderArgs,
  customerEngineProfiles,
  defaultEngineProfile,
  engineProfileById,
  requiredCodexCliVersion,
  redactRuntimeSecrets,
} from './engine-profiles.js';

describe('desktop engine profiles', () => {
  it('pins the supported Codex CLI protocol version', () => {
    expect(requiredCodexCliVersion()).toBe('0.153.4');
  });

  it('exposes only customer profiles with availability and data-domain disclosure', () => {
    const profiles = customerEngineProfiles();

    expect(profiles.map((profile) => profile.id)).toEqual([
      'deepseek-standard',
      'zhipu-enhanced',
      'openai-flagship',
    ]);
    expect(profiles.some((profile) => profile.id === 'openai-codex-validation')).toBe(false);
    expect(profiles.find((profile) => profile.id === 'deepseek-standard')).toMatchObject({
      label: '\u6807\u51c6',
      available: true,
      dataDomain: 'api.deepseek.com',
    });
    expect(profiles.find((profile) => profile.id === 'zhipu-enhanced')).toMatchObject({
      label: '\u589e\u5f3a',
      available: false,
      dataDomain: 'open.bigmodel.cn',
      compatibilityNote: expect.stringMatching(/Responses/),
    });
  });

  it('uses the DeepSeek-backed standard tier by default', () => {
    expect(defaultEngineProfile()).toMatchObject({
      id: 'deepseek-standard',
      tier: 'standard',
      shell: 'codex',
      providerId: 'deepseek',
      wireApi: 'responses',
    });
  });

  it('injects dotted Codex overrides without putting the secret value in argv', () => {
    const profile = engineProfileById('deepseek-standard');
    const secret = 'ds-test-secret-must-never-leak';
    const args = buildCodexProviderArgs(profile, { DEEPSEEK_API_KEY: secret });
    const serialized = JSON.stringify(args);

    expect(args).toContain('model_providers.deepseek.env_key="DEEPSEEK_API_KEY"');
    expect(args).toContain('model_providers.deepseek.wire_api="responses"');
    expect(serialized).not.toContain(secret);
  });
  it('uses a non-reserved OpenAI provider id and disables remote plugin catalog loading', () => {
    const profile = engineProfileById('openai-flagship');
    const args = buildCodexProviderArgs(profile, {});

    expect(profile.providerId).toBe('openai_hummer');
    expect(args).toEqual(expect.arrayContaining([
      '--disable', 'remote_plugin',
      '--disable', 'plugins',
      '--disable', 'recommended_plugins',
    ]));
    expect(args).not.toContain('model_providers.openai_hummer.env_key="OPENAI_API_KEY"');
  });
  it('can use the built-in Codex login only for an explicitly selected validation profile', () => {
    const profile = engineProfileById('openai-codex-validation');
    const args = buildCodexProviderArgs(profile, {});

    expect(profile.dataDomain).toBe('chatgpt.com');
    expect(args).toContain('model_provider="openai"');
    expect(args.some((argument) => argument.startsWith('model_providers.'))).toBe(false);
  });


  it('fails explicitly when the configured provider only supports removed chat completions', () => {
    const profile = engineProfileById('zhipu-enhanced');
    expect(() => buildCodexProviderArgs(profile, {})).toThrow(/Codex CLI 0\.153\.4.*chat/i);
  });

  it('redacts configured runtime keys from logs and serialized evidence', () => {
    const secret = 'sk-sensitive-runtime-value';
    const redacted = redactRuntimeSecrets(
      `Authorization: Bearer ${secret} api_key=${secret}`,
      { DEEPSEEK_API_KEY: secret },
    );

    expect(redacted).not.toContain(secret);
    expect(redacted).toContain('[REDACTED:DEEPSEEK_API_KEY]');
  });
});
