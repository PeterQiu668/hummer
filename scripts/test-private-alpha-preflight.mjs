import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { PRIVATE_ALPHA_NODE_SCOPES, validatePrivateAlphaPreflight } from './private-alpha-preflight-contract.mjs';

const now = new Date('2026-10-07T08:00:00.000Z');
const digest = 'a'.repeat(64);
const valid = {
  schema: 'hummer.private-alpha-preflight',
  version: 1,
  approval: { approved: true, approvedByRef: 'owner:qiu', approvedAt: '2026-10-07T07:50:00.000Z', scope: 'private-alpha-a-fs-read-attest-v1' },
  controller: { deviceRef: 'controller-01', os: 'win32', osVersion: 'Windows-11-24H2', operatorRef: 'operator:controller' },
  node: { deviceRef: 'node-02', os: 'win32', osVersion: 'Windows-11-24H2', operatorRef: 'operator:node' },
  network: {
    mode: 'private_tls_gateway', relayUrl: 'https://hummer.internal.example/relay', allowedNodeAddress: '10.20.30.40',
    certificateSha256: digest, certificateNotBefore: '2026-10-07T07:00:00.000Z', certificateNotAfter: '2026-10-08T08:00:00.000Z',
  },
  badge: {
    badgeId: 'badge-alpha-01', tenantId: 'tenant-alpha', nodeId: 'node-02',
    scopes: ['node.register', 'node.heartbeat', 'task.claim', 'task.event', 'stream.connect', 'approval.request', 'approval.consume'],
    issuedAt: '2026-10-07T07:55:00.000Z', expiresAt: '2026-10-07T15:55:00.000Z', transferChannel: 'offline_manual',
  },
  installer: { path: 'C:\\HUMMER-Alpha\\HUMMER-Setup.exe', sha256: digest, unsignedApproved: true },
  canary: {
    workspaceRoot: 'C:\\HUMMER-Alpha\\workspace', path: 'C:\\HUMMER-Alpha\\workspace\\canary.txt', sha256: digest,
    bytes: 128, containsBusinessData: false, isReparsePoint: false, hardLinkCount: 1,
  },
  evidenceDirectory: 'C:\\HUMMER-Alpha\\evidence',
  safeguards: {
    publicExposure: false, productionData: false, shellExecutor: false, networkExecutor: false,
    writeExecutor: false, deleteExecutor: false, realPayment: false,
  },
};

assert.deepEqual(validatePrivateAlphaPreflight(valid, { now }), { ok: true, errors: [] });
const badgeSource = readFileSync(resolve(import.meta.dirname, '../apps/relay/src/badge-auth.ts'), 'utf8');
for (const scope of PRIVATE_ALPHA_NODE_SCOPES) assert.ok(badgeSource.includes(`'${scope}'`), `Relay must define ${scope}`);
const localStackSource = readFileSync(resolve(import.meta.dirname, 'hummer-local-stack.mjs'), 'utf8');
const exactNodeScopes = `scopes: [${PRIVATE_ALPHA_NODE_SCOPES.map((scope) => `'${scope}'`).join(', ')}]`;
assert.ok(localStackSource.includes(exactNodeScopes), 'preflight scope set must match the production local-stack Node badge');

const cases = [
  ['approval is absent', (value) => { value.approval.approved = false; }, '/approval/approved'],
  ['devices are identical', (value) => { value.node.deviceRef = value.controller.deviceRef; value.badge.nodeId = value.node.deviceRef; }, '/node/deviceRef'],
  ['relay is HTTP', (value) => { value.network.relayUrl = 'http://hummer.internal.example/relay'; }, '/network/relayUrl'],
  ['relay URL embeds credentials', (value) => { value.network.relayUrl = 'https://user:pass@hummer.internal.example/relay'; }, '/network/relayUrl'],
  ['badge lives over eight hours', (value) => { value.badge.expiresAt = '2026-10-07T16:00:01.000Z'; }, '/badge/expiresAt'],
  ['badge has an extra scope', (value) => { value.badge.scopes.push('task.enqueue'); }, '/badge/scopes'],
  ['badge misses a required scope', (value) => { value.badge.scopes.pop(); }, '/badge/scopes'],
  ['badge is bound to another node', (value) => { value.badge.nodeId = 'node-forged'; }, '/badge/nodeId'],
  ['badge uses chat transfer', (value) => { value.badge.transferChannel = 'chat'; }, '/badge/transferChannel'],
  ['raw token field appears', (value) => { value.badge.token = 'forbidden'; }, '/badge/token'],
  ['certificate is expired', (value) => { value.network.certificateNotAfter = '2026-10-07T07:59:59.000Z'; }, '/network/certificateNotAfter'],
  ['digest is malformed', (value) => { value.installer.sha256 = 'not-a-digest'; }, '/installer/sha256'],
  ['unsigned package lacks approval', (value) => { value.installer.unsignedApproved = false; }, '/installer/unsignedApproved'],
  ['canary exceeds one MiB', (value) => { value.canary.bytes = 1024 * 1024 + 1; }, '/canary/bytes'],
  ['canary escapes workspace', (value) => { value.canary.path = 'C:\\outside\\canary.txt'; }, '/canary/path'],
  ['canary is a reparse point', (value) => { value.canary.isReparsePoint = true; }, '/canary/isReparsePoint'],
  ['canary has multiple hard links', (value) => { value.canary.hardLinkCount = 2; }, '/canary/hardLinkCount'],
  ['business data is selected', (value) => { value.canary.containsBusinessData = true; }, '/canary/containsBusinessData'],
  ['public exposure is enabled', (value) => { value.safeguards.publicExposure = true; }, '/safeguards/publicExposure'],
  ['real payment is enabled', (value) => { value.safeguards.realPayment = true; }, '/safeguards/realPayment'],
  ['unknown root field appears', (value) => { value.autoExecute = true; }, '/autoExecute'],
];

for (const [name, mutate, expectedPath] of cases) {
  const value = structuredClone(valid);
  mutate(value);
  const result = validatePrivateAlphaPreflight(value, { now });
  assert.equal(result.ok, false, `${name} must fail`);
  assert.ok(result.errors.some((error) => error.path === expectedPath), `${name} must report ${expectedPath}`);
}

const scratch = mkdtempSync(resolve(tmpdir(), 'hummer-private-alpha-preflight-'));
try {
  const validPath = resolve(scratch, 'valid.json');
  writeFileSync(validPath, JSON.stringify(valid), 'utf8');
  const ready = spawnSync(process.execPath, [
    resolve(import.meta.dirname, 'validate-private-alpha-preflight.mjs'), validPath,
  ], { encoding: 'utf8' });
  assert.equal(ready.status, 0);
  assert.equal(JSON.parse(ready.stdout).status, 'ready');

  const blockedPath = resolve(scratch, 'blocked.json');
  writeFileSync(blockedPath, JSON.stringify({ ...valid, approval: { ...valid.approval, approved: false } }), 'utf8');
  const blocked = spawnSync(process.execPath, [
    resolve(import.meta.dirname, 'validate-private-alpha-preflight.mjs'), blockedPath,
  ], { encoding: 'utf8' });
  assert.equal(blocked.status, 2);
  assert.equal(JSON.parse(blocked.stdout).status, 'blocked');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

process.stdout.write(`${JSON.stringify({ status: 'passed', assertions: 13, negativeCases: cases.length })}\n`);
