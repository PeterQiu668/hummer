import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import {
  consumeTaskGrantIssuerSecret,
  createConfiguredBadgeAuthenticator,
  parseRelayConfig,
  RelayConfigError,
} from '../src/relay-config.js';

const baseConfig = () => ({
  schema: 'hummer.relay-config',
  version: 3,
  host: '127.0.0.1',
  port: 0,
  databasePath: resolve('fleet.sqlite'),
  taskGrantDatabasePath: resolve('task-grants.sqlite'),
  taskGrantIssuerSecretEnv: 'HUMMER_TASK_GRANT_ISSUER_SECRET',
  badges: [{
    tokenEnv: 'HUMMER_RELAY_CONTROL_TOKEN',
    tokenId: 'control-1',
    tenantId: 'tenant-a',
    actorRef: 'human:operator',
    scopes: ['node.read'],
    expiresAt: '2099-01-01T00:00:00.000Z',
  }],
});

describe('relay daemon config', () => {
  it('accepts the exact v3 shape and removes badge plus issuer secrets from the environment immediately', async () => {
    const config = parseRelayConfig(baseConfig());
    const environment = {
      HUMMER_RELAY_CONTROL_TOKEN: 'a'.repeat(32),
      HUMMER_TASK_GRANT_ISSUER_SECRET: 'i'.repeat(32),
    };
    const authenticator = createConfiguredBadgeAuthenticator(config.badges, environment);
    expect(consumeTaskGrantIssuerSecret(config, environment)).toBe('i'.repeat(32));
    expect(environment).toEqual({});
    await expect(authenticator.authorize({
      token: 'a'.repeat(32),
      scope: 'node.read',
      now: '2026-10-07T00:00:00.000Z',
    })).resolves.toMatchObject({ ok: true });
  });

  it.each([
    ['top-level unknown field', { ...baseConfig(), token: 'plaintext' }],
    ['badge unknown field', { ...baseConfig(), badges: [{ ...baseConfig().badges[0], token: 'plaintext' }] }],
    ['wrong schema', { ...baseConfig(), schema: 'hummer.other' }],
    ['wrong version', { ...baseConfig(), version: 1 }],
    ['non-loopback host', { ...baseConfig(), host: '0.0.0.0' }],
    ['relative database path', { ...baseConfig(), databasePath: 'fleet.sqlite' }],
    ['relative task grant database path', { ...baseConfig(), taskGrantDatabasePath: 'task-grants.sqlite' }],
    ['shared fleet and task grant database', { ...baseConfig(), taskGrantDatabasePath: baseConfig().databasePath }],
    ['missing issuer secret environment name', { ...baseConfig(), taskGrantIssuerSecretEnv: undefined }],
    ['shared badge and issuer environment name', {
      ...baseConfig(), taskGrantIssuerSecretEnv: 'HUMMER_RELAY_CONTROL_TOKEN',
    }],
    ['unknown scope', { ...baseConfig(), badges: [{ ...baseConfig().badges[0], scopes: ['root'] }] }],
  ])('rejects %s', (_label, value) => {
    expect(() => parseRelayConfig(value)).toThrow(RelayConfigError);
  });

  it('fails closed on a missing secret and still deletes the named environment entry', () => {
    const input = baseConfig();
    input.badges.push({
      ...input.badges[0],
      tokenEnv: 'HUMMER_RELAY_SECOND_TOKEN',
      tokenId: 'control-2',
    });
    const config = parseRelayConfig(input);
    const environment = {
      HUMMER_RELAY_CONTROL_TOKEN: 'short',
      HUMMER_RELAY_SECOND_TOKEN: 'b'.repeat(32),
    };
    expect(() => createConfiguredBadgeAuthenticator(config.badges, environment)).toThrow(/missing or invalid/);
    expect(environment).toEqual({});
  });

  it('fails closed on an invalid issuer secret and deletes the named environment entry', () => {
    const config = parseRelayConfig(baseConfig());
    const environment = { HUMMER_TASK_GRANT_ISSUER_SECRET: 'short' };
    expect(() => consumeTaskGrantIssuerSecret(config, environment)).toThrow(/missing or invalid/);
    expect(environment).toEqual({});
  });
});
