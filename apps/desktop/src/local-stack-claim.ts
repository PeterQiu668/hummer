import { connect } from 'node:net';
import { isAbsolute } from 'node:path';
import type { DesktopRelayTrustedConfig } from './desktop-relay-host.js';

const PIPE_ENV = 'HUMMER_LOCAL_STACK_CLAIM_PIPE';
const TOKEN_ENV = 'HUMMER_LOCAL_STACK_CLAIM_TOKEN';
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const ACCOUNT_ACTOR = /^account:[A-Za-z0-9_-]+$/u;

export interface LocalStackIdentity {
  tenantId: string;
  actorRef: string;
}

export interface LocalStackClaimClient {
  claim(identity: LocalStackIdentity): Promise<DesktopRelayTrustedConfig>;
}

export function consumeLocalStackClaimClient(
  environment: NodeJS.ProcessEnv = process.env,
): LocalStackClaimClient | null {
  const pipeName = environment[PIPE_ENV]?.trim() ?? '';
  const token = environment[TOKEN_ENV]?.trim() ?? '';
  delete environment[PIPE_ENV];
  delete environment[TOKEN_ENV];
  if (!pipeName && !token) return null;
  if (!pipeName || !token) throw new Error('Local stack claim configuration is incomplete');
  if (!validPipeName(pipeName)) throw new Error('Local stack claim pipe is not local');
  if (token.length < 32 || /\s/u.test(token)) throw new Error('Local stack claim token is invalid');
  let boundIdentity: LocalStackIdentity | null = null;
  let inFlight: Promise<DesktopRelayTrustedConfig> | null = null;
  return {
    claim(identity) {
      const parsed = validateIdentity(identity);
      if (boundIdentity && (boundIdentity.tenantId !== parsed.tenantId || boundIdentity.actorRef !== parsed.actorRef)) {
        return Promise.reject(new LocalStackClaimError('identity_already_bound', 'Local stack is already bound to another Desktop identity'));
      }
      if (inFlight) return inFlight;
      inFlight = requestClaim(pipeName, token, parsed).then((config) => {
        boundIdentity = parsed;
        return config;
      }).finally(() => { inFlight = null; });
      return inFlight;
    },
  };
}

export class LocalStackClaimError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'LocalStackClaimError';
  }
}

function requestClaim(
  pipeName: string,
  token: string,
  identity: LocalStackIdentity,
): Promise<DesktopRelayTrustedConfig> {
  return new Promise((resolveClaim, reject) => {
    const socket = connect(pipeName);
    let buffer = '';
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.end();
      callback();
    };
    const timer = setTimeout(() => finish(() => reject(new LocalStackClaimError(
      'claim_timeout', 'Local stack identity claim timed out',
    ))), 10_000);
    socket.setEncoding('utf8');
    socket.once('connect', () => socket.write(`${JSON.stringify({
      command: 'claim', auth: token, identity,
    })}\n`));
    socket.on('data', (chunk) => {
      buffer += chunk;
      if (buffer.length > 16_384) return finish(() => reject(new LocalStackClaimError(
        'invalid_claim_response', 'Local stack claim response exceeded its limit',
      )));
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      finish(() => {
        let value: unknown;
        try { value = JSON.parse(buffer.slice(0, newline)); } catch {
          reject(new LocalStackClaimError('invalid_claim_response', 'Local stack returned invalid JSON'));
          return;
        }
        try { resolveClaim(parseClaimResult(value, identity)); }
        catch (error) { reject(redactError(error, token)); }
      });
    });
    socket.once('error', () => finish(() => reject(new LocalStackClaimError(
      'claim_unavailable', 'Local stack identity claim pipe is unavailable',
    ))));
  });
}

function parseClaimResult(value: unknown, expected: LocalStackIdentity): DesktopRelayTrustedConfig {
  if (value && typeof value === 'object' && !Array.isArray(value) && 'error' in value) {
    const error = exactOptionalError(value);
    throw new LocalStackClaimError(error.code, error.message);
  }
  const result = exactRecord(value, ['schema', 'version', 'identity', 'relay'], 'claim result');
  if (result.schema !== 'hummer.local-stack-claim-result' || result.version !== 1) {
    throw new LocalStackClaimError('invalid_claim_response', 'Local stack returned an invalid claim response');
  }
  const identity = validateIdentity(result.identity);
  if (identity.tenantId !== expected.tenantId || identity.actorRef !== expected.actorRef) {
    throw new LocalStackClaimError('claim_identity_mismatch', 'Local stack returned another identity');
  }
  const relay = exactRecord(result.relay, ['baseUrl', 'badgeToken', 'tenantId', 'actorRef'], 'claim relay config');
  if (typeof relay.baseUrl !== 'string' || typeof relay.badgeToken !== 'string'
    || relay.tenantId !== identity.tenantId || relay.actorRef !== identity.actorRef) {
    throw new LocalStackClaimError('invalid_claim_response', 'Local stack returned an invalid Relay configuration');
  }
  return {
    baseUrl: relay.baseUrl,
    badgeToken: relay.badgeToken,
    tenantId: identity.tenantId,
    actorRef: identity.actorRef,
  };
}

function exactOptionalError(value: unknown): { code: string; message: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { code: 'invalid_claim_response', message: 'Local stack returned an invalid claim response' };
  }
  const error = (value as { error?: unknown }).error;
  if (!error || typeof error !== 'object' || Array.isArray(error)) {
    return { code: 'invalid_claim_response', message: 'Local stack returned an invalid claim response' };
  }
  const record = error as Record<string, unknown>;
  return {
    code: typeof record.code === 'string' && /^[a-z][a-z0-9_]{0,63}$/u.test(record.code)
      ? record.code : 'claim_rejected',
    message: typeof record.message === 'string' ? record.message.slice(0, 512) : 'Local stack rejected the identity claim',
  };
}

function validateIdentity(value: unknown): LocalStackIdentity {
  const identity = exactRecord(value, ['tenantId', 'actorRef'], 'claim identity');
  if (typeof identity.tenantId !== 'string' || !IDENTIFIER.test(identity.tenantId)) {
    throw new LocalStackClaimError('invalid_claim_identity', 'Desktop tenant identity is invalid');
  }
  if (typeof identity.actorRef !== 'string' || !ACCOUNT_ACTOR.test(identity.actorRef)) {
    throw new LocalStackClaimError('invalid_claim_identity', 'Desktop account actor is invalid');
  }
  return { tenantId: identity.tenantId, actorRef: identity.actorRef };
}

function exactRecord(value: unknown, fields: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new LocalStackClaimError('invalid_claim_response', `${label} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const unknown = Object.keys(record).find((key) => !fields.includes(key));
  if (unknown) throw new LocalStackClaimError('invalid_claim_response', `${label} contains an unknown field`);
  return record;
}

function validPipeName(value: string): boolean {
  if (process.platform === 'win32') return /^\\\\\.\\pipe\\hummer-local-[a-f0-9]{24}$/u.test(value);
  return isAbsolute(value);
}

function redactError(error: unknown, token: string): Error {
  if (error instanceof LocalStackClaimError) {
    return new LocalStackClaimError(error.code, error.message.split(token).join('[redacted]'));
  }
  return new LocalStackClaimError('claim_rejected', 'Local stack rejected the identity claim');
}
