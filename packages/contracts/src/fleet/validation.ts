import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Static, TSchema } from '@sinclair/typebox';
import {
  ApprovalDecisionSchema,
  ApprovalRequestSchema,
  CapabilityGrantSchema,
  FleetContractNameBySchema,
  FleetContractSchemas,
  FLEET_CONTRACT_MAX_BYTES,
  NodeManifestSchema,
  RunEventSchema,
  TaskEnvelopeSchema,
  type ApprovalDecision,
  type CapabilityGrant,
  type FleetContractName,
  type RunEvent,
  type TaskEnvelope,
} from './schemas.ts';

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  validateFormats: false,
});

const validators = Object.fromEntries(
  Object.entries(FleetContractSchemas).map(([name, schema]) => [name, ajv.compile(schema)]),
) as Record<FleetContractName, ValidateFunction>;

function pointerPath(pointer: string): PropertyKey[] | undefined {
  if (!pointer) return undefined;
  return pointer
    .slice(1)
    .split('/')
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'));
}

function issuesFrom(errors: ErrorObject[] | null | undefined): StandardSchemaV1.Issue[] {
  return (errors ?? []).map((error) => ({
    message: `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`,
    path: pointerPath(error.instancePath),
  }));
}

export interface SecurityAlert {
  code: 'approval.system_decider';
  message: string;
  requestId?: string;
}

export interface FleetValidationOptions {
  onSecurityAlert?: (alert: SecurityAlert) => void;
}

export type FleetValidationResult<T> =
  | { value: T; issues?: undefined }
  | { value?: undefined; issues: ReadonlyArray<StandardSchemaV1.Issue> };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateFleetContract<Name extends FleetContractName>(
  name: Name,
  value: unknown,
  options: FleetValidationOptions = {},
): FleetValidationResult<Static<(typeof FleetContractSchemas)[Name]>> {
  if (
    name === 'ApprovalDecision' &&
    isRecord(value) &&
    typeof value.deciderActorRef === 'string' &&
    value.deciderActorRef.startsWith('system:')
  ) {
    options.onSecurityAlert?.({
      code: 'approval.system_decider',
      message: 'system actors cannot decide approval records',
      requestId: typeof value.requestId === 'string' ? value.requestId : undefined,
    });
  }

  const validator = validators[name];
  if (validator(value)) {
    if (name === 'CapabilityGrant') {
      const grant = value as CapabilityGrant;
      if (grant.usedCount > grant.maxUses) {
        return { issues: [{ message: '/usedCount must not exceed /maxUses', path: ['usedCount'] }] };
      }
    }
    return { value: value as Static<(typeof FleetContractSchemas)[Name]> };
  }

  return { issues: issuesFrom(validator.errors) };
}

function standardSchema<TSchemaValue extends TSchema>(
  name: FleetContractName,
  schema: TSchemaValue,
): StandardSchemaV1<unknown, Static<TSchemaValue>> & {
  readonly jsonSchema: TSchemaValue;
} {
  return {
    jsonSchema: schema,
    '~standard': {
      version: 1,
      vendor: 'hummer-typebox-ajv',
      validate(value) {
        return validateFleetContract(name, value) as FleetValidationResult<Static<TSchemaValue>>;
      },
    },
  };
}

export const NodeManifestStandardSchema = standardSchema('NodeManifest', NodeManifestSchema);
export const TaskEnvelopeStandardSchema = standardSchema('TaskEnvelope', TaskEnvelopeSchema);
export const RunEventStandardSchema = standardSchema('RunEvent', RunEventSchema);
export const ApprovalRequestStandardSchema = standardSchema('ApprovalRequest', ApprovalRequestSchema);
export const ApprovalDecisionStandardSchema = standardSchema('ApprovalDecision', ApprovalDecisionSchema);
export const CapabilityGrantStandardSchema = standardSchema('CapabilityGrant', CapabilityGrantSchema);

export type DecodedFleetContract = {
  [Name in FleetContractName]: {
    name: Name;
    value: Static<(typeof FleetContractSchemas)[Name]>;
  };
}[FleetContractName];

export function decodeFleetContract(
  bytes: Uint8Array,
  expectedName?: FleetContractName,
  options: FleetValidationOptions = {},
): FleetValidationResult<DecodedFleetContract> {
  if (bytes.byteLength > FLEET_CONTRACT_MAX_BYTES) {
    return { issues: [{ message: `payload exceeds ${FLEET_CONTRACT_MAX_BYTES} bytes` }] };
  }

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { issues: [{ message: 'payload is not valid UTF-8' }] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { issues: [{ message: 'payload is not valid JSON' }] };
  }

  if (!isRecord(parsed) || typeof parsed.schema !== 'string') {
    return { issues: [{ message: '/schema is required to select a fleet contract' }] };
  }

  const name = FleetContractNameBySchema[parsed.schema as keyof typeof FleetContractNameBySchema];
  if (!name) {
    return { issues: [{ message: `/schema contains unsupported contract ${parsed.schema}` }] };
  }
  if (expectedName && name !== expectedName) {
    return { issues: [{ message: `/schema identifies ${name}; expected ${expectedName}` }] };
  }

  const validated = validateFleetContract(name, parsed, options);
  if (validated.issues) return validated;
  return { value: { name, value: validated.value } as DecodedFleetContract };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function createTaskEnvelopeIdempotencyGuard<Result>() {
  const accepted = new Map<string, { fingerprint: string; result: Result }>();
  let eventCount = 0;

  return {
    accept(envelope: TaskEnvelope, create: () => Result) {
      const validated = validateFleetContract('TaskEnvelope', envelope);
      if (validated.issues) throw new Error(`invalid TaskEnvelope: ${validated.issues[0]?.message}`);
      const acceptedEnvelope = validated.value;
      const key = `${acceptedEnvelope.tenantId}\u0000${acceptedEnvelope.idempotencyKey}`;
      const fingerprint = canonicalJson(acceptedEnvelope);
      const existing = accepted.get(key);
      if (existing) {
        if (existing.fingerprint !== fingerprint) {
          throw new Error('idempotency key was reused with a different TaskEnvelope');
        }
        return { result: existing.result, replayed: true, eventCount };
      }

      const result = create();
      accepted.set(key, { fingerprint, result });
      eventCount += 1;
      return { result, replayed: false, eventCount };
    },
    get eventCount() {
      return eventCount;
    },
  };
}

interface RunState {
  tenantId: string;
  lastSeq: number;
  artifactCount: number;
  pendingApprovalRequestId?: string;
  approvalDenied: boolean;
  terminal: boolean;
}

export function createRunEventSequenceGuard() {
  const states = new Map<string, RunState>();

  return {
    accept(event: RunEvent) {
      const validated = validateFleetContract('RunEvent', event);
      if (validated.issues) throw new Error(`invalid RunEvent: ${validated.issues[0]?.message}`);
      const acceptedEvent = validated.value;
      const stateKey = `${acceptedEvent.tenantId}\u0000${acceptedEvent.workOrderId}`;
      const state = states.get(stateKey) ?? {
        tenantId: acceptedEvent.tenantId,
        lastSeq: 0,
        artifactCount: 0,
        approvalDenied: false,
        terminal: false,
      };

      if (state.terminal) throw new Error('terminal run cannot accept another event');
      if (acceptedEvent.seq !== state.lastSeq + 1) throw new Error('run event sequence must be gapless');
      if (state.pendingApprovalRequestId) throw new Error('run is paused pending an ApprovalDecision');
      if (state.approvalDenied && acceptedEvent.type !== 'failed' && acceptedEvent.type !== 'cancelled') {
        throw new Error('denied run may only fail or cancel');
      }
      if (acceptedEvent.type === 'completed' && state.artifactCount === 0) {
        throw new Error('completed run requires at least one artifact');
      }

      state.lastSeq = acceptedEvent.seq;
      if (acceptedEvent.type === 'artifact') state.artifactCount += 1;
      if (acceptedEvent.type === 'needs_approval') {
        state.pendingApprovalRequestId = acceptedEvent.payload.requestId;
      }
      if (acceptedEvent.type === 'completed' || acceptedEvent.type === 'failed' || acceptedEvent.type === 'cancelled') {
        state.terminal = true;
      }
      states.set(stateKey, state);
    },
    resolve(decision: ApprovalDecision) {
      const validated = validateFleetContract('ApprovalDecision', decision);
      if (validated.issues) throw new Error(`invalid ApprovalDecision: ${validated.issues[0]?.message}`);
      const acceptedDecision = validated.value;
      const matching = [...states.entries()].find(
        ([, state]) =>
          state.tenantId === acceptedDecision.tenantId &&
          state.pendingApprovalRequestId === acceptedDecision.requestId,
      );
      if (!matching) throw new Error('ApprovalDecision does not match a paused run');
      const [, state] = matching;
      state.pendingApprovalRequestId = undefined;
      state.approvalDenied = acceptedDecision.decision !== 'approved';
    },
  };
}
