import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  ApprovalDecisionStandardSchema,
  FleetContractSchemas,
  FLEET_CONTRACT_MAX_BYTES,
  NodeManifestStandardSchema,
  createRunEventSequenceGuard,
  createTaskEnvelopeIdempotencyGuard,
  decodeFleetContract,
  validateFleetContract,
} from '../packages/contracts/src/fleet/index.ts';

const now = '2026-10-07T00:00:00Z';
const later = '2026-10-07T01:00:00Z';

const nodeManifest = {
  schema: 'hummer.node-manifest', version: 1, nodeId: 'node-main-win', tenantIds: ['tenant_acme'],
  platform: 'win32', agentVersion: '0.1.0',
  runtimes: [
    { kind: 'codex', available: true, pinnedVersion: '0.153.4' },
    { kind: 'claude', available: false, pinnedVersion: '2.1.209', probeError: 'not configured' },
  ],
  capabilities: ['doc.extract', 'workspace.exec'],
  mcp: { endpoint: 'stdio://hummer_local', tools: ['doc_extract', 'workspace_exec'] },
  load: { running: 0, queued: 1, cpuPct: 12.5 },
};

const taskEnvelope = {
  schema: 'hummer.task-envelope', version: 1,
  workOrderTask: {
    schema: 'hummer.work-order-task', version: 1, title: 'Summarize the intake',
    target: 'Read the supplied document and identify decisions.',
    expectedDeliverable: 'A Markdown decision summary.',
    attachmentNames: ['input/order.docx'],
    origin: { system: 'agent-hub', device: 'peter-main', taskId: 'task-42' },
  },
  tenantId: 'tenant_acme', targetNodeId: 'node-main-win', targetRuntime: 'codex',
  idempotencyKey: 'idem-0001', leaseMs: 30_000, approvalPolicyRef: 'policy-default-deny',
  expiresAt: later, originRef: 'work-order-parent',
};

function runEvent(seq, type, payload) {
  const defaultPayload = {
    started: { runId: 'run-1' },
    progress: { message: 'working' },
    completed: {},
    failed: { code: 'runtime-error', message: 'runtime failed', retryable: false },
    cancelled: { reason: 'cancelled by operator' },
  }[type] ?? {};
  return {
    schema: 'hummer.run-event', version: 1, eventId: `evt-${seq}`, tenantId: 'tenant_acme',
    workOrderId: 'wo-1', nodeId: 'node-main-win', seq, occurredAt: now, type,
    actorRef: 'employee:researcher', payload: payload ?? defaultPayload, idempotencyKey: `event-000${seq}`,
  };
}

const approvalRequest = {
  schema: 'hummer.approval-request', version: 1, requestId: 'approval-request-1',
  tenantId: 'tenant_acme', workOrderId: 'wo-1', nodeId: 'node-main-win', runId: 'run-1',
  riskClass: 'write', action: 'workspace.write', target: 'outputs/summary.md',
  redactedPreview: 'Write a summary without customer data.',
  requestedScope: { capabilities: ['workspace.exec'], paths: ['outputs/summary.md'], maxUses: 1 },
  expiresAt: later, requestedBy: 'employee:researcher',
};

const approvalDecision = {
  schema: 'hummer.approval-decision', version: 1, decisionId: 'approval-decision-1',
  requestId: 'approval-request-1', tenantId: 'tenant_acme', decision: 'approved',
  deciderActorRef: 'human:owner', decidedAt: now,
  grantedScope: { capabilities: ['workspace.exec'], paths: ['outputs/summary.md'], expiresAt: later, maxUses: 1 },
};

const validSamples = {
  NodeManifest: nodeManifest,
  TaskEnvelope: taskEnvelope,
  RunEvent: runEvent(1, 'started'),
  ApprovalRequest: approvalRequest,
  ApprovalDecision: approvalDecision,
};

let assertions = 0;
let negativeCases = 0;
function ok(value, message) { assert.ok(value, message); assertions += 1; }
function equal(actual, expected, message) { assert.deepEqual(actual, expected, message); assertions += 1; }
function rejected(name, value, label, options) {
  const result = validateFleetContract(name, value, options);
  assert.ok(result.issues?.length, `${label} must be rejected`);
  assertions += 1;
  negativeCases += 1;
}

for (const [name, sample] of Object.entries(validSamples)) {
  const result = validateFleetContract(name, sample);
  ok(!result.issues, `${name} valid sample must pass`);
  rejected(name, { ...sample, unexpected: true }, `${name}: unknown top-level field`);
  rejected(name, { ...sample, version: 2 }, `${name}: unsupported version`);
}

const nestedUnknown = structuredClone(taskEnvelope);
nestedUnknown.workOrderTask.origin.autoConfirm = true;
rejected('TaskEnvelope', nestedUnknown, 'TaskEnvelope: nested unknown field');
const pathEscape = structuredClone(taskEnvelope);
pathEscape.workOrderTask.attachmentNames = ['../secret.txt'];
rejected('TaskEnvelope', pathEscape, 'TaskEnvelope: attachment path escape');
const absolutePath = structuredClone(taskEnvelope);
absolutePath.workOrderTask.attachmentNames = ['C:/secret.txt'];
rejected('TaskEnvelope', absolutePath, 'TaskEnvelope: absolute attachment path');
rejected('NodeManifest', { ...nodeManifest, agentVersion: 'latest' }, 'NodeManifest: non-semantic agent version');
rejected('NodeManifest', { ...nodeManifest, load: { ...nodeManifest.load, cpuPct: 100.1 } }, 'NodeManifest: cpu over limit');
rejected('ApprovalRequest', { ...approvalRequest, requestedBy: 'human:owner' }, 'ApprovalRequest: human requester');

const alerts = [];
rejected(
  'ApprovalDecision', { ...approvalDecision, deciderActorRef: 'system:auto-approver' },
  'ApprovalDecision: system actor decision', { onSecurityAlert: (alert) => alerts.push(alert) },
);
equal(alerts.map((alert) => alert.code), ['approval.system_decider'], 'system decision must alert');
rejected('ApprovalDecision', { ...approvalDecision, decision: 'denied' }, 'denied decision cannot smuggle grant');

rejected(
  'RunEvent',
  runEvent(1, 'artifact', { artifactId: 'artifact-1', sha256: 'not-a-sha', bytes: 10, relPath: 'outputs/a.md' }),
  'RunEvent: artifact digest',
);
rejected(
  'RunEvent',
  runEvent(1, 'artifact', { artifactId: 'artifact-1', sha256: 'a'.repeat(64), bytes: 10, relPath: '../outside.md' }),
  'RunEvent: artifact path escape',
);
rejected('RunEvent', runEvent(1, 'progress', { message: 'working', hiddenCommand: true }), 'RunEvent: payload unknown field');

const standardSuccess = NodeManifestStandardSchema['~standard'].validate(nodeManifest);
ok(!('issues' in standardSuccess), 'Standard Schema adapter accepts a valid manifest');
const standardFailure = ApprovalDecisionStandardSchema['~standard'].validate({ ...approvalDecision, deciderActorRef: 'system:auto' });
ok('issues' in standardFailure, 'Standard Schema adapter preserves fail-closed approval validation');

const encoded = new TextEncoder().encode(JSON.stringify(taskEnvelope));
equal(decodeFleetContract(encoded, 'TaskEnvelope').value?.name, 'TaskEnvelope', 'UTF-8 JSON decodes');
ok(!decodeFleetContract(new Uint8Array([0xef, 0xbb, 0xbf, ...encoded]), 'TaskEnvelope').issues, 'UTF-8 BOM is accepted');
const crlfBytes = new TextEncoder().encode(JSON.stringify(taskEnvelope, null, 2).replaceAll('\n', '\r\n'));
ok(!decodeFleetContract(crlfBytes, 'TaskEnvelope').issues, 'CRLF JSON is accepted');
ok(Boolean(decodeFleetContract(new Uint8Array([0xc3, 0x28]), 'TaskEnvelope').issues), 'invalid UTF-8 is rejected');
negativeCases += 1;
ok(Boolean(decodeFleetContract(new Uint8Array(FLEET_CONTRACT_MAX_BYTES + 1).fill(0x20)).issues), 'over 64 KiB is rejected');
negativeCases += 1;

const replayGuard = createTaskEnvelopeIdempotencyGuard();
const first = replayGuard.accept(taskEnvelope, () => ({ dispatchId: 'dispatch-1' }));
const second = replayGuard.accept(structuredClone(taskEnvelope), () => ({ dispatchId: 'dispatch-2' }));
equal(first.result, second.result, 'duplicate returns original result');
equal(second.eventCount, 1, 'duplicate adds no event');
assert.throws(() => replayGuard.accept({ ...taskEnvelope, targetNodeId: 'node-other' }, () => ({ dispatchId: 'x' })), /different TaskEnvelope/);
assertions += 1; negativeCases += 1;

const runGuard = createRunEventSequenceGuard();
runGuard.accept(runEvent(1, 'started'));
runGuard.accept(runEvent(2, 'needs_approval', { requestId: 'approval-request-1' }));
assert.throws(() => runGuard.accept(runEvent(3, 'progress')), /paused pending/);
assertions += 1; negativeCases += 1;
assert.throws(() => runGuard.resolve({ ...approvalDecision, tenantId: 'tenant_other' }), /does not match/);
assertions += 1; negativeCases += 1;
runGuard.resolve(approvalDecision);
runGuard.accept(runEvent(3, 'artifact', { artifactId: 'artifact-1', sha256: 'a'.repeat(64), bytes: 10, relPath: 'outputs/a.md' }));
runGuard.accept(runEvent(4, 'completed'));
assert.throws(() => createRunEventSequenceGuard().accept(runEvent(2, 'started')), /gapless/);
assertions += 1; negativeCases += 1;
const noArtifactGuard = createRunEventSequenceGuard();
noArtifactGuard.accept(runEvent(1, 'started'));
assert.throws(() => noArtifactGuard.accept(runEvent(2, 'completed')), /requires at least one artifact/);
assertions += 1; negativeCases += 1;

function schemaBranches(schema) { return Array.isArray(schema.anyOf) ? schema.anyOf : [schema]; }
function enumValues(schema) {
  if ('const' in schema) return [schema.const];
  if (Array.isArray(schema.enum)) return schema.enum;
  if (Array.isArray(schema.anyOf)) return schema.anyOf.flatMap(enumValues);
  return [];
}
function simpleType(schema) {
  if (schema.type === 'array') return `${simpleType(schema.items)}[]`;
  if ('const' in schema) {
    if (typeof schema.const === 'number') return Number.isInteger(schema.const) ? 'integer' : 'number';
    return typeof schema.const;
  }
  if (typeof schema.type === 'string') return schema.type;
  if (Array.isArray(schema.anyOf)) return [...new Set(schema.anyOf.map(simpleType))].sort().join('|');
  return 'unknown';
}
function nestedSchemas(fieldSchemas) {
  return fieldSchemas.flatMap((schema) => {
    if (schema.type === 'array') return schema.items ? [schema.items] : [];
    if (schema.type === 'object' || Array.isArray(schema.anyOf)) return schemaBranches(schema);
    return [];
  });
}
function schemaFieldRows(contract, schema, prefix = '') {
  const branches = schemaBranches(schema);
  const fields = [...new Set(branches.flatMap((branch) => Object.keys(branch.properties ?? {})))].sort();
  return fields.flatMap((field) => {
    const fieldSchemas = branches.map((branch) => branch.properties?.[field]).filter(Boolean);
    const path = `${prefix}${field}`;
    const row = {
      contract, field: path,
      type: [...new Set(fieldSchemas.map(simpleType))].sort().join('|'),
      required: branches.every((branch) => branch.required?.includes(field)) ? 'yes' : 'no',
      enum: [...new Set(fieldSchemas.flatMap(enumValues).map(String))].sort().join(',') || '-',
    };
    const children = nestedSchemas(fieldSchemas);
    if (children.length === 0) return [row];
    const childPrefix = fieldSchemas.some((value) => value.type === 'array') ? `${path}[].` : `${path}.`;
    return [row, ...schemaFieldRows(contract, { anyOf: children }, childPrefix)];
  });
}
function parseDocumentRows(markdown) {
  const rows = [];
  for (const line of markdown.split(/\r?\n/)) {
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length !== 5 || cells[0] === 'Contract' || cells[0] === '---') continue;
    rows.push({ contract: cells[0], field: cells[1], type: cells[2], required: cells[3], enum: cells[4] });
  }
  return rows;
}
const expectedRows = Object.entries(FleetContractSchemas)
  .flatMap(([contract, schema]) => schemaFieldRows(contract, schema))
  .sort((a, b) => `${a.contract}.${a.field}`.localeCompare(`${b.contract}.${b.field}`));
if (process.argv.includes('--print-doc')) {
  console.log('| Contract | Field | Type | Required | Enum |');
  console.log('|---|---|---|---|---|');
  for (const row of expectedRows) {
    console.log(`| ${row.contract} | ${row.field} | ${row.type} | ${row.required} | ${row.enum} |`);
  }
}
const contractDocPath = fileURLToPath(new URL('../docs/architecture/fleet-contract.md', import.meta.url));
const documentedRows = parseDocumentRows(await readFile(contractDocPath, 'utf8'))
  .sort((a, b) => `${a.contract}.${a.field}`.localeCompare(`${b.contract}.${b.field}`));
equal(documentedRows, expectedRows, 'field table matches TypeBox schemas exactly');
ok(negativeCases >= 8, `at least eight negative cases remain; got ${negativeCases}`);
console.log(JSON.stringify({ status: 'passed', assertions, negativeCases, maxBytes: FLEET_CONTRACT_MAX_BYTES }));
