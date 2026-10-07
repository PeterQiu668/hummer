import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import {
  BADGE_SCOPES,
  createStaticBadgeTokenAuthenticator,
  type BadgeScope,
  type BadgeTokenAuthenticator,
  type StaticBadgeToken,
} from './badge-auth.js';

export const RELAY_CONFIG_SCHEMA = 'hummer.relay-config' as const;
export const RELAY_CONFIG_VERSION = 1 as const;

export interface RelayBadgeConfig {
  tokenEnv: string;
  tokenId: string;
  tenantId: string;
  actorRef: string;
  scopes: readonly BadgeScope[];
  expiresAt: string;
  nodeId?: string;
  grantRef?: string;
  authorizedTenantIds?: readonly string[];
}

export interface RelayConfigV1 {
  schema: typeof RELAY_CONFIG_SCHEMA;
  version: typeof RELAY_CONFIG_VERSION;
  host: '127.0.0.1';
  port: number;
  databasePath: string;
  badges: readonly RelayBadgeConfig[];
}

const configFields = new Set(['schema', 'version', 'host', 'port', 'databasePath', 'badges']);
const badgeFields = new Set([
  'tokenEnv', 'tokenId', 'tenantId', 'actorRef', 'scopes', 'expiresAt', 'nodeId', 'grantRef',
  'authorizedTenantIds',
]);
const allowedScopes = new Set<string>(BADGE_SCOPES);
const tokenEnvPattern = /^[A-Z_][A-Z0-9_]*$/;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const actorPattern = /^(?:human|account|system):[A-Za-z0-9_-]+$/;

export class RelayConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RelayConfigError';
  }
}

function record(input: unknown, subject: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new RelayConfigError(`${subject} must be an object`);
  }
  return input as Record<string, unknown>;
}

function exactFields(input: Record<string, unknown>, allowed: ReadonlySet<string>, subject: string): void {
  const unknown = Object.keys(input).find((key) => !allowed.has(key));
  if (unknown) throw new RelayConfigError(`${subject} contains unknown field ${unknown}`);
}

function requiredText(input: unknown, field: string, pattern = identifierPattern): string {
  if (typeof input !== 'string' || !pattern.test(input)) {
    throw new RelayConfigError(`${field} is invalid`);
  }
  return input;
}

function optionalText(input: unknown, field: string): string | undefined {
  return input === undefined ? undefined : requiredText(input, field);
}

function stringList(input: unknown, field: string, validate: (value: string) => boolean): readonly string[] {
  if (!Array.isArray(input) || input.length === 0 || input.some((value) => typeof value !== 'string' || !validate(value))) {
    throw new RelayConfigError(`${field} must be a non-empty array of supported unique strings`);
  }
  if (new Set(input).size !== input.length) {
    throw new RelayConfigError(`${field} must be a non-empty array of supported unique strings`);
  }
  return [...input] as string[];
}

function parseBadge(input: unknown, index: number): RelayBadgeConfig {
  const value = record(input, `badges[${index}]`);
  exactFields(value, badgeFields, `badges[${index}]`);
  const tokenEnv = requiredText(value.tokenEnv, `badges[${index}].tokenEnv`, tokenEnvPattern);
  const tokenId = requiredText(value.tokenId, `badges[${index}].tokenId`);
  const tenantId = requiredText(value.tenantId, `badges[${index}].tenantId`);
  const actorRef = requiredText(value.actorRef, `badges[${index}].actorRef`, actorPattern);
  const scopes = stringList(value.scopes, `badges[${index}].scopes`, (scope) => allowedScopes.has(scope)) as BadgeScope[];
  if (typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt))) {
    throw new RelayConfigError(`badges[${index}].expiresAt must be an ISO timestamp`);
  }
  const expiresAt = new Date(value.expiresAt).toISOString();
  const nodeId = optionalText(value.nodeId, `badges[${index}].nodeId`);
  const grantRef = optionalText(value.grantRef, `badges[${index}].grantRef`);
  if (nodeId && actorRef !== `system:${nodeId}`) {
    throw new RelayConfigError(`badges[${index}].actorRef must match its nodeId`);
  }
  if (!nodeId && actorRef.startsWith('system:')) {
    throw new RelayConfigError(`badges[${index}].nodeId is required for a system actor`);
  }
  const authorizedTenantIds = value.authorizedTenantIds === undefined
    ? undefined
    : stringList(value.authorizedTenantIds, `badges[${index}].authorizedTenantIds`, (entry) => identifierPattern.test(entry));
  if (authorizedTenantIds && (!authorizedTenantIds.includes(tenantId) || (authorizedTenantIds.length > 1 && !grantRef))) {
    throw new RelayConfigError(`badges[${index}].authorizedTenantIds is invalid`);
  }
  return {
    tokenEnv, tokenId, tenantId, actorRef, scopes, expiresAt,
    ...(nodeId ? { nodeId } : {}),
    ...(grantRef ? { grantRef } : {}),
    ...(authorizedTenantIds ? { authorizedTenantIds } : {}),
  };
}

export function parseRelayConfig(input: unknown): RelayConfigV1 {
  const value = record(input, 'relay config');
  exactFields(value, configFields, 'relay config');
  if (value.schema !== RELAY_CONFIG_SCHEMA || value.version !== RELAY_CONFIG_VERSION) {
    throw new RelayConfigError(`relay config must use ${RELAY_CONFIG_SCHEMA} version ${RELAY_CONFIG_VERSION}`);
  }
  if (value.host !== '127.0.0.1') {
    throw new RelayConfigError('relay host must be a loopback IP literal');
  }
  if (!Number.isSafeInteger(value.port) || (value.port as number) < 0 || (value.port as number) > 65_535) {
    throw new RelayConfigError('relay port must be an integer from 0 through 65535');
  }
  if (typeof value.databasePath !== 'string' || !isAbsolute(value.databasePath)) {
    throw new RelayConfigError('databasePath must be an absolute path');
  }
  if (!Array.isArray(value.badges) || value.badges.length === 0) {
    throw new RelayConfigError('badges must be a non-empty array');
  }
  const badges = value.badges.map(parseBadge);
  if (new Set(badges.map((badge) => badge.tokenEnv)).size !== badges.length) {
    throw new RelayConfigError('badge tokenEnv values must be unique');
  }
  if (new Set(badges.map((badge) => badge.tokenId)).size !== badges.length) {
    throw new RelayConfigError('badge tokenId values must be unique');
  }
  return {
    schema: RELAY_CONFIG_SCHEMA,
    version: RELAY_CONFIG_VERSION,
    host: value.host,
    port: value.port as number,
    databasePath: value.databasePath,
    badges,
  };
}

export async function loadRelayConfig(configPath: string): Promise<RelayConfigV1> {
  if (!isAbsolute(configPath)) throw new RelayConfigError('--config must be an absolute path');
  let text: string;
  try {
    text = await readFile(configPath, 'utf8');
  } catch {
    throw new RelayConfigError('relay config could not be read');
  }
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    throw new RelayConfigError('relay config is not valid JSON');
  }
  return parseRelayConfig(input);
}

export function createConfiguredBadgeAuthenticator(
  badges: readonly RelayBadgeConfig[],
  environment: NodeJS.ProcessEnv = process.env,
): BadgeTokenAuthenticator {
  const tokens: StaticBadgeToken[] = [];
  let invalidEnvironmentName: string | undefined;
  for (const badge of badges) {
    const token = environment[badge.tokenEnv];
    Reflect.deleteProperty(environment, badge.tokenEnv);
    if (typeof token !== 'string' || token.length < 32 || /\s/.test(token)) {
      invalidEnvironmentName ??= badge.tokenEnv;
      continue;
    }
    const { tokenEnv: _tokenEnv, ...claims } = badge;
    tokens.push({ token, ...claims });
  }
  if (invalidEnvironmentName) {
    throw new RelayConfigError(`badge environment variable ${invalidEnvironmentName} is missing or invalid`);
  }
  return createStaticBadgeTokenAuthenticator(tokens);
}
