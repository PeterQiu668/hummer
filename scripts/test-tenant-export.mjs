import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, test } from 'node:test';
import {
  canonicalJson,
  readJsonExport,
  sha256Hex,
  updateChainHeadProjection,
  verifyArtifactFiles,
  verifyAuditManifest,
  verifyChainHead,
  writeJsonProjection,
} from './lib/tenant-export-verifier.mjs';

const cli = resolve('scripts/verify-tenant-export.mjs');
const temporaryDirectories = [];

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

test('chain-head CLI validates an explicit JSON file and atomically advances a caller projection', () => {
  const directory = temporaryDirectory();
  const input = join(directory, 'head.json');
  const output = join(directory, 'projection.json');
  const head = chainHead();
  writeJson(input, head);

  const result = runCli([
    'chain-head', '--input', input, '--tenant', head.tenant_id, '--device', head.device_id,
    '--expected-position', String(head.position), '--expected-hash', head.hash, '--output', output,
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    ok: true,
    kind: 'chain-head',
    tenantId: head.tenant_id,
    deviceId: head.device_id,
    position: head.position,
    hash: head.hash,
    outputPath: resolve(output),
    projectionAction: 'created',
  });
  assert.deepEqual(JSON.parse(readFileSync(output, 'utf8')), head);

  const advanced = { ...head, position: 43, hash: sha256Hex('tenant-head-43'), at: '2026-10-07T08:00:00.000Z' };
  writeJson(input, advanced);
  const repeated = runCli([
    'chain-head', '--input', input, '--tenant', head.tenant_id, '--output', output,
    '--expected-current-hash', head.hash,
  ]);
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.equal(JSON.parse(repeated.stdout).projectionAction, 'updated');
  assert.deepEqual(JSON.parse(readFileSync(output, 'utf8')), advanced);
});

test('chain-head CLI accepts stdin but rejects tenant, hash, position, schema, and database-path confusion', () => {
  const directory = temporaryDirectory();
  const head = chainHead();
  const stdinResult = runCli(['chain-head', '--input', '-', '--tenant', head.tenant_id], canonicalJson(head));
  assert.equal(stdinResult.status, 0, stdinResult.stderr);

  const wrongTenant = runCli(['chain-head', '--input', '-', '--tenant', 'tenant_other'], canonicalJson(head));
  assert.equal(wrongTenant.status, 1);
  assert.match(wrongTenant.stderr, /tenant does not match/);

  assert.throws(() => verifyChainHead({ ...head, position: 0 }, { tenantId: head.tenant_id }), /positive safe integer/);
  assert.throws(() => verifyChainHead({ ...head, hash: head.hash.toUpperCase() }, { tenantId: head.tenant_id }), /lowercase/);
  assert.throws(() => verifyChainHead({ ...head, unexpected: true }, { tenantId: head.tenant_id }), /unknown fields/);
  assert.throws(() => verifyChainHead({ ...head, at: '2026-10-07T07:00:00+00:00' }, { tenantId: head.tenant_id }), /canonical UTC/);

  const databasePath = join(directory, 'hummer.sqlite3');
  writeJson(databasePath, head);
  const databaseInput = runCli(['chain-head', '--input', databasePath, '--tenant', head.tenant_id]);
  assert.equal(databaseInput.status, 1);
  assert.match(databaseInput.stderr, /explicit \.json/);
});

test('audit CLI independently verifies canonical manifest digest and every artifact byte', () => {
  const fixture = auditFixture();
  const output = join(fixture.directory, 'verified-manifest.json');
  const result = runCli([
    'audit-manifest',
    '--input', fixture.manifestPath,
    '--tenant', fixture.manifest.tenantId,
    '--expected-sha256', fixture.manifestSha256,
    '--artifacts-root', fixture.artifactsRoot,
    '--output', output,
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    ok: true,
    kind: 'audit-manifest',
    tenantId: fixture.manifest.tenantId,
    exportId: fixture.manifest.exportId,
    range: fixture.manifest.range,
    chainHead: fixture.manifest.chainHead,
    manifestSha256: fixture.manifestSha256,
    filesVerified: 2,
    outputPath: resolve(output),
  });
  assert.deepEqual(JSON.parse(readFileSync(output, 'utf8')), fixture.manifest);
});

test('audit verification rejects foreign tenants, digest drift, event gaps, head mismatch, traversal, and artifact tampering', () => {
  const fixture = auditFixture();
  assert.throws(() => verifyAuditManifest(fixture.manifest, {
    tenantId: 'tenant_other', sha256: fixture.manifestSha256,
  }), /tenant does not match/);
  assert.throws(() => verifyAuditManifest(fixture.manifest, {
    tenantId: fixture.manifest.tenantId, sha256: sha256Hex('wrong-manifest'),
  }), /does not match/);

  const gap = structuredClone(fixture.manifest);
  gap.eventRefs[1].position = 4;
  assert.throws(() => verifyAuditManifest(gap, {
    tenantId: gap.tenantId, sha256: sha256Hex(canonicalJson(gap)),
  }), /not contiguous/);

  const wrongHead = structuredClone(fixture.manifest);
  wrongHead.chainHead.hash = sha256Hex('foreign-head');
  assert.throws(() => verifyAuditManifest(wrongHead, {
    tenantId: wrongHead.tenantId, sha256: sha256Hex(canonicalJson(wrongHead)),
  }), /does not match the exported range/);

  const traversal = structuredClone(fixture.manifest);
  traversal.files[0].path = '../foreign/receipt.json';
  assert.throws(() => verifyAuditManifest(traversal, {
    tenantId: traversal.tenantId, sha256: sha256Hex(canonicalJson(traversal)),
  }), /normalized relative path/);

  const verified = verifyAuditManifest(fixture.manifest, {
    tenantId: fixture.manifest.tenantId, sha256: fixture.manifestSha256,
  });
  writeFileSync(join(fixture.artifactsRoot, 'results', 'summary.json'), '{"tampered":true}', 'utf8');
  assert.throws(() => verifyArtifactFiles(verified.manifest, fixture.artifactsRoot), /(size|hash) mismatch/);
});

test('JSON reader and projection writers refuse unknown formats, missing parents, and unsafe overwrite', () => {
  const directory = temporaryDirectory();
  const txt = join(directory, 'head.txt');
  writeJson(txt, chainHead());
  assert.throws(() => readJsonExport(txt), /explicit \.json/);
  assert.throws(() => writeJsonProjection(join(directory, 'missing', 'head.json'), chainHead()), /parent directory/);
  const output = join(directory, 'head.json');
  writeJsonProjection(output, chainHead());
  assert.throws(() => writeJsonProjection(output, chainHead()), /already exists/);
});

test('chain-head projection CAS rejects stale hash, rollback, fork, device or tenant switch, and malformed current state', () => {
  const directory = temporaryDirectory();
  const output = join(directory, 'device-blue-01.json');
  const current = chainHead();
  assert.equal(updateChainHeadProjection(output, current).action, 'created');
  assert.equal(updateChainHeadProjection(output, current, { expectedCurrentHash: current.hash }).action, 'unchanged');

  const advanced = { ...current, position: 43, hash: sha256Hex('tenant-head-43'), at: '2026-10-07T08:00:00.000Z' };
  assert.throws(() => updateChainHeadProjection(output, advanced, { expectedCurrentHash: sha256Hex('stale') }), /expected-current-hash/);
  assert.throws(() => updateChainHeadProjection(output, { ...current, position: 41, hash: sha256Hex('old') }), /lower/);
  assert.throws(() => updateChainHeadProjection(output, { ...current, hash: sha256Hex('fork') }), /conflicts/);
  assert.throws(() => updateChainHeadProjection(output, { ...advanced, device_id: 'device-red-01' }), /device does not match/);
  assert.throws(() => updateChainHeadProjection(output, { ...advanced, tenant_id: 'tenant_red_01' }), /tenant does not match/);

  assert.equal(updateChainHeadProjection(output, advanced, { expectedCurrentHash: current.hash }).action, 'updated');
  assert.deepEqual(JSON.parse(readFileSync(output, 'utf8')), advanced);

  writeJson(output, { ...advanced, unexpected: true });
  assert.throws(() => updateChainHeadProjection(output, { ...advanced, position: 44, hash: sha256Hex('next') }), /unknown fields/);
});

function auditFixture() {
  const directory = temporaryDirectory();
  const artifactsRoot = join(directory, 'artifacts');
  mkdirSync(join(artifactsRoot, 'receipts'), { recursive: true });
  mkdirSync(join(artifactsRoot, 'results'), { recursive: true });
  const receipt = Buffer.from('{"receipt":"verified-by-hash"}\n');
  const summary = Buffer.from('{"summary":"tenant-only"}\n');
  writeFileSync(join(artifactsRoot, 'receipts', 'outcome.json'), receipt);
  writeFileSync(join(artifactsRoot, 'results', 'summary.json'), summary);
  const eventOneHash = sha256Hex('tenant-event-1');
  const eventTwoHash = sha256Hex('tenant-event-2');
  const manifest = {
    schema: 'hummer.audit-export',
    version: 1,
    exportId: 'audit_export_device_01',
    tenantId: 'tenant_blue_01',
    range: { from: 1, to: 2 },
    chainHead: { position: 2, hash: eventTwoHash },
    eventRefs: [
      { eventId: 'evt_tenant_01', position: 1, hash: eventOneHash },
      { eventId: 'evt_tenant_02', position: 2, hash: eventTwoHash },
    ],
    files: [
      { path: 'receipts/outcome.json', sha256: sha256Hex(receipt), sizeBytes: receipt.byteLength },
      { path: 'results/summary.json', sha256: sha256Hex(summary), sizeBytes: summary.byteLength },
    ],
    createdAt: '2026-10-07T07:00:00.000Z',
  };
  const manifestSha256 = sha256Hex(canonicalJson(manifest));
  const manifestPath = join(directory, 'audit-manifest.json');
  writeJson(manifestPath, manifest);
  return { directory, artifactsRoot, manifest, manifestPath, manifestSha256 };
}

function chainHead() {
  return {
    device_id: 'device-blue-01',
    tenant_id: 'tenant_blue_01',
    position: 42,
    hash: sha256Hex('tenant-head-42'),
    at: '2026-10-07T07:00:00.000Z',
  };
}

function runCli(args, input) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', input });
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value)}\n`, 'utf8');
}

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'hummer-tenant-export-'));
  temporaryDirectories.push(directory);
  return directory;
}
