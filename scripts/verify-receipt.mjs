import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) {
  console.log(JSON.stringify({ valid: false, field: '/', reason: 'receipt path is required' }));
  process.exit(1);
}

try {
  const envelope = JSON.parse(readFileSync(path, 'utf8'));
  const result = verify(envelope);
  console.log(JSON.stringify(result));
  process.exit(result.valid ? 0 : 1);
} catch (error) {
  console.log(JSON.stringify({ valid: false, field: '/', reason: error instanceof Error ? error.message : String(error) }));
  process.exit(1);
}

function verify(envelope) {
  if (envelope?.schema !== 'hummer.outcome-receipt' || envelope?.version !== 1) return failure('/schema', 'unsupported receipt schema');
  const content = { receipt: envelope.receipt, domainEvents: envelope.domainEvents };
  const actualLeaves = hashLeaves(content);
  const expectedLeaves = envelope.manifest?.fieldHashes ?? {};
  for (const path of [...new Set([...Object.keys(expectedLeaves), ...Object.keys(actualLeaves)])].sort()) {
    if (expectedLeaves[path] !== actualLeaves[path]) return failure(path, expectedLeaves[path] ? 'field hash mismatch' : 'unexpected field');
  }
  if (sha256(canonical(content)) !== envelope.manifest?.rootHash) return failure('/manifest/rootHash', 'receipt root hash mismatch');
  if (envelope.receipt?.chainIntegrity?.valid !== true) return failure('/receipt/chainIntegrity/valid', 'source hash chain was not valid at export');
  const chain = verifyDomainEvents(envelope.domainEvents);
  if (!chain.valid) return chain;
  return { valid: true, checkedFields: Object.keys(actualLeaves).length, checkedEvents: envelope.domainEvents.length, rootHash: envelope.manifest.rootHash };
}

function verifyDomainEvents(events) {
  if (!Array.isArray(events) || !events.length) return failure('/domainEvents', 'domain event proof is empty');
  let previousHash = null;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    const path = `/domainEvents/${index}`;
    if (event.opaque === true) {
      if (event.previousHash !== previousHash) return failure(`${path}/previousHash`, 'opaque hash-chain link mismatch');
      if (typeof event.hash !== 'string' || !/^[a-f0-9]{64}$/.test(event.hash)) return failure(`${path}/hash`, 'opaque hash anchor is invalid');
      previousHash = event.hash;
      continue;
    }
    let payload;
    try { payload = JSON.parse(event.canonicalPayload); } catch { return failure(`${path}/canonicalPayload`, 'canonical payload is invalid JSON'); }
    if (canonical(payload) !== event.canonicalPayload) return failure(`${path}/canonicalPayload`, 'payload is not canonical');
    if (event.previousHash !== previousHash) return failure(`${path}/previousHash`, 'hash chain link mismatch');
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
    if (sha256(canonical(material)) !== event.hash) return failure(`${path}/hash`, 'domain event hash mismatch');
    previousHash = event.hash;
  }
  return { valid: true };
}

function hashLeaves(value) {
  const result = {};
  visit(value, '', result);
  return result;
}

function visit(value, path, output) {
  if (Array.isArray(value)) {
    if (!value.length) output[path || '/'] = sha256(canonical(value));
    value.forEach((item, index) => visit(item, `${path}/${index}`, output));
  } else if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (!entries.length) output[path || '/'] = sha256(canonical(value));
    entries.forEach(([key, item]) => visit(item, `${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`, output));
  } else {
    output[path || '/'] = sha256(canonical(value));
  }
}

function canonical(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('non-finite number in receipt');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  throw new TypeError('unsupported receipt value');
}

function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function failure(field, reason) { return { valid: false, field, reason }; }
