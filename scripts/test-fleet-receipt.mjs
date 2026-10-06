import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..');
const verifierPath = join(scriptDirectory, 'verify-fleet-receipt.mjs');
const fixtureDirectory = join(repositoryRoot, 'spikes', 'p0-fleet-receipt');
const writeFixtures = process.argv.includes('--write-fixtures');
const refreshFixtures = process.argv.includes('--refresh-fixtures');

if (writeFixtures || refreshFixtures) {
  if (existsSync(fixtureDirectory)) {
    if (writeFixtures) {
      console.error(JSON.stringify({ written: false, path: fixtureDirectory, reason: 'fixture directory already exists' }));
      process.exit(1);
    }
  }
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'hummer-fleet-fixture-'));
  const fixture = createScenario(join(temporaryDirectory, 'fixture'));
  mkdirSync(fixtureDirectory, { recursive: true });
  for (const name of ['artifacts', 'children']) {
    cpSync(join(fixture.root, name), join(fixtureDirectory, name), { recursive: true });
  }
  cpSync(fixture.parentPath, join(fixtureDirectory, 'fleet-receipt.json'));
  console.log(JSON.stringify({ written: true, path: fixtureDirectory }));
  process.exit(0);
}

const tests = [
  {
    name: 'valid parent and two independently verifiable child receipts',
    mutate() {},
    expectedStatus: 0,
    expected: { valid: true, checkedChildren: 2, checkedArtifacts: 2 },
  },
  {
    name: 'one-byte child receipt tamper is rejected',
    mutate(fixture) { mutateOneByte(fixture.childPaths[0]); },
    expectedStatus: 1,
    field: '/fleet/childReceipts/0/receiptSha256',
  },
  {
    name: 'wrong parent child receipt hash is rejected',
    mutate(fixture) {
      mutateParent(fixture.parentPath, (parent) => {
        parent.fleet.childReceipts[0].receiptSha256 = '0'.repeat(64);
      });
    },
    expectedStatus: 1,
    field: '/fleet/childReceipts/0/receiptSha256',
  },
  {
    name: 'parent aggregate manifest detects a changed child reference',
    mutate(fixture) {
      const parent = JSON.parse(readFileSync(fixture.parentPath, 'utf8'));
      parent.fleet.childReceipts[0].receiptSha256 = '1'.repeat(64);
      writeJson(fixture.parentPath, parent);
    },
    expectedStatus: 1,
    field: '/fleet/manifest/fieldHashes/childReceipts/0/receiptSha256',
  },
  {
    name: 'missing child receipt is rejected',
    mutate(fixture) { rmSync(fixture.childPaths[0]); },
    expectedStatus: 1,
    field: '/fleet/childReceipts/0/receiptPath',
  },
  {
    name: 'duplicate child work order is rejected',
    mutate(fixture) {
      mutateParent(fixture.parentPath, (parent) => {
        parent.fleet.childReceipts.push(structuredClone(parent.fleet.childReceipts[0]));
      });
    },
    expectedStatus: 1,
    field: '/fleet/childReceipts/2/workOrderId',
  },
  {
    name: 'path traversal is rejected before file access',
    mutate(fixture) {
      mutateParent(fixture.parentPath, (parent) => {
        parent.fleet.childReceipts[0].receiptPath = '../outside.json';
      });
    },
    expectedStatus: 1,
    field: '/fleet/childReceipts/0/receiptPath',
  },
  {
    name: 'unknown fleet child field is rejected',
    mutate(fixture) {
      mutateParent(fixture.parentPath, (parent) => {
        parent.fleet.childReceipts[0].autoApproved = true;
      });
    },
    expectedStatus: 1,
    field: '/fleet/childReceipts/0/autoApproved',
  },
  {
    name: 'artifact byte tamper is rejected',
    mutate(fixture) { mutateOneByte(fixture.artifactPaths[0]); },
    expectedStatus: 1,
    field: '/fleet/childReceipts/0/artifactRefs/0/sha256',
  },
  {
    name: 'child without artifact provenance is rejected',
    mutate(fixture) {
      mutateParent(fixture.parentPath, (parent) => {
        parent.fleet.childReceipts[0].artifactRefs = [];
      });
    },
    expectedStatus: 1,
    field: '/fleet/childReceipts/0/artifactRefs',
  },
  {
    name: 'child root hash mismatch is rejected',
    mutate(fixture) {
      mutateParent(fixture.parentPath, (parent) => {
        parent.fleet.childReceipts[0].receiptRootHash = 'f'.repeat(64);
      });
    },
    expectedStatus: 1,
    field: '/fleet/childReceipts/0/receiptRootHash',
  },
  {
    name: 'independently invalid child is rejected even when its file hash is refreshed',
    mutate(fixture) {
      const child = JSON.parse(readFileSync(fixture.childPaths[0], 'utf8'));
      child.receipt.outcome.verdict = 'rejected';
      writeJson(fixture.childPaths[0], child);
      mutateParent(fixture.parentPath, (parent) => {
        parent.fleet.childReceipts[0].receiptSha256 = sha256(readFileSync(fixture.childPaths[0]));
      });
    },
    expectedStatus: 1,
    field: '/fleet/childReceipts/0/receipt',
  },
  {
    name: 'unknown top-level envelope field is rejected',
    mutate(fixture) {
      const parent = JSON.parse(readFileSync(fixture.parentPath, 'utf8'));
      parent.debug = true;
      writeJson(fixture.parentPath, parent);
    },
    expectedStatus: 1,
    field: '/debug',
  },
];

const results = [];
let failed = false;
for (const test of tests) {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'hummer-fleet-test-'));
  const fixture = createScenario(join(temporaryDirectory, 'fixture'));
  test.mutate(fixture);
  const verification = spawnSync(process.execPath, [verifierPath, fixture.parentPath], { encoding: 'utf8' });
  let output;
  try {
    output = JSON.parse(verification.stdout.trim());
    assert.equal(verification.status, test.expectedStatus);
    if (test.expected) assert.deepEqual({ ...test.expected }, pick(output, Object.keys(test.expected)));
    if (test.field) assert.equal(output.field, test.field);
    results.push({ name: test.name, passed: true, exitCode: verification.status, output });
  } catch (error) {
    failed = true;
    results.push({
      name: test.name,
      passed: false,
      exitCode: verification.status,
      stdout: verification.stdout,
      stderr: verification.stderr,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

console.log(JSON.stringify({
  passed: failed === false,
  total: results.length,
  negative: results.filter((result) => result.exitCode === 1).length,
  results,
}, null, 2));
process.exit(failed ? 1 : 0);

function createScenario(root) {
  const childDirectory = join(root, 'children');
  const artifactDirectory = join(root, 'artifacts');
  mkdirSync(childDirectory, { recursive: true });
  mkdirSync(artifactDirectory, { recursive: true });

  const childPaths = [join(childDirectory, 'child-a.json'), join(childDirectory, 'child-b.json')];
  const artifactPaths = [join(artifactDirectory, 'report.txt'), join(artifactDirectory, 'summary.json')];
  writeFileSync(artifactPaths[0], 'Synthetic fleet report from node-a.\n', 'utf8');
  writeFileSync(artifactPaths[1], '{"status":"synthetic","node":"node-b"}\n', 'utf8');
  writeJson(childPaths[0], createV1Receipt('wo_child_a', 'tenant_fixture', 'employee:agent-a'));
  writeJson(childPaths[1], createV1Receipt('wo_child_b', 'tenant_fixture', 'employee:agent-b'));

  const childReceipts = [
    childReference({
      workOrderId: 'wo_child_a',
      receiptPath: 'children/child-a.json',
      receiptFile: childPaths[0],
      nodeId: 'node-a',
      agentId: 'agent-a',
      runtime: 'codex',
      agentVersion: 'fixture-1.0.0',
      completedAt: '2026-10-07T01:01:00.000Z',
      artifactId: 'artifact-report',
      artifactPath: 'artifacts/report.txt',
      artifactFile: artifactPaths[0],
    }),
    childReference({
      workOrderId: 'wo_child_b',
      receiptPath: 'children/child-b.json',
      receiptFile: childPaths[1],
      nodeId: 'node-b',
      agentId: 'agent-b',
      runtime: 'claude',
      agentVersion: 'fixture-1.0.0',
      completedAt: '2026-10-07T01:02:00.000Z',
      artifactId: 'artifact-summary',
      artifactPath: 'artifacts/summary.json',
      artifactFile: artifactPaths[1],
    }),
  ];
  const fleetContent = {
    parentWorkOrderId: 'wo_parent',
    nodes: [
      { nodeId: 'node-a', runtime: 'codex', agentVersion: 'fixture-1.0.0', artifactIds: ['artifact-report'] },
      { nodeId: 'node-b', runtime: 'claude', agentVersion: 'fixture-1.0.0', artifactIds: ['artifact-summary'] },
    ],
    childReceipts,
    chainHead: {
      tenantId: 'tenant_fixture',
      nodeId: 'node-a',
      position: 42,
      hash: 'a'.repeat(64),
      at: '2026-10-07T01:03:00.000Z',
    },
  };
  const parent = createV1Receipt('wo_parent', 'tenant_fixture', 'human:owner');
  parent.fleet = { ...fleetContent, manifest: createManifest(fleetContent) };
  const parentPath = join(root, 'fleet-receipt.json');
  writeJson(parentPath, parent);
  return { root, parentPath, childPaths, artifactPaths };
}

function childReference(input) {
  const receipt = JSON.parse(readFileSync(input.receiptFile, 'utf8'));
  return {
    workOrderId: input.workOrderId,
    receiptPath: input.receiptPath,
    receiptSha256: sha256(readFileSync(input.receiptFile)),
    receiptRootHash: receipt.manifest.rootHash,
    nodeId: input.nodeId,
    agentId: input.agentId,
    runtime: input.runtime,
    agentVersion: input.agentVersion,
    completedAt: input.completedAt,
    artifactRefs: [{
      artifactId: input.artifactId,
      path: input.artifactPath,
      sha256: sha256(readFileSync(input.artifactFile)),
    }],
  };
}

function createV1Receipt(workOrderId, tenantId, actorRef) {
  const eventWithoutHash = {
    position: 1,
    id: `evt_${workOrderId}`,
    tenantId,
    aggregateType: 'work_order',
    aggregateId: workOrderId,
    aggregateVersion: 1,
    type: 'outcome.accepted',
    occurredAt: '2026-10-07T01:00:00.000Z',
    actorRef,
    correlationId: `corr_${workOrderId}`,
    payload: { verdict: 'accepted' },
    canonicalPayload: '{"verdict":"accepted"}',
    previousHash: null,
  };
  const eventMaterial = {
    actorRef: eventWithoutHash.actorRef,
    aggregateId: eventWithoutHash.aggregateId,
    aggregateType: eventWithoutHash.aggregateType,
    aggregateVersion: eventWithoutHash.aggregateVersion,
    correlationId: eventWithoutHash.correlationId,
    id: eventWithoutHash.id,
    occurredAt: eventWithoutHash.occurredAt,
    payload: eventWithoutHash.payload,
    previousHash: eventWithoutHash.previousHash,
    tenantId: eventWithoutHash.tenantId,
    type: eventWithoutHash.type,
  };
  const receipt = {
    generatedAt: '2026-10-07T01:00:00.000Z',
    tenantId,
    outcome: {
      id: `outcome_${workOrderId}`,
      tenantId,
      outcomeDefinitionId: 'definition_fleet_fixture',
      workOrderId,
      sessionId: `session_${workOrderId}`,
      approvalId: null,
      verdict: 'accepted',
      acceptedBy: actorRef,
      evidenceRef: `evidence://sha256/${'b'.repeat(64)}`,
      occurredAt: '2026-10-07T01:00:00.000Z',
    },
    definition: {
      id: 'definition_fleet_fixture',
      tenantId,
      actionPattern: 'fleet.fixture',
      title: 'Synthetic fleet fixture',
      acceptanceCriteria: 'Receipt verifies independently',
      unitPriceCny: null,
      riskLevel: 'low',
      enabled: true,
      createdAt: '2026-10-07T01:00:00.000Z',
      updatedAt: '2026-10-07T01:00:00.000Z',
    },
    costs: [],
    tools: [],
    totalCostCny: 0,
    approval: null,
    chainIntegrity: { valid: true, checked: 1 },
  };
  const domainEvents = [{ ...eventWithoutHash, hash: sha256(canonical(eventMaterial)) }];
  const content = { receipt, domainEvents };
  return {
    schema: 'hummer.outcome-receipt',
    version: 1,
    receipt,
    domainEvents,
    manifest: createManifest(content),
  };
}

function createManifest(value) {
  return {
    algorithm: 'SHA-256',
    rootHash: sha256(canonical(value)),
    fieldHashes: hashLeaves(value),
  };
}

function mutateParent(path, mutation) {
  const parent = JSON.parse(readFileSync(path, 'utf8'));
  mutation(parent);
  const fleetContent = {
    parentWorkOrderId: parent.fleet.parentWorkOrderId,
    nodes: parent.fleet.nodes,
    childReceipts: parent.fleet.childReceipts,
    chainHead: parent.fleet.chainHead,
  };
  parent.fleet.manifest = createManifest(fleetContent);
  writeJson(path, parent);
}

function mutateOneByte(path) {
  const bytes = readFileSync(path);
  assert.ok(bytes.length > 0);
  bytes[bytes.length - 1] = bytes[bytes.length - 1] === 0x0a ? 0x20 : bytes[bytes.length - 1] ^ 0x01;
  writeFileSync(path, bytes);
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
    entries.forEach(([key, item]) => visit(item, `${path}/${escapePointer(key)}`, output));
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
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  throw new TypeError('unsupported receipt value');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function escapePointer(value) {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function pick(value, keys) {
  return Object.fromEntries(keys.map((key) => [key, value[key]]));
}
