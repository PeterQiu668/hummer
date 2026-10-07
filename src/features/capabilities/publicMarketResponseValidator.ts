import type { PublicCapabilityListing } from './publicMarketClient';

const digest = /^[a-f0-9]{64}$/;
const topLevelFields = new Set([
  'schema', 'version', 'listingId', 'status', 'packageId', 'packageVersion', 'packageDigest',
  'integrity', 'title', 'goal', 'publisherRef', 'provenance', 'sourceBoundary', 'trialRecord',
  'failureNotes', 'declaredPermissions', 'receiptRef', 'evidenceCount', 'publishedAt',
]);

/** Browser-side fail-closed validation for the redacted public projection. */
export function isPublicCapabilityListing(value: unknown): value is PublicCapabilityListing {
  if (!record(value) || Object.keys(value).some((key) => !topLevelFields.has(key))) return false;
  if (value.schema !== 'hummer.public-capability-listing' || value.version !== 1 || value.status !== 'public') return false;
  if (!text(value.listingId) || !text(value.packageId) || !positiveInteger(value.packageVersion)
    || !sha(value.packageDigest) || !text(value.title) || !text(value.goal)
    || !/^publisher:[a-f0-9]{16}$/.test(String(value.publisherRef))
    || !text(value.receiptRef) || !nonNegativeInteger(value.evidenceCount)
    || !timestamp(value.publishedAt)) return false;
  if (!record(value.integrity) || value.integrity.kind !== 'package_digest'
    || value.integrity.digest !== value.packageDigest) return false;
  if (!record(value.provenance)
    || !timestamp(value.provenance.capturedAt)
    || !text(value.provenance.runtime)
    || !text(value.provenance.runtimeVersion)
    || !text(value.provenance.agentVersion)
    || !nonNegativeInteger(value.provenance.demoSessionCount)) return false;
  if (!record(value.sourceBoundary)
    || !counts(value.sourceBoundary, ['applicationCount', 'windowPatternCount', 'includePathCount', 'excludePathCount'])) return false;
  if (!record(value.trialRecord)
    || !counts(value.trialRecord, ['shadowRuns', 'success', 'failure'])
    || !timestamp(value.trialRecord.lastRunAt)
    || typeof value.trialRecord.regressionPassed !== 'boolean'
    || !sha(value.trialRecord.regressionEvidenceDigest)) return false;
  if (!Array.isArray(value.failureNotes) || value.failureNotes.some((note) => !record(note)
    || note.summary !== 'Publisher-recorded failure note' || !sha(note.digest))) return false;
  if (!Array.isArray(value.declaredPermissions) || value.declaredPermissions.some((permission) => !record(permission)
    || !text(permission.capability) || !text(permission.access) || !Array.isArray(permission.paths)
    || permission.paths.some((path) => !text(path)))) return false;
  return true;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function sha(value: unknown): value is string {
  return typeof value === 'string' && digest.test(value);
}

function timestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function positiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function counts(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return fields.every((field) => nonNegativeInteger(value[field]));
}
