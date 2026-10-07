import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CapabilityPackageAuthorInput } from '@hummer/contracts';
import { openPersistence, type VerifiableOutcomeReceipt } from '../../desktop/src/persistence/index.js';
import {
  FleetService,
  MemoryFleetStore,
  SqliteFleetStore,
  createSharedFleetValidators,
  type CapabilityVersionCreateInput,
  type FleetStore,
  type RunEventClaims,
} from '../src/index.js';

const NOW = '2026-10-07T02:00:00.000Z';
const LATER = '2026-10-07T03:00:00.000Z';
const TENANT = 'tenant-outcome';
const NODE = 'node-outcome';
const WORK_ORDER = 'work-outcome';
const SESSION = 'session-outcome';
const PRIVATE_CONTENT = 'PRIVATE_CUSTOMER_CONTENT_DO_NOT_COPY';
const temporaryDirectories: string[] = [];
const openStores: FleetStore[] = [];

interface ProductionOutcomeFixture {
  readonly receipt: VerifiableOutcomeReceipt;
  readonly artifactBytes: Buffer;
  readonly artifactSha256: string;
  readonly evidenceRef: string;
  readonly tenantId: string;
  readonly workOrderId: string;
  readonly sessionId: string;
}

afterEach(() => {
  openStores.splice(0).forEach((store) => store.close());
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('[CAPABILITY-OUTCOME-BINDING] independently verified local production outcome', () => {
  for (const [name, factory] of [
    ['memory', () => new MemoryFleetStore()],
    ['sqlite', () => new SqliteFleetStore(':memory:')],
  ] as const) {
    it(`creates a ${name} draft only from production outcome receipt and exact artifact bytes`, async () => {
      const outcome = productionOutcome();
      const store = factory(); openStores.push(store);
      await completedFleetTask(store, outcome);
      const created = await store.createCapabilityVersion(TENANT, versionInput(outcome), 'human:owner', NOW);
      expect(created).toMatchObject({ tenantId: TENANT, packageId: 'cap-outcome', status: 'draft' });
      expect(created.author.receiptRef).toBe(outcome.receipt.manifest.rootHash);
      expect(created.author.evidenceRefs).toEqual([outcome.artifactSha256]);
      expect(JSON.stringify(created)).not.toContain(PRIVATE_CONTENT);
      expect(JSON.stringify(await store.listTenantAudit(TENANT))).not.toContain(PRIVATE_CONTENT);
    });
  }

  it('rejects receipt tamper, rejected outcome, and synthetic ids without a receipt', async () => {
    const accepted = productionOutcome();
    const store = new MemoryFleetStore(); openStores.push(store);
    await completedFleetTask(store, accepted);

    const tampered = structuredClone(accepted.receipt);
    (tampered.receipt as { outcome: { verdict: string } }).outcome.verdict = 'rejected';
    await expect(store.createCapabilityVersion(TENANT, { ...versionInput(accepted), outcomeReceipt: tampered }, 'human:owner', NOW))
      .rejects.toMatchObject({ code: 'capability_trust_denied' });

    const rejected = productionOutcome({ verdict: 'rejected', sessionId: 'session-rejected' });
    await expect(store.createCapabilityVersion(TENANT, versionInput(rejected), 'human:owner', NOW))
      .rejects.toMatchObject({ code: 'capability_trust_denied' });

    const service = new FleetService(store, createSharedFleetValidators(), { now: () => new Date(NOW) });
    const oldIdOnlyInput = {
      author: author(accepted), sourceTaskId: 'task-source', artifactEventId: 'event-artifact', completedEventId: 'event-completed',
    };
    await expect(service.createCapabilityVersion({
      tenantId: TENANT, actorRef: 'human:owner', scopes: ['capability.write'], tokenId: 'test-owner',
    }, oldIdOnlyInput)).rejects.toMatchObject({ code: 'invalid_contract' });
    expect(await store.listCapabilities(TENANT)).toEqual([]);
  });

  it('rejects failed task and missing, altered, or hash-mismatched artifact bytes without a draft', async () => {
    const outcome = productionOutcome();
    const failedStore = new MemoryFleetStore(); openStores.push(failedStore);
    await completedFleetTask(failedStore, outcome, { terminal: 'failed' });
    await expect(failedStore.createCapabilityVersion(TENANT, versionInput(outcome), 'human:owner', NOW))
      .rejects.toMatchObject({ code: 'capability_not_found' });
    expect(await failedStore.listCapabilities(TENANT)).toEqual([]);

    for (const artifactContentBase64 of ['', Buffer.from('altered bytes').toString('base64')]) {
      const store = new MemoryFleetStore(); openStores.push(store);
      await completedFleetTask(store, outcome);
      await expect(store.createCapabilityVersion(TENANT, { ...versionInput(outcome), artifactContentBase64 }, 'human:owner', NOW))
        .rejects.toMatchObject({ code: 'capability_trust_denied' });
      expect(await store.listCapabilities(TENANT)).toEqual([]);
    }

    const hashStore = new MemoryFleetStore(); openStores.push(hashStore);
    await completedFleetTask(hashStore, outcome, { artifactSha256: '0'.repeat(64) });
    await expect(hashStore.createCapabilityVersion(TENANT, versionInput(outcome), 'human:owner', NOW))
      .rejects.toMatchObject({ code: 'capability_trust_denied' });
    expect(await hashStore.listCapabilities(TENANT)).toEqual([]);

    const missingHashStore = new MemoryFleetStore(); openStores.push(missingHashStore);
    await completedFleetTask(missingHashStore, outcome, { omitArtifactSha256: true });
    await expect(missingHashStore.createCapabilityVersion(TENANT, versionInput(outcome), 'human:owner', NOW))
      .rejects.toMatchObject({ code: 'capability_trust_denied' });
    expect(await missingHashStore.listCapabilities(TENANT)).toEqual([]);
  });

  it('rejects tenant, work-order, and provenance mismatch without persisting customer content', async () => {
    const source = productionOutcome();
    const store = new SqliteFleetStore(':memory:'); openStores.push(store);
    await completedFleetTask(store, source);

    const foreignTenant = productionOutcome({ tenantId: 'tenant-foreign', sessionId: 'session-foreign' });
    const otherWorkOrder = productionOutcome({ workOrderId: 'work-other', sessionId: 'session-other' });
    const wrongNode = versionInput(source);
    wrongNode.author = { ...wrongNode.author, provenance: { ...wrongNode.author.provenance, nodeId: 'node-other' } };
    const wrongSession = versionInput(source);
    wrongSession.author = { ...wrongSession.author, provenance: { ...wrongSession.author.provenance, demoSessionIds: ['session-other'] } };

    for (const input of [
      { ...versionInput(source), outcomeReceipt: foreignTenant.receipt },
      { ...versionInput(source), outcomeReceipt: otherWorkOrder.receipt },
      wrongNode,
      wrongSession,
    ]) {
      await expect(store.createCapabilityVersion(TENANT, input, 'human:owner', NOW))
        .rejects.toMatchObject({ code: 'capability_trust_denied' });
    }
    expect(await store.listCapabilities(TENANT)).toEqual([]);
    expect(JSON.stringify(await store.listTenantAudit(TENANT))).not.toContain(PRIVATE_CONTENT);
  });
});

function productionOutcome(options: {
  tenantId?: string;
  workOrderId?: string;
  sessionId?: string;
  verdict?: 'accepted' | 'rejected';
} = {}): ProductionOutcomeFixture {
  const tenantId = options.tenantId ?? TENANT;
  const workOrderId = options.workOrderId ?? WORK_ORDER;
  const sessionId = options.sessionId ?? SESSION;
  const directory = mkdtempSync(join(tmpdir(), 'hummer-capability-outcome-'));
  temporaryDirectories.push(directory);
  const persistence = openPersistence({ dataDirectory: directory, now: () => new Date(NOW) });
  try {
    persistence.runtimeEvents.saveSession({
      sessionId, tenantId, workOrderId, runtimeId: 'codex', startedAt: NOW,
      plan: { prompt: 'Synthetic local outcome task' }, handle: { sessionId, runtimeId: 'codex' },
    });
    const artifactBytes = Buffer.from(PRIVATE_CONTENT, 'utf8');
    const evidence = persistence.evidence.put(artifactBytes, {
      tenantId, sessionId, mediaType: 'text/plain', name: 'private-customer-artifact.txt', createdAt: NOW,
      metadata: { customerContent: true },
    });
    const definition = persistence.outcomes.defineOutcome({
      tenantId, actionPattern: 'local.synthetic.outcome', title: 'Synthetic local outcome',
      acceptanceCriteria: 'Artifact digest is independently verified', riskLevel: 'low',
      actorRef: 'human:owner', idempotencyKey: `definition-${tenantId}-${sessionId}`,
    });
    const outcome = persistence.outcomes.recordOutcome({
      tenantId, outcomeDefinitionId: definition.id, workOrderId, sessionId,
      verdict: options.verdict ?? 'accepted', acceptedBy: 'human:owner', evidenceRef: evidence.ref,
      occurredAt: NOW, idempotencyKey: `outcome-${tenantId}-${sessionId}`,
    });
    return {
      receipt: persistence.buildVerifiableOutcomeReceipt(tenantId, outcome.id, {}),
      artifactBytes, artifactSha256: evidence.sha256, evidenceRef: evidence.ref,
      tenantId, workOrderId, sessionId,
    };
  } finally {
    persistence.close();
  }
}

async function completedFleetTask(
  store: FleetStore,
  outcome: ProductionOutcomeFixture,
  options: { terminal?: 'completed' | 'failed'; artifactSha256?: string; omitArtifactSha256?: boolean } = {},
): Promise<void> {
  await store.registerNode(TENANT, {}, { nodeId: NODE, tenantIds: [TENANT], agentVersion: '1.0.0' }, [TENANT], undefined, NOW, 60_000);
  const task = {
    taskId: 'task-source', workOrderId: WORK_ORDER, tenantId: TENANT, targetNodeId: NODE, targetRuntime: 'codex',
    idempotencyKey: 'delivery-source', leaseMs: 30_000, expiresAt: LATER, originRef: 'local-production-outcome',
  };
  await store.enqueueTask(TENANT, task, task, null, NOW);
  await store.claimTask(TENANT, NODE, NOW);
  await fleetEvent(store, 'event-started', 1, 'started', { runId: 'run-source' });
  await fleetEvent(store, 'event-artifact', 2, 'artifact', {
    artifactId: 'artifact-source', ...(!options.omitArtifactSha256
      ? { sha256: options.artifactSha256 ?? outcome.artifactSha256 } : {}),
    bytes: outcome.artifactBytes.byteLength, relPath: 'outputs/result.txt',
  });
  if ((options.terminal ?? 'completed') === 'completed') {
    await fleetEvent(store, 'event-completed', 3, 'completed', { summary: 'Synthetic task completed.' });
  } else {
    await fleetEvent(store, 'event-failed', 3, 'failed', { code: 'synthetic_failure', message: 'Synthetic failure.', retryable: false });
  }
}

async function fleetEvent(store: FleetStore, eventId: string, seq: number, type: RunEventClaims['type'], payload: Record<string, unknown>): Promise<void> {
  const claims: RunEventClaims = {
    eventId, tenantId: TENANT, workOrderId: WORK_ORDER, nodeId: NODE, seq, occurredAt: NOW, type,
    idempotencyKey: `key-${eventId}`,
  };
  await store.putEvent(TENANT, { schema: 'hummer.run-event', version: 1, ...claims, actorRef: `system:${NODE}`, payload }, claims, NOW);
}

function versionInput(outcome: ProductionOutcomeFixture): CapabilityVersionCreateInput {
  return {
    author: author(outcome), sourceTaskId: 'task-source', artifactEventId: 'event-artifact', completedEventId: 'event-completed',
    outcomeReceipt: outcome.receipt, artifactContentBase64: outcome.artifactBytes.toString('base64'),
  };
}

function author(outcome: ProductionOutcomeFixture): CapabilityPackageAuthorInput {
  return {
    schema: 'hummer.capability-package-author-input', version: 1, tenantId: TENANT,
    packageId: 'cap-outcome', packageVersion: 1, title: 'Reusable synthesis',
    goal: 'Produce a reviewed synthesis without retaining source customer content.', preset: 'expert-work',
    capabilityTrack: {
      responsibilities: ['Synthesize'], workflows: ['Read, reason, review'], standards: ['Verify evidence'],
      heuristics: ['Prefer primary evidence'], pitfalls: ['Do not copy customer content'], examples: ['A redacted synthesis'],
    },
    behaviorTrack: { expressionPreferences: ['Be concise'], interactionRules: ['State uncertainty'], corrections: [] },
    runtimeProfile: 'runtime-default', toolIds: ['fs.read'], requiredCapabilities: ['fs.read'],
    acceptanceCriteria: ['Output is evidence-grounded and contains no source customer content.'],
    sourceBoundary: { apps: ['HUMMER'], windows: ['Synthetic fixture'], includePaths: ['outputs'], excludePaths: ['customer-private'] },
    provenance: {
      demoSessionIds: [outcome.sessionId], expertActorRef: 'expert:alice', nodeId: NODE, device: 'local-fixture',
      runtime: 'codex', runtimeVersion: '1.0.0', agentVersion: '1.0.0', capturedAt: NOW,
    },
    evidenceRefs: [outcome.artifactSha256], failureNotes: ['Fails closed when receipt or bytes mismatch.'],
    declaredPermissions: [{ capability: 'fs.read', access: 'read', paths: ['outputs'] }],
    regressionSuiteRef: 'suite-outcome', receiptRef: outcome.receipt.manifest.rootHash,
    status: 'draft', deletionAudit: {},
  };
}
