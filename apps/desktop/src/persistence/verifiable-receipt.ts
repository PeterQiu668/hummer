import { canonicalJson, sha256Hex, type JsonValue } from './canonical-json.js';
import type { StoredDomainEvent } from './domain-event-store.js';
import type { OutcomeReceipt } from './outcome-receipt.js';

export interface VerifiableOutcomeReceipt {
  schema: 'hummer.outcome-receipt';
  version: 1;
  receipt: JsonValue;
  domainEvents: DomainEventProofNode[];
  manifest: {
    algorithm: 'SHA-256';
    rootHash: string;
    fieldHashes: Record<string, string>;
  };
}

export type DomainEventProofNode = StoredDomainEvent | {
  opaque: true;
  position: number;
  previousHash: string | null;
  hash: string;
};

export function createVerifiableReceipt(
  receipt: OutcomeReceipt,
  allDomainEvents: StoredDomainEvent[],
): VerifiableOutcomeReceipt {
  const receiptBody = JSON.parse(receipt.receiptJson) as JsonValue;
  const domainEvents: DomainEventProofNode[] = allDomainEvents.map((event) => event.tenantId === receipt.tenantId
    ? event
    : { opaque: true, position: event.position, previousHash: event.previousHash, hash: event.hash });
  const content = { receipt: receiptBody, domainEvents } as unknown as JsonValue;
  return {
    schema: 'hummer.outcome-receipt',
    version: 1,
    receipt: receiptBody,
    domainEvents,
    manifest: {
      algorithm: 'SHA-256',
      rootHash: sha256Hex(canonicalJson(content)),
      fieldHashes: hashLeaves(content),
    },
  };
}

function hashLeaves(value: JsonValue): Record<string, string> {
  const result: Record<string, string> = {};
  visit(value, '', result);
  return result;
}

function visit(value: JsonValue, path: string, output: Record<string, string>): void {
  if (Array.isArray(value)) {
    if (!value.length) output[path || '/'] = sha256Hex(canonicalJson(value));
    value.forEach((item, index) => visit(item, `${path}/${index}`, output));
    return;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (!entries.length) output[path || '/'] = sha256Hex(canonicalJson(value));
    entries.forEach(([key, item]) => visit(item, `${path}/${escapePointer(key)}`, output));
    return;
  }
  output[path || '/'] = sha256Hex(canonicalJson(value));
}

function escapePointer(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}
