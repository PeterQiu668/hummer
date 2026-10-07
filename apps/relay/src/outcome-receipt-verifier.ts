import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical-json.js';
import { FleetRejectedError } from './ports.js';

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

/**
 * Independently verifies the portable HUMMER receipt. This intentionally does
 * not trust DesktopPersistence types or helper output: Relay recomputes the
 * envelope hashes and domain-event chain from the received JSON.
 */
export function verifySuccessfulOutcomeReceipt(input: unknown): VerifiedSuccessfulOutcomeReceipt {
  try {
    const envelope = record(input, 'receipt envelope');
    if (envelope.schema !== 'hummer.outcome-receipt' || envelope.version !== 1) fail('unsupported receipt schema');
    const manifest = record(envelope.manifest, 'receipt manifest');
    if (manifest.algorithm !== 'SHA-256' || !digest(manifest.rootHash)) fail('invalid receipt manifest');
    const domainEvents = array(envelope.domainEvents, 'domainEvents');
    if (domainEvents.length === 0) fail('domain event proof is empty');

    const content = { receipt: envelope.receipt, domainEvents: envelope.domainEvents };
    const actualLeaves = hashLeaves(content);
    const expectedLeaves = record(manifest.fieldHashes, 'receipt field hashes');
    const leafPaths = new Set([...Object.keys(expectedLeaves), ...Object.keys(actualLeaves)]);
    for (const path of leafPaths) {
      if (!digest(expectedLeaves[path]) || expectedLeaves[path] !== actualLeaves[path]) fail(`receipt field hash mismatch at ${path}`);
    }
    if (sha256(canonicalJson(content)) !== manifest.rootHash) fail('receipt root hash mismatch');

    const receipt = record(envelope.receipt, 'receipt body');
    const chainIntegrity = record(receipt.chainIntegrity, 'receipt chain integrity');
    if (chainIntegrity.valid !== true) fail('source hash chain was not valid at export');
    const tenantId = nonEmpty(receipt.tenantId, 'receipt tenant');
    const outcome = record(receipt.outcome, 'receipt outcome');
    const definition = record(receipt.definition, 'receipt definition');
    const outcomeId = nonEmpty(outcome.id, 'outcome id');
    const workOrderId = nonEmpty(outcome.workOrderId, 'outcome work order');
    const sessionId = nonEmpty(outcome.sessionId, 'outcome session');
    const evidenceRef = nonEmpty(outcome.evidenceRef, 'outcome evidence');
    const evidenceMatch = /^evidence:\/\/sha256\/([a-f0-9]{64})$/.exec(evidenceRef);
    if (!evidenceMatch) fail('outcome evidence reference is not a SHA-256 evidence URI');
    if (outcome.verdict !== 'accepted') fail('outcome was not accepted');
    if (outcome.tenantId !== tenantId || definition.tenantId !== tenantId
      || outcome.outcomeDefinitionId !== definition.id) fail('receipt tenant or definition scope mismatch');
    const occurredAt = nonEmpty(outcome.occurredAt, 'outcome occurrence time');
    if (!Number.isFinite(Date.parse(occurredAt))) fail('outcome occurrence time is invalid');

    for (const cost of array(receipt.costs, 'receipt costs')) {
      const scoped = record(cost, 'receipt cost');
      if (scoped.tenantId !== tenantId || scoped.sessionId !== sessionId
        || (scoped.outcomeEventId !== null && scoped.outcomeEventId !== outcomeId)) fail('receipt cost scope mismatch');
    }
    for (const tool of array(receipt.tools, 'receipt tools')) {
      const scoped = record(tool, 'receipt tool');
      if (scoped.tenantId !== tenantId || scoped.sessionId !== sessionId) fail('receipt tool scope mismatch');
    }
    if (receipt.approval !== null && receipt.approval !== undefined) {
      const approval = record(receipt.approval, 'receipt approval');
      if (approval.sessionId !== sessionId) fail('receipt approval scope mismatch');
    }

    let previousHash: string | null = null;
    let acceptedEventFound = false;
    for (const [index, value] of domainEvents.entries()) {
      const event = record(value, `domain event ${index}`);
      if (event.previousHash !== previousHash) fail(`domain event chain mismatch at ${index}`);
      if (!digest(event.hash)) fail(`domain event hash is invalid at ${index}`);
      if (event.opaque === true) {
        previousHash = event.hash as string;
        continue;
      }
      if (event.tenantId !== tenantId) fail(`disclosed domain event tenant mismatch at ${index}`);
      const canonicalPayload = nonEmpty(event.canonicalPayload, `domain event payload ${index}`);
      let payload: unknown;
      try { payload = JSON.parse(canonicalPayload); } catch { fail(`domain event payload is invalid at ${index}`); }
      if (canonicalJson(payload) !== canonicalPayload) fail(`domain event payload is not canonical at ${index}`);
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
      if (sha256(canonicalJson(material)) !== event.hash) fail(`domain event hash mismatch at ${index}`);
      if (event.aggregateType === 'outcome_event' && event.aggregateId === outcomeId && event.type === 'outcome.accepted') {
        const accepted = record(payload, 'accepted outcome event');
        if (accepted.verdict !== 'accepted' || accepted.workOrderId !== workOrderId
          || accepted.sessionId !== sessionId || accepted.evidenceRef !== evidenceRef
          || accepted.outcomeDefinitionId !== outcome.outcomeDefinitionId) fail('accepted outcome event scope mismatch');
        acceptedEventFound = true;
      }
      previousHash = event.hash as string;
    }
    if (!acceptedEventFound) fail('accepted outcome event was not found in the verified chain');

    return {
      rootHash: manifest.rootHash as string,
      tenantId,
      outcomeId,
      workOrderId,
      sessionId,
      evidenceRef,
      evidenceSha256: evidenceMatch[1]!,
      occurredAt,
    };
  } catch (error) {
    if (error instanceof FleetRejectedError) throw error;
    throw new FleetRejectedError('capability_trust_denied', 'outcome receipt verification failed');
  }
}

function hashLeaves(value: unknown): Record<string, string> {
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

function record(value: unknown, subject: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${subject} is invalid`);
  return value as Record<string, unknown>;
}

function array(value: unknown, subject: string): unknown[] {
  if (!Array.isArray(value)) fail(`${subject} is invalid`);
  return value;
}

function nonEmpty(value: unknown, subject: string): string {
  if (typeof value !== 'string' || value.length === 0) fail(`${subject} is invalid`);
  return value;
}

function digest(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function fail(_reason: string): never {
  // Keep trust failures intentionally uniform to avoid making cross-tenant
  // mismatch details observable to an authenticated but untrusted caller.
  throw new FleetRejectedError('capability_trust_denied', 'outcome receipt or capability source proof is invalid');
}
