import { describe, expect, it } from 'vitest';
import type { DemoSessionV1 } from '@hummer/contracts';
import {
  applyCorrection,
  createDraftRevisionHistory,
  distillSyntheticDemo,
  proposeNaturalLanguageCorrection,
  rollbackDraft,
  type DistillationSpec,
  type GuiGroundingAdapter,
  type ReviewableCapabilityDraft,
  type SyntheticDemoRecord,
} from './index.ts';

const at = '2026-10-07T02:10:00Z';
const later = '2026-10-07T02:20:00Z';

function session(): DemoSessionV1 {
  return {
    schema: 'hummer.demo-session',
    version: 1,
    sessionId: 'demo-synthetic-1',
    tenantId: 'tenant-a',
    expertActorRef: 'human:expert-a',
    nodeId: 'node-a',
    sourceBoundary: { apps: ['SyntheticResearch'], windows: ['Synthetic workspace'], excluded: ['Secrets'] },
    startedAt: '2026-10-07T02:00:00Z',
    endedAt: '2026-10-07T02:09:59Z',
    pausedCount: 0,
    segments: [{
      segId: 'seg-1',
      sequence: 1,
      from: '2026-10-07T02:00:00Z',
      to: '2026-10-07T02:09:59Z',
      recordCount: 2,
      previousDigest: null,
      digest: 'a'.repeat(64),
    }],
    captureMode: 'events-only',
    status: 'ended',
    localOnly: true,
    redactionApplied: false,
    evidenceRefs: ['evi-synthetic-1', 'evi-synthetic-2'],
    chainHead: 'a'.repeat(64),
    deletionAudit: [],
  };
}

function records(): SyntheticDemoRecord[] {
  return [
    {
      schema: 'hummer.synthetic-demo-record',
      version: 1,
      synthetic: true,
      recordId: 'record-1',
      tenantId: 'tenant-a',
      sessionId: 'demo-synthetic-1',
      segmentId: 'seg-1',
      occurredAt: '2026-10-07T02:01:00Z',
      app: 'SyntheticResearch',
      window: 'Synthetic workspace',
      evidenceRef: 'evi-synthetic-1',
      action: { kind: 'click', description: 'Open the synthetic evidence table', targetHint: 'Evidence table' },
    },
    {
      schema: 'hummer.synthetic-demo-record',
      version: 1,
      synthetic: true,
      recordId: 'record-2',
      tenantId: 'tenant-a',
      sessionId: 'demo-synthetic-1',
      segmentId: 'seg-1',
      occurredAt: '2026-10-07T02:05:00Z',
      app: 'SyntheticResearch',
      window: 'Synthetic workspace',
      evidenceRef: 'evi-synthetic-2',
      action: { kind: 'observe', description: 'Compare the two synthetic claims', targetHint: 'Claim comparison' },
      judgment: { needsHuman: true, scene: 'Conflicting synthetic claims', reason: 'The evidence does not determine business materiality' },
    },
  ];
}

function spec(packageId = 'cap-synthetic-research'): DistillationSpec {
  return {
    packageId,
    title: 'Synthetic evidence review',
    goal: 'Review synthetic evidence without claiming expert equivalence.',
    runtimeProfile: 'runtime-local',
    toolIds: ['synthetic-reader'],
    requiredCapabilities: ['workspace.read'],
    acceptanceCriteria: ['Every conclusion cites one synthetic source.'],
    includePaths: ['workspace/synthetic'],
    excludePaths: ['workspace/secrets'],
    device: 'synthetic-device',
    runtime: 'distillation-kernel',
    runtimeVersion: '0.1.0',
    agentVersion: '0.1.0',
    declaredPermissions: [{ capability: 'workspace.read', access: 'read', paths: ['workspace/synthetic'] }],
    regressionSuiteRef: 'suite-synthetic-1',
    receiptRef: 'receipt-pending-1',
    groundingMinConfidence: 0.9,
  };
}

function adapter(overrides: Partial<GuiGroundingAdapter> = {}): GuiGroundingAdapter {
  return {
    id: 'synthetic-grounder-a',
    async ground({ record }) {
      return {
        status: 'grounded',
        element: { stableId: `element-${record.recordId}`, role: 'synthetic-control', label: record.action.targetHint },
        matchedBy: 'accessibility-id',
        sourceRecordId: record.recordId,
        evidenceRef: record.evidenceRef,
        candidateCount: 1,
        confidence: 1,
      };
    },
    ...overrides,
  };
}

async function draft(packageId?: string): Promise<ReviewableCapabilityDraft> {
  const result = await distillSyntheticDemo({ session: session(), records: records(), adapter: adapter(), spec: spec(packageId), generatedAt: at });
  if (!result.ok) throw new Error('test fixture unexpectedly needs human grounding');
  return result.draft;
}

describe('DISTILLATION W8 local synthetic kernel', () => {
  it('creates a reviewable dual-track draft, source list, and explicit needs-human annotation', async () => {
    const result = await distillSyntheticDemo({ session: session(), records: records(), adapter: adapter(), spec: spec(), generatedAt: at });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.package.schema).toBe('hummer.capability-package-author-input');
    expect(result.draft.package.status).toBe('draft');
    expect(result.draft.package).not.toHaveProperty('trialRecord');
    expect(result.draft.capabilityTrack.workflows).toHaveLength(2);
    expect(result.draft.boundedBehaviorTrack.interactionRules[0]).toContain('Ask a human');
    expect(result.draft.sources.map((source) => source.evidenceRef)).toEqual(['evi-synthetic-1', 'evi-synthetic-2']);
    expect(result.draft.judgmentAnnotations).toEqual([
      expect.objectContaining({ sourceRecordId: 'record-2', disposition: 'needs-human' }),
    ]);
    expect(result.draft.generatedFrom).toBe('synthetic-structured-records-only');
  });

  it('uses a replaceable grounding adapter without changing distillation semantics', async () => {
    const alternate = adapter({
      id: 'synthetic-grounder-b',
      async ground({ record }) {
        return {
          status: 'grounded',
          element: { stableId: `alternate-${record.recordId}`, role: 'button' },
          matchedBy: 'semantic-role-label',
          sourceRecordId: record.recordId,
          evidenceRef: record.evidenceRef,
          candidateCount: 1,
          confidence: 0.95,
        };
      },
    });
    const result = await distillSyntheticDemo({ session: session(), records: records(), adapter: alternate, spec: spec(), generatedAt: at });
    expect(result.ok && result.draft.groundedActions[0]?.grounding.adapterId).toBe('synthetic-grounder-b');
    expect(result.ok && result.draft.groundedActions[0]?.element.stableId).toBe('alternate-record-1');
  });

  it('fails closed when grounding fails and emits no partial draft', async () => {
    const failed = adapter({ async ground() { return { status: 'failed', reason: 'No element matched' }; } });
    const result = await distillSyntheticDemo({ session: session(), records: records(), adapter: failed, spec: spec(), generatedAt: at });
    expect(result).toMatchObject({ ok: false, status: 'needs-human' });
    if (result.ok) return;
    expect(result.failures).toHaveLength(2);
    expect(result.failures[0]).toMatchObject({ code: 'adapter-failed' });
    expect(result).not.toHaveProperty('draft');
  });

  it.each([
    ['ambiguous candidates', { candidateCount: 2 }, 'ambiguous-candidates'],
    ['low confidence', { confidence: 0.2 }, 'low-confidence'],
    ['unbound evidence', { evidenceRef: 'evi-other' }, 'unbound-grounding-evidence'],
  ])('fails closed for %s instead of guessing', async (_label, override, code) => {
    const unsafe = adapter({
      async ground({ record }) {
        return {
          status: 'grounded',
          element: { stableId: `element-${record.recordId}`, role: 'button' },
          matchedBy: 'visual-model',
          sourceRecordId: record.recordId,
          evidenceRef: record.evidenceRef,
          candidateCount: 1,
          confidence: 0.99,
          ...override,
        } as never;
      },
    });
    const result = await distillSyntheticDemo({ session: session(), records: records(), adapter: unsafe, spec: spec(), generatedAt: at });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures[0]?.code).toBe(code);
  });

  it('rejects a record with no bound provenance source', async () => {
    const missing = records();
    missing[0]!.evidenceRef = 'evi-not-in-session';
    await expect(distillSyntheticDemo({ session: session(), records: missing, adapter: adapter(), spec: spec(), generatedAt: at }))
      .rejects.toThrow('no bound DemoSession evidence source');
  });

  it('rejects a source set with no explicit needs-human judgment annotation', async () => {
    const noJudgment = records().map(({ judgment: _judgment, ...record }) => record);
    await expect(distillSyntheticDemo({ session: session(), records: noJudgment, adapter: adapter(), spec: spec(), generatedAt: at }))
      .rejects.toThrow('needs-human judgment annotation');
  });

  it('rejects unknown source fields rather than silently accepting them', async () => {
    const unknown = records().map((record, index) => index === 0 ? { ...record, hiddenRawText: 'secret' } : record);
    await expect(distillSyntheticDemo({ session: session(), records: unknown, adapter: adapter(), spec: spec(), generatedAt: at }))
      .rejects.toThrow('Unsupported fields');
  });

  it('turns a bounded natural-language capability correction into an audited next version', async () => {
    const initial = await draft();
    const workflow = initial.package.capabilityTrack.workflows[0]!;
    const corrected = workflow.replace('Open', 'Review');
    const proposal = proposeNaturalLanguageCorrection(initial, `replace workflow "${workflow}" with "${corrected}"`, 'human:expert-a', later);
    const history = applyCorrection(createDraftRevisionHistory(initial, 'human:expert-a', at), proposal);
    const current = history.revisions.at(-1)!;
    expect(current.package.packageVersion).toBe(2);
    expect(current.package.supersedesVersion).toBe(1);
    expect(current.package.previousPackageDigest).toBe(initial.packageDigest);
    expect(current.package.capabilityTrack.workflows[0]).toBe(corrected);
    expect(history.audit.at(-1)).toMatchObject({ action: 'correction-applied', proposalDigest: proposal.proposalDigest });
  });

  it('turns a bounded natural-language behavior correction into scene/wrong/correct history', async () => {
    const initial = await draft();
    const proposal = proposeNaturalLanguageCorrection(
      initial,
      'when "Conflicting claims", replace "Choose the louder claim" with "Ask the accountable human"',
      'human:expert-a',
      later,
    );
    const history = applyCorrection(createDraftRevisionHistory(initial, 'human:expert-a', at), proposal);
    expect(history.revisions.at(-1)?.package.behaviorTrack.corrections).toEqual([
      { scene: 'Conflicting claims', wrong: 'Choose the louder claim', correct: 'Ask the accountable human' },
    ]);
  });

  it('rejects an altered proposal digest and a proposal from another package', async () => {
    const initial = await draft();
    const workflow = initial.package.capabilityTrack.workflows[0]!;
    const proposal = proposeNaturalLanguageCorrection(initial, `replace workflow "${workflow}" with "Reviewed workflow"`, 'human:expert-a', later);
    const altered = structuredClone(proposal);
    if (altered.change.kind === 'replace-capability-item') altered.change.correct = 'Forged workflow';
    const history = createDraftRevisionHistory(initial, 'human:expert-a', at);
    expect(() => applyCorrection(history, altered)).toThrow('altered');

    const other = await draft('cap-other');
    const otherHistory = createDraftRevisionHistory(other, 'human:expert-a', at);
    expect(() => applyCorrection(otherHistory, proposal)).toThrow('different tenant or package');
  });

  it('rolls back by appending a new audited version and rejects invalid rollback targets', async () => {
    const initial = await draft();
    const workflow = initial.package.capabilityTrack.workflows[0]!;
    const proposal = proposeNaturalLanguageCorrection(initial, `replace workflow "${workflow}" with "Changed workflow"`, 'human:expert-a', later);
    const changed = applyCorrection(createDraftRevisionHistory(initial, 'human:expert-a', at), proposal);
    const rolledBack = rollbackDraft(changed, 1, 'human:expert-a', '2026-10-07T02:30:00Z');
    const current = rolledBack.revisions.at(-1)!;
    expect(current.package.packageVersion).toBe(3);
    expect(current.package.capabilityTrack.workflows).toEqual(initial.package.capabilityTrack.workflows);
    expect(current.package.previousPackageDigest).toBe(changed.revisions.at(-1)?.packageDigest);
    expect(rolledBack.audit.at(-1)).toMatchObject({ action: 'rollback-applied', targetVersion: 1 });
    expect(() => rollbackDraft(rolledBack, 99, 'human:expert-a', '2026-10-07T02:40:00Z')).toThrow('existing earlier');
    expect(() => rollbackDraft(rolledBack, 3, 'human:expert-a', '2026-10-07T02:40:00Z')).toThrow('existing earlier');
  });

  it('rejects unbounded prose instead of inventing a correction', async () => {
    const initial = await draft();
    expect(() => proposeNaturalLanguageCorrection(initial, 'Make it more like the expert', 'human:expert-a', later))
      .toThrow('outside the bounded grammar');
  });
});
