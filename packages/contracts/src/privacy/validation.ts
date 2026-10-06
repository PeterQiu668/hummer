import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Static, TSchema } from '@sinclair/typebox';
import {
  DemoSessionV1Schema,
  PrivacyContractSchemas,
  type DemoSessionV1,
  type PrivacyContractName,
} from './schemas.ts';

export type PrivacyValidationResult<T> =
  | { value: T; issues?: undefined }
  | { value?: undefined; issues: ReadonlyArray<StandardSchemaV1.Issue> };

const validators = Object.fromEntries(
  Object.entries(PrivacyContractSchemas).map(([name, schema]) => {
    const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: false });
    return [name, ajv.compile(schema)];
  }),
) as Record<PrivacyContractName, ValidateFunction>;

export function validatePrivacyContract<Name extends PrivacyContractName>(
  name: Name,
  value: unknown,
): PrivacyValidationResult<Static<(typeof PrivacyContractSchemas)[Name]>> {
  const validator = validators[name];
  if (!validator(value)) return { issues: issuesFrom(validator.errors) };
  return validateDemoSessionSemantics(value as DemoSessionV1) as PrivacyValidationResult<
    Static<(typeof PrivacyContractSchemas)[Name]>
  >;
}

function validateDemoSessionSemantics(session: DemoSessionV1): PrivacyValidationResult<DemoSessionV1> {
  if (session.endedAt && session.endedAt < session.startedAt) {
    return issue('/endedAt must not precede /startedAt', ['endedAt']);
  }
  if ((session.status === 'ended') !== Boolean(session.endedAt)) {
    return issue('/endedAt is required only for an ended session', ['endedAt']);
  }
  if (session.redactionApplied !== Boolean(session.redactionPolicyRef)) {
    return issue('/redactionPolicyRef is required exactly when redactionApplied is true', ['redactionPolicyRef']);
  }
  if (session.chainHead !== session.segments.at(-1)?.digest) {
    return issue('/chainHead must equal the final segment digest', ['chainHead']);
  }
  const segmentIds = new Set<string>();
  let previousDigest: string | null = null;
  let previousFrom = session.startedAt;
  let openSegments = 0;
  for (const [index, segment] of session.segments.entries()) {
    if (segmentIds.has(segment.segId)) return issue('/segments must have unique segId values', ['segments', index, 'segId']);
    segmentIds.add(segment.segId);
    if (segment.sequence !== index + 1) return issue('/segments must have gapless sequence values', ['segments', index, 'sequence']);
    if (segment.previousDigest !== previousDigest) return issue('/segments form a broken digest chain', ['segments', index, 'previousDigest']);
    if (segment.from < session.startedAt || (index > 0 && segment.from < previousFrom)) {
      return issue('/segments must be chronological', ['segments', index, 'from']);
    }
    if (segment.to && segment.to < segment.from) return issue('/segment /to must not precede /from', ['segments', index, 'to']);
    if (segment.deletedAt && segment.deletedAt < segment.from) {
      return issue('/segment /deletedAt must not precede /from', ['segments', index, 'deletedAt']);
    }
    if (segment.deletedAt && segment.recordCount !== 0) {
      return issue('/deleted segment recordCount must be zero', ['segments', index, 'recordCount']);
    }
    if (!segment.to && !segment.deletedAt) openSegments += 1;
    previousDigest = segment.digest;
    previousFrom = segment.from;
  }
  if ((session.status === 'capturing' && openSegments !== 1) ||
      (session.status !== 'capturing' && openSegments !== 0)) {
    return issue('/segments do not match the session status', ['segments']);
  }
  const deletedIds = new Set(session.segments.filter((segment) => segment.deletedAt).map((segment) => segment.segId));
  const segmentById = new Map(session.segments.map((segment) => [segment.segId, segment]));
  const auditedIds = new Set<string>();
  for (const [index, entry] of session.deletionAudit.entries()) {
    if (auditedIds.has(entry.segId)) return issue('/deletionAudit must contain at most one entry per segment', ['deletionAudit', index, 'segId']);
    auditedIds.add(entry.segId);
    if (!deletedIds.has(entry.segId)) return issue('/deletionAudit references a non-deleted segment', ['deletionAudit', index, 'segId']);
    if (entry.replacementDigest !== segmentById.get(entry.segId)?.digest) {
      return issue('/deletionAudit replacementDigest must match the tombstone digest', ['deletionAudit', index, 'replacementDigest']);
    }
    if (entry.purgedAt < entry.requestedAt) return issue('/purgedAt must not precede /requestedAt', ['deletionAudit', index, 'purgedAt']);
  }
  if ([...deletedIds].some((segId) => !auditedIds.has(segId))) {
    return issue('/every deleted segment requires a deletionAudit entry', ['deletionAudit']);
  }
  return { value: session };
}

function standardSchema<TSchemaValue extends TSchema>(
  name: PrivacyContractName,
  schema: TSchemaValue,
): StandardSchemaV1<unknown, Static<TSchemaValue>> & { readonly jsonSchema: TSchemaValue } {
  return {
    jsonSchema: schema,
    '~standard': {
      version: 1,
      vendor: 'hummer-typebox-ajv',
      validate(value) {
        return validatePrivacyContract(name, value) as PrivacyValidationResult<Static<TSchemaValue>>;
      },
    },
  };
}

export const DemoSessionV1StandardSchema = standardSchema('DemoSessionV1', DemoSessionV1Schema);

function pointerPath(pointer: string): PropertyKey[] | undefined {
  if (!pointer) return undefined;
  return pointer.slice(1).split('/').map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'));
}

function issuesFrom(errors: ErrorObject[] | null | undefined): StandardSchemaV1.Issue[] {
  return (errors ?? []).map((error) => ({
    message: `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`,
    path: pointerPath(error.instancePath),
  }));
}

function issue(message: string, path?: PropertyKey[]): PrivacyValidationResult<never> {
  return { issues: [{ message, path }] };
}
