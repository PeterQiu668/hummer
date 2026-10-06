import Ajv2020 from 'ajv/dist/2020.js';
import {
  CapabilityPackageAuthorInputSchema,
  CapabilityPackageV1Schema,
  TeamReadOnlyShareSchema,
} from '../../../packages/contracts/src/capability/schemas';
import type { CapabilityCatalogItem } from './capabilityCatalogClient';

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateAuthor = ajv.compile(CapabilityPackageAuthorInputSchema);
const validatePackage = ajv.compile(CapabilityPackageV1Schema);
const validateShare = ajv.compile(TeamReadOnlyShareSchema);

/** Browser-safe, fail-closed validation for the Relay-only catalog envelope. */
export function isCapabilityCatalogItem(value: unknown): value is CapabilityCatalogItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  if (item.access !== 'owner' && item.access !== 'read_only') return false;
  if (!item.record || typeof item.record !== 'object') return false;
  const record = item.record as Record<string, unknown>;
  const statuses = new Set(['draft', 'shadow', 'verified', 'shared']);
  if (typeof record.tenantId !== 'string'
    || typeof record.packageId !== 'string'
    || !Number.isInteger(record.packageVersion)
    || typeof record.packageDigest !== 'string'
    || !/^[a-f0-9]{64}$/.test(record.packageDigest)
    || !record.author
    || typeof record.author !== 'object'
    || typeof record.status !== 'string'
    || !statuses.has(record.status)
    || typeof record.sourceTaskId !== 'string'
    || typeof record.artifactEventId !== 'string'
    || typeof record.completedEventId !== 'string'
    || typeof record.createdAt !== 'string') return false;
  if (!validateAuthor(record.author)) return false;
  const author = record.author as Record<string, unknown>;
  if (author.tenantId !== record.tenantId
    || author.packageId !== record.packageId
    || author.packageVersion !== record.packageVersion) return false;
  if (record.trialRecord === null) {
    if (record.status !== 'draft') return false;
  } else if (!validatePackage({
    ...author,
    schema: 'hummer.capability-package',
    packageDigest: record.packageDigest,
    trialRecord: record.trialRecord,
    status: record.status,
  })) return false;
  if (item.access === 'owner') return item.share === null;
  if (!validateShare(item.share) || !item.share || typeof item.share !== 'object') return false;
  const share = item.share as Record<string, unknown>;
  return share.access === 'read_only'
    && share.packageId === record.packageId
    && share.packageVersion === record.packageVersion
    && share.packageDigest === record.packageDigest;
}
