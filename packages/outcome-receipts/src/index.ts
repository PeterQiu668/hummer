import { createHash } from 'node:crypto';

export interface VerifiedSuccessfulOutcomeReceipt {
  rootHash: string;
  tenantId: string;
  outcomeId: string;
  workOrderId: string;
  sessionId: string;
  evidenceRef: string;
  evidenceSha256: string;
  occurredAt: string;
}

export class OutcomeReceiptVerificationError extends Error {
  constructor() {
    super('outcome receipt verification failed');
    this.name = 'OutcomeReceiptVerificationError';
  }
}

export function verifySuccessfulOutcomeReceipt(input: unknown): VerifiedSuccessfulOutcomeReceipt {
  try {
    const envelope = exactRecord(input, ['schema', 'version', 'receipt', 'domainEvents', 'manifest']);
    if (envelope.schema !== 'hummer.outcome-receipt' || envelope.version !== 1) fail();
    const manifest = exactRecord(envelope.manifest, ['algorithm', 'rootHash', 'fieldHashes']);
    if (manifest.algorithm !== 'SHA-256' || !digest(manifest.rootHash)) fail();
    const domainEvents = array(envelope.domainEvents);
    if (domainEvents.length === 0) fail();

    const content = { receipt: envelope.receipt, domainEvents: envelope.domainEvents };
    const actualLeaves = hashLeaves(content);
    const expectedLeaves = record(manifest.fieldHashes);
    const leafPaths = new Set([...Object.keys(expectedLeaves), ...Object.keys(actualLeaves)]);
    for (const path of leafPaths) {
      if (!digest(expectedLeaves[path]) || expectedLeaves[path] !== actualLeaves[path]) fail();
    }
    if (sha256(canonicalJson(content)) !== manifest.rootHash) fail();

    const receipt = exactRecord(envelope.receipt, [
      'generatedAt', 'tenantId', 'outcome', 'definition', 'costs', 'tools',
      'totalCostCny', 'approval', 'chainIntegrity',
    ]);
    const chainIntegrity = record(receipt.chainIntegrity);
    if (chainIntegrity.valid !== true) fail();
    const tenantId = nonEmpty(receipt.tenantId);
    const outcome = record(receipt.outcome);
    const definition = record(receipt.definition);
    const outcomeId = nonEmpty(outcome.id);
    const workOrderId = nonEmpty(outcome.workOrderId);
    const sessionId = nonEmpty(outcome.sessionId);
    const evidenceRef = nonEmpty(outcome.evidenceRef);
    const evidenceMatch = /^evidence:\/\/sha256\/([a-f0-9]{64})$/.exec(evidenceRef);
    if (!evidenceMatch || outcome.verdict !== 'accepted') fail();
    if (outcome.tenantId !== tenantId || definition.tenantId !== tenantId
      || outcome.outcomeDefinitionId !== definition.id) fail();
    const occurredAt = nonEmpty(outcome.occurredAt);
    if (!Number.isFinite(Date.parse(occurredAt))) fail();

    for (const cost of array(receipt.costs)) {
      const scoped = record(cost);
      if (scoped.tenantId !== tenantId || scoped.sessionId !== sessionId
        || (scoped.outcomeEventId !== null && scoped.outcomeEventId !== outcomeId)) fail();
    }
    for (const tool of array(receipt.tools)) {
      const scoped = record(tool);
      if (scoped.tenantId !== tenantId || scoped.sessionId !== sessionId) fail();
    }
    if (receipt.approval !== null && receipt.approval !== undefined) {
      const approval = record(receipt.approval);
      if (approval.sessionId !== sessionId) fail();
    }

    let previousHash: string | null = null;
    let acceptedEventFound = false;
    for (const value of domainEvents) {
      const event = record(value);
      if (event.previousHash !== previousHash || !digest(event.hash)) fail();
      if (event.opaque === true) {
        previousHash = event.hash;
        continue;
      }
      if (event.tenantId !== tenantId) fail();
      const canonicalPayload = nonEmpty(event.canonicalPayload);
      let payload: unknown;
      try { payload = JSON.parse(canonicalPayload); } catch { fail(); }
      if (canonicalJson(payload) !== canonicalPayload) fail();
      const material = {
        actorRef: event.actorRef,
        aggregateId: event.aggregateId,
        aggregateType: event.aggregateType,
        aggregateVersion: event.aggregateVersion,
        correlationId: event.correlationId,
        id: event.id,
        occurredAt: event.occurredAt,
        payload,
        previousHash: event.previousHash,
        tenantId: event.tenantId,
        type: event.type,
      };
      if (sha256(canonicalJson(material)) !== event.hash) fail();
      if (event.aggregateType === 'outcome_event' && event.aggregateId === outcomeId && event.type === 'outcome.accepted') {
        const accepted = record(payload);
        if (accepted.verdict !== 'accepted' || accepted.workOrderId !== workOrderId
          || accepted.sessionId !== sessionId || accepted.evidenceRef !== evidenceRef
          || accepted.outcomeDefinitionId !== outcome.outcomeDefinitionId) fail();
        acceptedEventFound = true;
      }
      previousHash = event.hash;
    }
    if (!acceptedEventFound) fail();

    return {
      rootHash: manifest.rootHash,
      tenantId,
      outcomeId,
      workOrderId,
      sessionId,
      evidenceRef,
      evidenceSha256: evidenceMatch[1]!,
      occurredAt,
    };
  } catch (error) {
    if (error instanceof OutcomeReceiptVerificationError) throw error;
    throw new OutcomeReceiptVerificationError();
  }
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail();
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const input = value as Record<string, unknown>;
    return `{${Object.keys(input).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(input[key])}`).join(',')}}`;
  }
  fail();
}

export function hashLeaves(value: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  visit(value, '', result);
  return result;
}

function visit(value: unknown, path: string, output: Record<string, string>): void {
  if (Array.isArray(value)) {
    if (value.length === 0) output[path || '/'] = sha256(canonicalJson(value));
    value.forEach((item, index) => visit(item, `${path}/${index}`, output));
    return;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) output[path || '/'] = sha256(canonicalJson(value));
    entries.forEach(([key, item]) => visit(item, `${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`, output));
    return;
  }
  output[path || '/'] = sha256(canonicalJson(value));
}

function exactRecord(value: unknown, fields: readonly string[]): Record<string, unknown> {
  const output = record(value);
  if (Object.keys(output).some((key) => !fields.includes(key)) || fields.some((key) => !Object.hasOwn(output, key))) fail();
  return output;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  return value as Record<string, unknown>;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) fail();
  return value;
}

function nonEmpty(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) fail();
  return value;
}

function digest(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function fail(): never { throw new OutcomeReceiptVerificationError(); }
