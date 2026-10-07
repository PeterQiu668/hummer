import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  computeCapabilityPackageDigest,
  computeTeamReadOnlyShareDigest,
  computeTrustedBundleEnvelopeDigest,
  computeTrustedBundleRootHash,
  validateTrustedBundleContract,
  type CapabilityPackageV1,
  type TeamReadOnlyShare,
  type TrustedBundleEnvelopeV1,
  type TrustedBundleHumanApprovalV1,
} from '@hummer/contracts';
import {
  AGENT_SKILLS_FILES,
  createCapabilityExport,
  createInstallGateInput,
  type CapabilityExportBundle,
} from '@hummer/capability-runtime';
import {
  createStaticBadgeTokenAuthenticator,
  createTrustedBundleRelayServer,
  type BadgeScope,
} from '../src/index.js';
import { RelayHttpClient } from '../../node-agent/src/relay-http-client.mjs';
import {
  initializeSyntheticTrustedBundleRoot,
  installTrustedBundleToSyntheticRoot,
} from '../../node-agent/src/trusted-bundle-installer.mjs';

const NOW = '2026-10-07T01:00:00Z';
const TENANT = 'tenant-b';
const NODE = 'node-target';
const temporaryRoots: string[] = [];

function sha256(value: string | Uint8Array): string { return createHash('sha256').update(value).digest('hex'); }
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') { const record = value as Record<string, unknown>; return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`; }
  return JSON.stringify(value);
}
function hashLeaves(value: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  const visit = (item: unknown, path: string): void => {
    if (Array.isArray(item)) { if (!item.length) result[path || '/'] = sha256(canonicalJson(item)); item.forEach((entry, index) => visit(entry, `${path}/${index}`)); }
    else if (item && typeof item === 'object') { const entries = Object.entries(item); if (!entries.length) result[path || '/'] = sha256(canonicalJson(item)); entries.forEach(([key, entry]) => visit(entry, `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`)); }
    else result[path || '/'] = sha256(canonicalJson(item));
  };
  visit(value, '');
  return result;
}

function packageFixture(): CapabilityPackageV1 {
  const seed: CapabilityPackageV1 = {
    schema: 'hummer.capability-package', version: 1, tenantId: 'tenant-a', packageId: 'cap-research', packageVersion: 1,
    title: 'Research synthesis', goal: 'Produce an evidence-grounded synthesis.', preset: 'expert-work',
    capabilityTrack: { responsibilities: ['Research'], workflows: ['Collect then synthesize'], standards: ['Cite evidence'], heuristics: ['Prefer primary sources'], pitfalls: ['Do not invent evidence'], examples: ['A linked report'] },
    behaviorTrack: { expressionPreferences: ['Be concise'], interactionRules: ['State uncertainty'], corrections: [{ scene: 'No source', wrong: 'Claim certainty', correct: 'Flag uncertainty' }] },
    runtimeProfile: 'runtime-default', toolIds: ['web-read'], requiredCapabilities: ['network.read'], acceptanceCriteria: ['Every material claim has evidence.'],
    sourceBoundary: { apps: ['Browser'], windows: ['Research'], includePaths: ['workspace/research'], excludePaths: ['workspace/secrets'] },
    provenance: { demoSessionIds: ['demo-1'], expertActorRef: 'expert:alice', nodeId: 'node-1', device: 'laptop-a', runtime: 'codex', runtimeVersion: '1.0.0', agentVersion: '1.0.0', capturedAt: NOW },
    evidenceRefs: ['evi-1'], trialRecord: { tenantId: 'tenant-a', packageId: 'cap-research', packageVersion: 1, packageDigest: '0'.repeat(64), trialIds: ['trial-1', 'trial-2', 'trial-3', 'trial-4', 'trial-5'], shadowRuns: 5, success: 5, failure: 0, lastRunAt: NOW, environments: [{ nodeId: 'node-1', os: 'win32', runtime: 'codex', runtimeVersion: '1.0.0', appVersions: { browser: '1.2.3' } }], regressionPassed: true, regressionEvidenceDigest: 'b'.repeat(64) },
    failureNotes: ['Fails closed.'], declaredPermissions: [{ capability: 'network.read', access: 'read', paths: ['workspace/research'] }], regressionSuiteRef: 'suite-1', receiptRef: 'receipt-1', packageDigest: '0'.repeat(64), status: 'shared', deletionAudit: {},
  };
  const packageDigest = computeCapabilityPackageDigest(seed);
  return { ...seed, packageDigest, trialRecord: { ...seed.trialRecord, packageDigest } };
}

function receiptFixture(pkg: CapabilityPackageV1) {
  const payload = { packageDigest: pkg.packageDigest, provenanceDigest: sha256(canonicalJson(pkg.provenance)), receiptRef: pkg.receiptRef, regressionPassed: true, regressionEvidenceDigest: pkg.trialRecord.regressionEvidenceDigest, successfulShadowTrialIds: [...pkg.trialRecord.trialIds].sort() };
  const eventMaterial = { actorRef: 'system:capability-export', aggregateId: pkg.packageId, aggregateType: 'capability_package', aggregateVersion: pkg.packageVersion, correlationId: `capability-export-${pkg.packageId}-v1`, id: 'event-cap-research-v1', occurredAt: NOW, payload, previousHash: null, tenantId: pkg.tenantId, type: 'capability.verified' };
  const domainEvents = [{ position: 1, ...eventMaterial, canonicalPayload: canonicalJson(payload), hash: sha256(canonicalJson(eventMaterial)) }];
  const receipt = { receiptRef: pkg.receiptRef, tenantId: pkg.tenantId, generatedAt: NOW, chainIntegrity: { valid: true as const, checked: 1 }, capability: { packageId: pkg.packageId, packageVersion: pkg.packageVersion, packageDigest: pkg.packageDigest, evidenceRefs: pkg.evidenceRefs, trialRecord: pkg.trialRecord, regressionSuiteRef: pkg.regressionSuiteRef } };
  const content = { receipt, domainEvents };
  return { schema: 'hummer.outcome-receipt', version: 1, receipt, domainEvents, manifest: { algorithm: 'SHA-256', rootHash: sha256(canonicalJson(content)), fieldHashes: hashLeaves(content) } };
}

function shareFixture(bundle: CapabilityExportBundle): TeamReadOnlyShare {
  const value: TeamReadOnlyShare = {
    schema: 'hummer.capability-team-share', version: 1, shareId: 'share-1', sourceTenantId: 'tenant-a', targetTenantId: TENANT,
    packageId: bundle.package.packageId, packageVersion: 1,
    invitation: { invitationId: 'invite-1', sourceTenantId: 'tenant-a', targetTenantId: TENANT, packageId: bundle.package.packageId, packageVersion: 1, packageDigest: bundle.packageDigest, status: 'accepted', expiresAt: '2026-10-08T01:00:00Z', evidenceDigest: 'c'.repeat(64) },
    access: 'read_only', allowEdit: false, allowCopyToTenant: false, packageDigest: bundle.packageDigest, shareDigest: '0'.repeat(64), package: bundle.package, sharedByActorRef: 'human:alice', sharedAt: NOW,
  };
  value.shareDigest = computeTeamReadOnlyShareDigest(value);
  return value;
}

function fixture() {
  const pkg = packageFixture();
  const bundle = createCapabilityExport(pkg, receiptFixture(pkg));
  const share = shareFixture(bundle);
  const evaluated = createInstallGateInput({ bundle, share, targetTenantId: TENANT, validInvitationEvidenceDigests: ['c'.repeat(64)], approvedPermissions: pkg.declaredPermissions, gateId: 'gate-1', requestedByActorRef: 'human:operator', evaluatedAt: NOW });
  if (evaluated.status !== 'approved' || !evaluated.decision || !evaluated.gateInput) throw new Error(`fixture gate denied: ${evaluated.reasons.join(',')}`);
  const descriptorFiles = AGENT_SKILLS_FILES.map((path) => ({ path, bytes: Buffer.byteLength(bundle.files[path], 'utf8'), sha256: bundle.fileDigests[path] }));
  const envelope: TrustedBundleEnvelopeV1 = {
    schema: 'hummer.trusted-capability-bundle', version: 1, bundleId: 'bundle-1', tenantId: TENANT, targetNodeId: NODE,
    shareId: share.shareId, gateId: evaluated.decision.gateId, requestDigest: evaluated.decision.requestDigest, shareDigest: share.shareDigest,
    packageId: pkg.packageId, packageVersion: pkg.packageVersion, packageDigest: pkg.packageDigest, bundleRootHash: bundle.rootHash, envelopeDigest: '0'.repeat(64),
    share, decision: evaluated.decision,
    descriptor: { format: 'agent-skills', fileCount: 8, totalBytes: descriptorFiles.reduce((sum, file) => sum + file.bytes, 0), files: descriptorFiles },
    files: AGENT_SKILLS_FILES.map((path) => ({ path, contentBase64: Buffer.from(bundle.files[path], 'utf8').toString('base64') })),
  };
  envelope.envelopeDigest = computeTrustedBundleEnvelopeDigest(envelope);
  const humanApproval: TrustedBundleHumanApprovalV1 = { schema: 'hummer.trusted-bundle-human-approval', version: 1, approvalId: 'approval-1', tenantId: TENANT, nodeId: NODE, bundleId: envelope.bundleId, gateId: envelope.gateId, bundleRootHash: envelope.bundleRootHash, actorRef: 'human:operator', decision: 'approved', decidedAt: NOW };
  return { bundle, envelope, gateInput: evaluated.gateInput, decision: evaluated.decision, humanApproval };
}

function badge(token: string, tenantId: string, nodeId: string | undefined, scopes: readonly BadgeScope[]) {
  return { token, tokenId: `badge-${token}`, tenantId, actorRef: nodeId ? `system:${nodeId}` : 'human:operator', ...(nodeId ? { nodeId } : {}), scopes, expiresAt: '2026-10-08T01:00:00Z' };
}

afterEach(async () => { for (const root of temporaryRoots.splice(0)) await rm(root, { recursive: true, force: true }); });

describe('[TRUSTED-BUNDLE-PROTOCOL] strict bytes and trust binding', () => {
  it('rejects unknown fields, duplicate paths, non-canonical base64, and digest tampering', () => {
    const { envelope } = fixture();
    expect(validateTrustedBundleContract('TrustedBundleEnvelopeV1', envelope)).toHaveProperty('value');
    expect(validateTrustedBundleContract('TrustedBundleEnvelopeV1', { ...envelope, surprise: true })).toHaveProperty('issues');
    const duplicate = structuredClone(envelope); duplicate.files[1]!.path = duplicate.files[0]!.path;
    expect(validateTrustedBundleContract('TrustedBundleEnvelopeV1', duplicate)).toHaveProperty('issues');
    const nonCanonical = structuredClone(envelope);
    const file = nonCanonical.files.find((entry) => entry.contentBase64.endsWith('==')) ?? nonCanonical.files.find((entry) => entry.contentBase64.endsWith('='));
    expect(file).toBeDefined();
    if (file) {
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
      const padding = file.contentBase64.endsWith('==') ? 2 : 1;
      const index = file.contentBase64.length - padding - 1;
      const original = alphabet.indexOf(file.contentBase64[index]!);
      const replacement = padding === 2 ? (original & 48) | 1 : (original & 60) | 1;
      file.contentBase64 = `${file.contentBase64.slice(0, index)}${alphabet[replacement]}${file.contentBase64.slice(index + 1)}`;
      expect(validateTrustedBundleContract('TrustedBundleEnvelopeV1', nonCanonical)).toHaveProperty('issues');
    }
    const digestTamper = structuredClone(envelope); digestTamper.descriptor.files[0]!.sha256 = '0'.repeat(64);
    expect(validateTrustedBundleContract('TrustedBundleEnvelopeV1', digestTamper)).toHaveProperty('issues');
  });

  it('runs authenticated Relay to Node installation with tenant isolation and idempotent delivery', async () => {
    const data = fixture();
    const authenticator = createStaticBadgeTokenAuthenticator([
      badge('publisher', TENANT, undefined, ['capability.bundle.publish']),
      badge('node', TENANT, NODE, ['capability.bundle.consume']),
      badge('other-node', TENANT, 'node-other', ['capability.bundle.consume']),
      badge('other-tenant', 'tenant-c', NODE, ['capability.bundle.consume']),
    ]);
    const { app } = createTrustedBundleRelayServer({ authenticator, now: () => new Date(NOW), approvedDecisionLookup: (tenantId, gateId) => tenantId === TENANT && gateId === data.envelope.gateId ? { decision: data.decision, gateInput: data.gateInput } : null });
    await app.listen({ host: '127.0.0.1', port: 0 });
    try {
      const address = app.server.address(); if (!address || typeof address === 'string') throw new Error('missing relay address');
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const publisher = new RelayHttpClient({ baseUrl, badgeToken: 'publisher' });
      const node = new RelayHttpClient({ baseUrl, badgeToken: 'node' });
      expect(await publisher.publishTrustedBundle(data.envelope)).toMatchObject({ inserted: true, bundleId: 'bundle-1' });
      expect(await publisher.publishTrustedBundle(data.envelope)).toMatchObject({ inserted: false, bundleId: 'bundle-1' });
      const conflicting = structuredClone(data.envelope); conflicting.targetNodeId = 'node-other'; conflicting.envelopeDigest = computeTrustedBundleEnvelopeDigest(conflicting);
      await expect(publisher.publishTrustedBundle(conflicting)).rejects.toMatchObject({ code: 'bundle_conflict' });
      const downloaded = await node.fetchTrustedBundle('bundle-1', { nodeId: NODE });
      const parent = await mkdtemp(join(tmpdir(), 'hummer-trusted-bridge-')); temporaryRoots.push(parent);
      const installRoot = await initializeSyntheticTrustedBundleRoot(join(parent, 'synthetic-root'));
      await expect(installTrustedBundleToSyntheticRoot({ bundle: downloaded, humanApproval: { ...data.humanApproval, nodeId: 'node-other' }, installRoot })).rejects.toMatchObject({ code: 'human_approval_mismatch' });
      expect(await readdir(installRoot)).toEqual(['.hummer-synthetic-install-root.json']);
      const installed = await installTrustedBundleToSyntheticRoot({ bundle: downloaded, humanApproval: data.humanApproval, installRoot });
      expect((await readdir(installed.targetDirectory)).sort()).toEqual([...AGENT_SKILLS_FILES].sort());
      expect(await readFile(join(installed.targetDirectory, 'manifest.json'), 'utf8')).toBe(data.bundle.files['manifest.json']);
      await expect(installTrustedBundleToSyntheticRoot({ bundle: downloaded, humanApproval: data.humanApproval, installRoot })).rejects.toMatchObject({ code: 'install_target_exists' });
      await expect(new RelayHttpClient({ baseUrl, badgeToken: 'other-node' }).fetchTrustedBundle('bundle-1', { nodeId: 'node-other' })).rejects.toMatchObject({ code: 'node_mismatch' });
      await expect(new RelayHttpClient({ baseUrl, badgeToken: 'other-tenant' }).fetchTrustedBundle('bundle-1', { nodeId: NODE })).rejects.toMatchObject({ code: 'bundle_not_found' });
    } finally { await app.close(); }
  });

  it('denies manifest/receipt changes at Relay and credentials before storage', async () => {
    const data = fixture();
    const authenticator = createStaticBadgeTokenAuthenticator([badge('publisher', TENANT, undefined, ['capability.bundle.publish'])]);
    const { app } = createTrustedBundleRelayServer({ authenticator, now: () => new Date(NOW), approvedDecisionLookup: () => ({ decision: data.decision, gateInput: data.gateInput }) });
    const mutate = (path: 'manifest.json' | 'receipt.json', text: string) => {
      const changed = structuredClone(data.envelope);
      const payload = changed.files.find((file) => file.path === path)!; payload.contentBase64 = Buffer.from(text, 'utf8').toString('base64');
      const descriptor = changed.descriptor.files.find((file) => file.path === path)!; descriptor.bytes = Buffer.byteLength(text); descriptor.sha256 = sha256(text);
      changed.descriptor.totalBytes = changed.descriptor.files.reduce((sum, file) => sum + file.bytes, 0);
      const digests = Object.fromEntries(changed.descriptor.files.map((file) => [file.path, file.sha256])) as Parameters<typeof computeTrustedBundleRootHash>[0];
      changed.bundleRootHash = computeTrustedBundleRootHash(digests); changed.envelopeDigest = computeTrustedBundleEnvelopeDigest(changed);
      return changed;
    };
    const manifest = JSON.parse(data.bundle.files['manifest.json']); manifest.entrypoint = 'behavior.md';
    const wrongReceipt = JSON.parse(data.bundle.files['receipt.json']); wrongReceipt.receipt.capability.packageId = 'cap-other';
    for (const changed of [mutate('manifest.json', `${JSON.stringify(manifest)}\n`), mutate('receipt.json', `${JSON.stringify(wrongReceipt)}\n`)]) {
      const response = await app.inject({ method: 'POST', url: '/v1/trusted-bundles', headers: { authorization: 'Bearer publisher' }, payload: changed });
      expect(response.statusCode).toBe(403); expect(response.json().error.code).toBe('descriptor_mismatch');
    }
    const credential = mutate('manifest.json', 'api_key=sk-abcdefghijklmnop\n');
    const blocked = await app.inject({ method: 'POST', url: '/v1/trusted-bundles', headers: { authorization: 'Bearer publisher' }, payload: credential });
    expect(blocked.statusCode).toBe(400); expect(blocked.json().error.code).toBe('invalid_bundle');
    await app.close();
  });

  it('leaves no target or staging directory on interrupted download or atomic rename failure', async () => {
    const data = fixture();
    const parent = await mkdtemp(join(tmpdir(), 'hummer-trusted-interrupt-')); temporaryRoots.push(parent);
    const installRoot = await initializeSyntheticTrustedBundleRoot(join(parent, 'synthetic-root'));
    const client = new RelayHttpClient({ baseUrl: 'http://127.0.0.1:9', badgeToken: 'node', fetch: async () => { throw new Error('connection reset'); } });
    await expect(client.fetchTrustedBundle('bundle-1', { nodeId: NODE })).rejects.toMatchObject({ code: 'relay_network_error' });
    expect(await readdir(installRoot)).toEqual(['.hummer-synthetic-install-root.json']);
    await expect(installTrustedBundleToSyntheticRoot(
      { bundle: data.envelope, humanApproval: data.humanApproval, installRoot },
      { atomicRename: async () => { throw new Error('simulated rename failure'); } },
    )).rejects.toThrow('simulated rename failure');
    expect(await readdir(installRoot)).toEqual(['.hummer-synthetic-install-root.json']);
  });
});
