import { createHash, createHmac } from 'node:crypto';
import type { PersistedCapabilityGrant } from './badge-auth.js';
import { canonicalJson } from './canonical-json.js';
import { SqliteTaskGrantAuthority } from './sqlite-task-grant-authority.js';

export interface RelayTaskGrantIssueInput {
  grantRef: string;
  tenantId: string;
  workOrderId: string;
  nodeId: string;
  issuedToRunId: string;
  capabilities: readonly string[];
  paths: readonly string[];
  expiresAt: string;
  issuedAt: string;
}

export interface RelayIssuedTaskGrant {
  token: string;
  grantRef: string;
  expiresAt: string;
}

export interface TaskGrantIssuer {
  issue(input: RelayTaskGrantIssueInput): RelayIssuedTaskGrant;
}

export class DeterministicTaskGrantIssuer implements TaskGrantIssuer {
  readonly #secret: string;
  readonly #authority: SqliteTaskGrantAuthority;

  constructor(secret: string, authority: SqliteTaskGrantAuthority) {
    if (typeof secret !== 'string' || secret.length < 32 || /\s/u.test(secret)) {
      throw new Error('task grant issuer secret must be at least 32 non-whitespace characters');
    }
    this.#secret = secret;
    this.#authority = authority;
  }

  issue(input: RelayTaskGrantIssueInput): RelayIssuedTaskGrant {
    const material = canonicalIssueMaterial(input);
    const token = `hgr_${createHmac('sha256', this.#secret).update(canonicalJson(material), 'utf8').digest('base64url')}`;
    const grant: PersistedCapabilityGrant = {
      grantId: grantIdFromRef(input.grantRef),
      tenantId: input.tenantId,
      workOrderId: input.workOrderId,
      nodeId: input.nodeId,
      capabilities: [...input.capabilities],
      paths: [...input.paths],
      expiresAt: input.expiresAt,
      maxUses: 1,
      usedCount: 0,
      issuedToRunId: input.issuedToRunId,
      tokenRef: input.grantRef,
      issuedAt: input.issuedAt,
      issuedByAuthorityRef: 'system:relay-task-grant-issuer',
      status: 'active',
      tokenDigest: sha256(token),
    };
    this.#authority.importSnapshot({
      schema: 'hummer.task-grant-snapshot', version: 1, tenantId: input.tenantId, grants: [grant],
    });
    return { token, grantRef: input.grantRef, expiresAt: input.expiresAt };
  }
}

function grantIdFromRef(grantRef: string): string {
  const grantId = grantRef.startsWith('grant:') ? grantRef.slice('grant:'.length) : '';
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(grantId)) {
    throw new Error('task grant reference must be grant:<safe-id>');
  }
  return grantId;
}

function canonicalIssueMaterial(input: RelayTaskGrantIssueInput): Record<string, unknown> {
  for (const [field, value] of Object.entries(input)) {
    if (typeof value === 'string' && !value) throw new Error(`task grant ${field} is required`);
  }
  if (!Number.isFinite(Date.parse(input.expiresAt)) || !Number.isFinite(Date.parse(input.issuedAt))
    || Date.parse(input.expiresAt) <= Date.parse(input.issuedAt)) {
    throw new Error('task grant issuance timestamps are invalid');
  }
  if (!Array.isArray(input.capabilities) || input.capabilities.length === 0
    || input.capabilities.some((value) => typeof value !== 'string' || !value)
    || new Set(input.capabilities).size !== input.capabilities.length
    || !input.capabilities.includes('task.execute')) {
    throw new Error('task grant issuance capabilities are invalid');
  }
  if (!Array.isArray(input.paths) || input.paths.some((value) => typeof value !== 'string' || !value)
    || new Set(input.paths).size !== input.paths.length) {
    throw new Error('task grant issuance paths are invalid');
  }
  return {
    grantRef: input.grantRef,
    tenantId: input.tenantId,
    workOrderId: input.workOrderId,
    nodeId: input.nodeId,
    issuedToRunId: input.issuedToRunId,
    capabilities: [...input.capabilities],
    paths: [...input.paths],
    expiresAt: new Date(input.expiresAt).toISOString(),
    maxUses: 1,
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
