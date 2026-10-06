import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  computeCapabilityPackageDigest,
  computeCapabilityInstallRequestDigest,
  type CapabilityPackageAuthorInput,
  type CapabilityInstallGateInput,
  type SkillTrialSystemRecordInput,
  type TeamReadOnlyShare,
} from '@hummer/contracts';
import {
  FleetService,
  MemoryFleetStore,
  SqliteFleetStore,
  buildCapabilityInvitation,
  createFleetRelayServer,
  createSharedFleetValidators,
  createStaticBadgeTokenAuthenticator,
  type BadgeScope,
  type CapabilityVersionCreateInput,
  type FleetStore,
  type RunEventClaims,
} from '../src/index.js';

const NOW = '2026-10-07T00:00:00.000Z';
const LATER = '2026-10-07T01:00:00.000Z';
const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const TENANT_C = 'tenant-c';
const NODE = 'node-trial';
const DIGEST = 'b'.repeat(64);
const openStores: FleetStore[] = [];
const openApps: FastifyInstance[] = [];

function author(version = 1, previousPackageDigest?: string): CapabilityPackageAuthorInput {
  return {
    schema: 'hummer.capability-package-author-input', version: 1,
    tenantId: TENANT_A, packageId: 'cap-research', packageVersion: version,
    ...(version > 1 ? { supersedesVersion: version - 1, previousPackageDigest } : {}),
    title: 'Research synthesis', goal: 'Produce an evidence-grounded synthesis.', preset: 'expert-work',
    capabilityTrack: {
      responsibilities: ['Research'], workflows: ['Collect then synthesize'], standards: ['Cite evidence'],
      heuristics: ['Prefer primary sources'], pitfalls: ['Do not invent evidence'], examples: ['A linked report'],
    },
    behaviorTrack: {
      expressionPreferences: ['Be concise'], interactionRules: ['State uncertainty'],
      corrections: [{ scene: 'No source', wrong: 'Claim certainty', correct: 'Flag uncertainty' }],
    },
    runtimeProfile: 'runtime-default', toolIds: ['web-read'], requiredCapabilities: ['network.read'],
    acceptanceCriteria: ['Every material claim has evidence.'],
    sourceBoundary: { apps: ['Browser'], windows: ['Research'], includePaths: ['workspace/research'], excludePaths: ['workspace/secrets'] },
    provenance: {
      demoSessionIds: ['demo-1'], expertActorRef: 'expert:alice', nodeId: NODE, device: 'laptop-a', runtime: 'codex',
      runtimeVersion: '1.0.0', agentVersion: '1.0.0', capturedAt: NOW,
    },
    evidenceRefs: ['event-artifact', 'event-completed'], failureNotes: ['Fail closed.'],
    declaredPermissions: [{ capability: 'network.read', access: 'read', paths: [] }],
    regressionSuiteRef: 'suite-1', receiptRef: 'event-completed', status: 'draft', deletionAudit: {},
  };
}

function versionInput(value: CapabilityPackageAuthorInput): CapabilityVersionCreateInput {
  return { author: value, sourceTaskId: 'task-source', artifactEventId: 'event-artifact', completedEventId: 'event-completed' };
}

function trial(packageDigest: string, index: number): SkillTrialSystemRecordInput {
  return {
    schema: 'hummer.skill-trial-system-record-input', version: 1, tenantId: TENANT_A,
    trialId: `trial-${index}`, packageId: 'cap-research', packageVersion: 1, packageDigest,
    recordedBy: 'system:skill-trial', mode: 'shadow', ok: true,
    startedAt: NOW, endedAt: NOW,
    environment: { nodeId: NODE, os: 'win32', runtime: 'codex', runtimeVersion: '1.0.0', appVersions: { browser: '1.2.3' } },
    receiptRef: `trial-receipt-${index}`,
  };
}

const exportDescriptor = {
  format: 'agent-skills' as const,
  installEntry: 'manifest.json' as const,
  fileDigests: {
    'SKILL.md': '1'.repeat(64), 'work.md': '2'.repeat(64), 'behavior.md': '3'.repeat(64),
    'work_skill.md': '4'.repeat(64), 'behavior_skill.md': '5'.repeat(64), 'manifest.json': '6'.repeat(64),
    'meta.json': '7'.repeat(64), 'receipt.json': '8'.repeat(64),
  },
  containsRawRecording: false as const, containsCredentials: false as const, containsUnredactedCustomerData: false as const,
};

async function bootstrap(store: FleetStore) {
  await store.registerNode(TENANT_A, {}, { nodeId: NODE, tenantIds: [TENANT_A], agentVersion: '1.0.0' }, [TENANT_A], undefined, NOW, 60_000);
  await store.registerNode(TENANT_B, {}, { nodeId: NODE, tenantIds: [TENANT_B], agentVersion: '1.0.0' }, [TENANT_B], undefined, NOW, 60_000);
  const claims = {
    taskId: 'task-source', workOrderId: 'work-source', tenantId: TENANT_A, targetNodeId: NODE, targetRuntime: 'codex',
    idempotencyKey: 'delivery-source', leaseMs: 30_000, expiresAt: LATER, originRef: 'source-demo',
  };
  await store.enqueueTask(TENANT_A, claims, claims, null, NOW);
  await store.claimTask(TENANT_A, NODE, NOW);
  const event = async (eventId: string, seq: number, type: RunEventClaims['type']) => {
    const eventClaims: RunEventClaims = {
      eventId, tenantId: TENANT_A, workOrderId: 'work-source', nodeId: NODE, seq, occurredAt: NOW, type,
      idempotencyKey: `key-${eventId}`,
    };
    await store.putEvent(TENANT_A, { ...eventClaims, payload: type === 'artifact' ? { artifactId: 'artifact-1' } : {} }, eventClaims, NOW);
  };
  await event('event-started', 1, 'started');
  await event('event-artifact', 2, 'artifact');
  await event('event-completed', 3, 'completed');
  const created = await store.createCapabilityVersion(TENANT_A, versionInput(author()), 'human:owner', NOW);
  for (let index = 1; index <= 5; index += 1) {
    await store.recordCapabilityTrial(TENANT_A, { trial: trial(created.packageDigest, index), regression: { passed: true, evidenceDigest: DIGEST } }, NODE, NOW);
  }
  return created;
}

function invitation(packageDigest: string, expiresAt = LATER, targetTenantId = TENANT_B) {
  return buildCapabilityInvitation({ invitationId: `grant-a-${targetTenantId}`, sourceTenantId: TENANT_A, targetTenantId,
    packageId: 'cap-research', packageVersion: 1, packageDigest, expiresAt });
}

function gateInput(share: TeamReadOnlyShare, gateId: string, evaluatedAt = NOW, failed = false): CapabilityInstallGateInput {
  const evidence = '9'.repeat(64);
  const input: CapabilityInstallGateInput = {
    schema: 'hummer.capability-install-gate-input', version: 1, gateId, share,
    recordedBy: 'system:capability-install-gate', requestDigest: '0'.repeat(64), shareDigest: share.shareDigest,
    exportDescriptor, targetTenantId: share.targetTenantId, requestedByActorRef: 'human:installer',
    staticCheck: { status: failed ? 'failed' : 'passed', evidenceDigest: evidence, findings: failed ? [{ code: 'unsafe_file', message: 'Unsafe file.' }] : [] },
    permissionReview: { approvedPermissions: share.package.declaredPermissions, deniedPermissions: [], evidenceDigest: evidence },
    sourceVerification: {
      provenance: { status: 'passed', evidenceDigest: evidence }, receipt: { status: 'passed', evidenceDigest: evidence },
      packageDigest: { status: 'passed', evidenceDigest: evidence },
      ...(share.invitation ? { invitation: { status: 'passed' as const, evidenceDigest: share.invitation.evidenceDigest } } : {}),
      regression: { status: 'passed', evidenceDigest: share.package.trialRecord.regressionEvidenceDigest },
    },
    evaluatedAt,
  };
  input.requestDigest = computeCapabilityInstallRequestDigest(input);
  return input;
}

afterEach(async () => {
  openStores.splice(0).forEach((store) => store.close());
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

for (const [name, factory] of [
  ['memory', () => new MemoryFleetStore()],
  ['sqlite', () => new SqliteFleetStore(':memory:')],
] as const) {
  describe(`[TEN-W5-CAPABILITY-REGISTRY] ${name}`, () => {
    it('requires completed task evidence, appends exact versions, and rejects digest gaps', async () => {
      const store = factory(); openStores.push(store);
      const first = await bootstrap(store);
      expect(first.packageDigest).toBe(computeCapabilityPackageDigest(author()));
      const secondAuthor = author(2, first.packageDigest);
      const second = await store.createCapabilityVersion(TENANT_A, versionInput(secondAuthor), 'human:owner', NOW);
      expect(second).toMatchObject({ packageVersion: 2, status: 'draft', tenantId: TENANT_A });
      await expect(store.createCapabilityVersion(TENANT_A, versionInput(author(3, '0'.repeat(64))), 'human:owner', NOW))
        .rejects.toMatchObject({ code: 'capability_conflict' });
      await expect(store.createCapabilityVersion(TENANT_B, versionInput(author()), 'human:owner', NOW))
        .rejects.toMatchObject({ code: 'tenant_mismatch' });
      const unknownEvidence = structuredClone(secondAuthor);
      unknownEvidence.packageVersion = 3;
      unknownEvidence.supersedesVersion = 2;
      unknownEvidence.previousPackageDigest = second.packageDigest;
      unknownEvidence.evidenceRefs.push('foreign-event');
      await expect(store.createCapabilityVersion(TENANT_A, versionInput(unknownEvidence), 'human:owner', NOW))
        .rejects.toMatchObject({ code: 'capability_not_found' });
      const unknownReceipt = structuredClone(unknownEvidence);
      unknownReceipt.evidenceRefs = ['event-artifact', 'event-completed'];
      unknownReceipt.receiptRef = 'foreign-receipt';
      await expect(store.createCapabilityVersion(TENANT_A, versionInput(unknownReceipt), 'human:owner', NOW))
        .rejects.toMatchObject({ code: 'capability_not_found' });
    });

    it('binds trusted unique trials, read-only team shares, tenant visibility, and install decisions', async () => {
      const store = factory(); openStores.push(store);
      const created = await bootstrap(store);
      await expect(store.recordCapabilityTrial(TENANT_A, {
        trial: trial(created.packageDigest, 1), regression: { passed: true, evidenceDigest: DIGEST },
      }, NODE, NOW)).rejects.toMatchObject({ code: 'capability_conflict' });
      const share = await store.createCapabilityShare(TENANT_A, {
        shareId: 'share-1', packageId: 'cap-research', packageVersion: 1, targetTenantId: TENANT_B,
      }, invitation(created.packageDigest), 'human:owner', NOW);
      expect(share).toMatchObject({ sourceTenantId: TENANT_A, targetTenantId: TENANT_B, access: 'read_only', allowEdit: false, allowCopyToTenant: false });
      const secondShare = await store.createCapabilityShare(TENANT_A, {
        shareId: 'share-2', packageId: 'cap-research', packageVersion: 1, targetTenantId: TENANT_C,
      }, invitation(created.packageDigest, LATER, TENANT_C), 'human:owner', NOW);
      expect(secondShare.targetTenantId).toBe(TENANT_C);
      expect(await store.getCapabilityShare(TENANT_C, 'share-1')).toBeNull();
      expect(await store.listCapabilities('tenant-unknown')).toEqual([]);
      expect(await store.getCapability(TENANT_B, 'cap-research', 1)).toMatchObject({ access: 'read_only' });
      expect(await store.getCapability('tenant-unknown', 'cap-research', 1)).toBeNull();
      const targetView = await store.getCapability(TENANT_B, 'cap-research', 1);
      expect(targetView?.record.trialRecord).toEqual(share.package.trialRecord);
      await expect(store.recordCapabilityTrial(TENANT_A, {
        trial: trial(created.packageDigest, 6), regression: { passed: true, evidenceDigest: DIGEST },
      }, NODE, NOW)).rejects.toMatchObject({ code: 'capability_conflict' });
      const decision = await store.recordCapabilityInstallDecision(TENANT_B, gateInput(share, 'gate-1'), 'system:capability-install-gate', NOW);
      expect(decision).toMatchObject({ decision: 'approved', targetTenantId: TENANT_B, packageDigest: created.packageDigest });
      const denied = await store.recordCapabilityInstallDecision(TENANT_B, gateInput(share, 'gate-denied', NOW, true), 'system:capability-install-gate', NOW);
      expect(denied).toMatchObject({ decision: 'denied' });
      const forged = gateInput(share, 'gate-forged');
      forged.share.packageDigest = '0'.repeat(64);
      await expect(store.recordCapabilityInstallDecision(TENANT_B, forged, 'system:capability-install-gate', NOW))
        .rejects.toMatchObject({ code: 'capability_trust_denied' });
      await expect(store.recordCapabilityInstallDecision('tenant-unknown', gateInput(share, 'gate-2'), 'system:capability-install-gate', NOW))
        .rejects.toMatchObject({ code: 'capability_not_found' });
    });

    it('rejects invitation expiry at install evaluation, not only at share time', async () => {
      const store = factory(); openStores.push(store);
      const created = await bootstrap(store);
      await store.createCapabilityShare(TENANT_A, {
        shareId: 'share-expiring', packageId: 'cap-research', packageVersion: 1, targetTenantId: TENANT_B,
      }, invitation(created.packageDigest, '2026-10-07T00:30:00.000Z'), 'human:owner', NOW);
      const shared = (await store.getCapabilityShare(TENANT_B, 'share-expiring'))!;
      const expiredInput = gateInput(shared, 'gate-expired', NOW);
      // Store time is authoritative; a stale caller evaluatedAt cannot bypass invitation expiry.
      await expect(store.recordCapabilityInstallDecision(TENANT_B, expiredInput, 'system:capability-install-gate', LATER))
        .rejects.toMatchObject({ code: 'capability_trust_denied' });
    });
  });
}

it('[TEN-W5-CAPABILITY-RESTART] restores SQLite packages, shares, and trials after restart', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'hummer-capability-registry-')), 'relay.sqlite3');
  const first = new SqliteFleetStore(path);
  const created = await bootstrap(first);
  await first.createCapabilityShare(TENANT_A, {
    shareId: 'share-restart', packageId: 'cap-research', packageVersion: 1, targetTenantId: TENANT_B,
  }, invitation(created.packageDigest), 'human:owner', NOW);
  first.close();
  const reopened = new SqliteFleetStore(path); openStores.push(reopened);
  expect(await reopened.getCapability(TENANT_B, 'cap-research', 1)).toMatchObject({ access: 'read_only' });
  const share = (await reopened.getCapabilityShare(TENANT_B, 'share-restart'))!;
  const decision = await reopened.recordCapabilityInstallDecision(TENANT_B, gateInput(share, 'gate-restart'), 'system:capability-install-gate', NOW);
  expect(decision.decision).toBe('approved');
});

it('[TEN-W5-CAPABILITY-HTTP] derives tenants from badges and reserves trial/install endpoints for trusted system identities', async () => {
  const store = new MemoryFleetStore(); openStores.push(store);
  const created = await bootstrap(store);
  const service = new FleetService(store, createSharedFleetValidators(), { now: () => new Date(NOW) });
  const badge = (token: string, tenantId: string, actorRef: string, scopes: readonly BadgeScope[], extra: Record<string, unknown> = {}) => ({
    token, tokenId: `id-${token}`, tenantId, actorRef, scopes, expiresAt: LATER, ...extra,
  });
  const authenticator = createStaticBadgeTokenAuthenticator([
    badge('owner', TENANT_A, 'human:owner', ['capability.read', 'capability.share'], {
      authorizedTenantIds: [TENANT_A, TENANT_B], grantRef: 'grant-a-b',
    }),
    badge('reader-b', TENANT_B, 'human:reader', ['capability.read']),
    badge('reader-c', TENANT_C, 'human:reader', ['capability.read']),
    badge('fake-trial', TENANT_A, 'human:owner', ['capability.trial.record'], { nodeId: NODE }),
    badge('fake-gate', TENANT_B, 'human:owner', ['capability.install.evaluate']),
    badge('gate', TENANT_B, 'system:capability-install-gate', ['capability.install.evaluate']),
  ]);
  const { app } = createFleetRelayServer(service, { authenticator, now: () => new Date(NOW) });
  openApps.push(app);
  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const sharedResponse = await app.inject({ method: 'POST', url: '/v1/capabilities/shares', headers: auth('owner'), payload: {
    shareId: 'share-http', packageId: 'cap-research', packageVersion: 1, targetTenantId: TENANT_B,
  } });
  expect(sharedResponse.statusCode).toBe(200);
  const shared = sharedResponse.json().share as TeamReadOnlyShare;
  const targetRead = await app.inject({ method: 'GET', url: '/v1/capabilities/cap-research?version=1', headers: auth('reader-b') });
  const foreignRead = await app.inject({ method: 'GET', url: '/v1/capabilities/cap-research?version=1', headers: auth('reader-c') });
  const unknownRead = await app.inject({ method: 'GET', url: '/v1/capabilities/missing?version=1', headers: auth('reader-c') });
  expect(targetRead.statusCode).toBe(200);
  expect(foreignRead.statusCode).toBe(404);
  expect(foreignRead.json()).toEqual(unknownRead.json());
  const fakeTrial = await app.inject({ method: 'POST', url: '/v1/capabilities/trials', headers: auth('fake-trial'), payload: {
    trial: trial(created.packageDigest, 9), regression: { passed: true, evidenceDigest: DIGEST },
  } });
  expect(fakeTrial.statusCode).toBe(403);
  const fakeGate = await app.inject({ method: 'POST', url: '/v1/capabilities/install-gate', headers: auth('fake-gate'), payload: gateInput(shared, 'gate-fake') });
  expect(fakeGate.statusCode).toBe(403);
  const gate = await app.inject({ method: 'POST', url: '/v1/capabilities/install-gate', headers: auth('gate'), payload: gateInput(shared, 'gate-http') });
  expect(gate.statusCode).toBe(200);
  expect(gate.json().decision).toMatchObject({ decision: 'approved', targetTenantId: TENANT_B });
});
