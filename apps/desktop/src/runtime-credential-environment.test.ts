import { describe, expect, it } from 'vitest';
import { buildRuntimeEnvironment } from './runtime-credential-environment.js';

describe('buildRuntimeEnvironment', () => {
  it('injects a resolved credential into child env without mutating the parent environment', () => {
    const parent = { PATH: 'test-path' };
    const secret = 'sk-fake-child-only-secret';
    const child = buildRuntimeEnvironment(parent, {
      authToken: 'auth-ref',
      engineProfileId: 'deepseek-standard',
      envKey: 'DEEPSEEK_API_KEY',
      resolveCredential: (token, profileId, envKey) => {
        expect([token, profileId, envKey]).toEqual(['auth-ref', 'deepseek-standard', 'DEEPSEEK_API_KEY']);
        return secret;
      },
    });

    expect(parent).toEqual({ PATH: 'test-path' });
    expect(child).toEqual({ PATH: 'test-path', DEEPSEEK_API_KEY: secret });
  });

  it('does not invent a credential when no authenticated reference is present', () => {
    expect(buildRuntimeEnvironment({}, {
      engineProfileId: 'deepseek-standard', envKey: 'DEEPSEEK_API_KEY', resolveCredential: () => 'should-not-run',
    })).toEqual({});
  });
});
