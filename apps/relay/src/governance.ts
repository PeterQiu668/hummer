import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical-json.js';
import {
  FleetRejectedError,
  type FleetObject,
  type TenantAuditAction,
  type TenantAuditEvent,
  type TenantAuditExport,
  type TenantAuditExportManifest,
  type TenantChainHead,
  type TenantQuotaLimits,
  type TenantQuotaMetric,
  type TenantQuotaUsage,
} from './ports.js';

export const TENANT_QUOTA_METRICS = ['tasks', 'tokens', 'costCny'] as const satisfies readonly TenantQuotaMetric[];

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function utcDay(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new FleetRejectedError('invalid_contract', 'quota time must be an ISO timestamp');
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function assertQuotaDay(day: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || new Date(`${day}T00:00:00.000Z`).toISOString().slice(0, 10) !== day) {
    throw new FleetRejectedError('invalid_contract', 'quota day must be a UTC calendar date');
  }
}

export function validateQuotaLimits(input: unknown): TenantQuotaLimits {
  if (!isRecord(input)) throw new FleetRejectedError('invalid_contract', 'quota limits must be an object');
  const unknown = Object.keys(input).find((key) => !TENANT_QUOTA_METRICS.includes(key as TenantQuotaMetric));
  if (unknown || Object.keys(input).length === 0) throw new FleetRejectedError('invalid_contract', 'quota limits contain unsupported or no metrics');
  const result: TenantQuotaLimits = {};
  for (const metric of TENANT_QUOTA_METRICS) {
    const value = input[metric];
    if (value === undefined) continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > Number.MAX_SAFE_INTEGER
      || (metric !== 'costCny' && !Number.isSafeInteger(value))) {
      throw new FleetRejectedError('invalid_contract', 'quota limits must be positive finite values');
    }
    result[metric] = value;
  }
  if (Object.keys(result).length === 0) throw new FleetRejectedError('invalid_contract', 'quota limits contain no values');
  return result;
}

export function validateQuotaUsage(input: unknown): TenantQuotaUsage {
  if (!isRecord(input)) throw new FleetRejectedError('invalid_contract', 'quota usage must be an object');
  const allowed = ['tokens', 'costCny'];
  const unknown = Object.keys(input).find((key) => !allowed.includes(key));
  if (unknown || Object.keys(input).length === 0) throw new FleetRejectedError('invalid_contract', 'quota usage contains unsupported or no metrics');
  const result: TenantQuotaUsage = {};
  for (const metric of allowed as Array<'tokens' | 'costCny'>) {
    const value = input[metric];
    if (value === undefined) continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > Number.MAX_SAFE_INTEGER
      || (metric === 'tokens' && !Number.isSafeInteger(value))) {
      throw new FleetRejectedError('invalid_contract', 'quota usage must be positive finite values');
    }
    result[metric] = value;
  }
  if (Object.keys(result).length === 0) throw new FleetRejectedError('invalid_contract', 'quota usage contains no values');
  return result;
}

export function buildTenantAuditEvent(input: {
  tenantId: string;
  position: number;
  action: TenantAuditAction;
  subjectRef: string;
  nodeId: string | null;
  actorRef: string;
  at: string;
  metadata: FleetObject;
  previousHash: string | null;
}): TenantAuditEvent {
  const material = {
    tenantId: input.tenantId,
    position: input.position,
    action: input.action,
    subjectRef: input.subjectRef,
    nodeId: input.nodeId,
    actorRef: input.actorRef,
    at: input.at,
    metadata: input.metadata,
    previousHash: input.previousHash,
  };
  return { ...material, hash: sha256(canonicalJson(material)) };
}

export type TenantAuditVerification =
  | { valid: true; position: number; hash: string | null }
  | { valid: false; position: number; reason: 'tenant_mismatch' | 'position_gap' | 'previous_hash_mismatch' | 'hash_mismatch' };

export function verifyTenantAuditChain(tenantId: string, events: readonly TenantAuditEvent[]): TenantAuditVerification {
  let previousHash: string | null = null;
  let position = 0;
  for (const event of events) {
    position += 1;
    if (event.tenantId !== tenantId) return { valid: false, position, reason: 'tenant_mismatch' };
    if (event.position !== position) return { valid: false, position, reason: 'position_gap' };
    if (event.previousHash !== previousHash) return { valid: false, position, reason: 'previous_hash_mismatch' };
    const rebuilt = buildTenantAuditEvent({
      tenantId: event.tenantId,
      position: event.position,
      action: event.action,
      subjectRef: event.subjectRef,
      nodeId: event.nodeId,
      actorRef: event.actorRef,
      at: event.at,
      metadata: event.metadata,
      previousHash: event.previousHash,
    });
    if (rebuilt.hash !== event.hash) return { valid: false, position, reason: 'hash_mismatch' };
    previousHash = event.hash;
  }
  return { valid: true, position, hash: previousHash };
}

export type TenantAuditExportVerification =
  | { valid: true; eventCount: number; chainHeadHash: string }
  | { valid: false; reason: 'tenant_mismatch' | 'range_mismatch' | 'chain_mismatch' | 'entries_hash_mismatch' | 'manifest_hash_mismatch' | 'export_id_mismatch' };

export function verifyTenantAuditExport(
  auditExport: TenantAuditExport,
  events: readonly TenantAuditEvent[],
): TenantAuditExportVerification {
  const manifest = auditExport.manifest;
  if (auditExport.tenantId !== manifest.tenantId || events.some((event) => event.tenantId !== manifest.tenantId)) {
    return { valid: false, reason: 'tenant_mismatch' };
  }
  if (events.length === 0
    || auditExport.rangeFrom !== manifest.rangeFrom
    || auditExport.rangeTo !== manifest.rangeTo
    || events[0]!.position !== manifest.rangeFrom
    || events.at(-1)!.position !== manifest.rangeTo
    || events.length !== manifest.eventCount) {
    return { valid: false, reason: 'range_mismatch' };
  }
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    const expectedPosition = manifest.rangeFrom + index;
    const expectedPrevious = index === 0 ? manifest.firstPreviousHash : events[index - 1]!.hash;
    const rebuilt = buildTenantAuditEvent({
      tenantId: event.tenantId, position: event.position, action: event.action,
      subjectRef: event.subjectRef, nodeId: event.nodeId, actorRef: event.actorRef,
      at: event.at, metadata: event.metadata, previousHash: event.previousHash,
    });
    if (event.position !== expectedPosition || event.previousHash !== expectedPrevious || event.hash !== rebuilt.hash) {
      return { valid: false, reason: 'chain_mismatch' };
    }
  }
  if (events.at(-1)!.hash !== manifest.chainHeadHash) return { valid: false, reason: 'chain_mismatch' };
  if (sha256(canonicalJson(events)) !== manifest.entriesSha256) return { valid: false, reason: 'entries_hash_mismatch' };
  const manifestHash = sha256(canonicalJson(manifest));
  if (auditExport.sha256 !== manifestHash) return { valid: false, reason: 'manifest_hash_mismatch' };
  if (auditExport.exportId !== `audit-export-${manifestHash.slice(0, 24)}`) return { valid: false, reason: 'export_id_mismatch' };
  return { valid: true, eventCount: events.length, chainHeadHash: manifest.chainHeadHash };
}

export function buildAuditExport(
  tenantId: string,
  events: readonly TenantAuditEvent[],
  createdAt: string,
): TenantAuditExport {
  if (events.length === 0) throw new FleetRejectedError('audit_export_not_found', 'audit range was not found');
  const rangeFrom = events[0]!.position;
  const rangeTo = events.at(-1)!.position;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    const expectedPrevious = index === 0 ? event.previousHash : events[index - 1]!.hash;
    const rebuilt = buildTenantAuditEvent({
      tenantId: event.tenantId, position: event.position, action: event.action,
      subjectRef: event.subjectRef, nodeId: event.nodeId, actorRef: event.actorRef,
      at: event.at, metadata: event.metadata, previousHash: event.previousHash,
    });
    if (event.tenantId !== tenantId || event.position !== rangeFrom + index
      || event.previousHash !== expectedPrevious || event.hash !== rebuilt.hash) {
      throw new FleetRejectedError('audit_export_not_found', 'audit range was not found');
    }
  }
  const manifest: TenantAuditExportManifest = {
    schema: 'hummer.relay-audit-export',
    version: 1,
    tenantId,
    rangeFrom,
    rangeTo,
    eventCount: events.length,
    firstPreviousHash: events[0]!.previousHash,
    chainHeadHash: events.at(-1)!.hash,
    entriesSha256: sha256(canonicalJson(events)),
    createdAt,
  };
  const digest = sha256(canonicalJson(manifest));
  return {
    exportId: `audit-export-${digest.slice(0, 24)}`,
    tenantId,
    rangeFrom,
    rangeTo,
    sha256: digest,
    createdAt,
    manifest,
  };
}

export function chainHeadFrom(event: TenantAuditEvent): TenantChainHead {
  return { tenantId: event.tenantId, position: event.position, hash: event.hash, updatedAt: event.at };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
