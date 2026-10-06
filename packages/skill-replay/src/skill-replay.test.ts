import { describe, expect, it } from 'vitest';
import {
  assessSkillPromotion,
  compileSkillPlan,
  createRegressionSuite,
  runRegressionSuite,
  runSkillReplay,
  type DeterministicStepAdapter,
  type HumanReplayApproval,
  type ReplayEnvironment,
  type SkillRegressionReport,
  type SkillReplayResult,
} from './index.ts';
import {
  computeCapabilityPackageDigest,
  type CapabilityPackageV1,
} from '@hummer/contracts';

const environment: ReplayEnvironment = {
  nodeId: 'node-a',
  os: 'windows',
  runtime: 'node',
  runtimeVersion: '22.22.2',
  appVersions: { skillReplay: '0.1.0' },
};

function capabilityPackage(): CapabilityPackageV1 {
  const base = {
    schema: 'hummer.capability-package' as const,
    version: 1 as const,
    tenantId: 'tenant-a',
    packageId: 'cap-replay',
    packageVersion: 1,
    title: 'Replay fixture',
    goal: 'Exercise a deterministic local replay kernel',
    preset: 'expert-work' as const,
    capabilityTrack: {
      responsibilities: ['transform deterministic input'],
      workflows: ['normalize then summarize'],
      standards: ['same input has the same digest'],
      heuristics: ['stop on the first failed step'],
      pitfalls: ['do not infer missing output'],
      examples: ['hello becomes HELLO'],
    },
    behaviorTrack: {
      expressionPreferences: ['concise'],
      interactionRules: ['do not perform external writes'],
      corrections: [],
    },
    runtimeProfile: 'skill-replay-local',
    toolIds: [],
    requiredCapabilities: [],
    acceptanceCriteria: ['all regression cases pass'],
    sourceBoundary: {
      apps: ['synthetic-fixture'],
      windows: ['fixture-window'],
      includePaths: ['fixtures'],
      excludePaths: ['fixtures/secrets'],
    },
    provenance: {
      demoSessionIds: ['demo-redacted'],
      expertActorRef: 'expert:expert-a',
      nodeId: 'node-a',
      device: 'synthetic-test-host',
      runtime: 'node',
      runtimeVersion: '22.22.2',
      agentVersion: 'w9-local-kernel',
      capturedAt: '2026-10-07T00:00:00.000Z',
    },
    evidenceRefs: ['evidence-redacted'],
    failureNotes: [],
    declaredPermissions: [],
    regressionSuiteRef: 'regression-replay-v1',
    receiptRef: 'receipt-replay-v1',
    status: 'shadow' as const,
    deletionAudit: {},
    trialRecord: {
      tenantId: 'tenant-a',
      packageId: 'cap-replay',
      packageVersion: 1,
      packageDigest: '0'.repeat(64),
      trialIds: ['bootstrap-trial'],
      shadowRuns: 1,
      success: 1,
      failure: 0,
      lastRunAt: '2026-10-07T00:00:01.000Z',
      environments: [environment],
      regressionPassed: false,
      regressionEvidenceDigest: '1'.repeat(64),
    },
    packageDigest: '0'.repeat(64),
  };
  const digest = computeCapabilityPackageDigest(base);
  return {
    ...base,
    packageDigest: digest,
    trialRecord: { ...base.trialRecord, packageDigest: digest },
  };
}

const adapters: Record<string, DeterministicStepAdapter> = {
  normalize: {
    adapterId: 'normalize', deterministic: true, sideEffects: 'none',
    execute: ({ caseInput }) => ({ value: String((caseInput as { text: string }).text).trim().toLowerCase() }),
  },
  summarize: {
    adapterId: 'summarize', deterministic: true, sideEffects: 'none',
    execute: ({ priorOutputs }) => ({ summary: String((priorOutputs.normalize as { value: string }).value).toUpperCase() }),
  },
};

function fixture() {
  const pkg = capabilityPackage();
  const plan = compileSkillPlan(pkg, {
    schema: 'hummer.compiled-skill-plan', version: 1, planId: 'plan-replay-v1',
    packageId: pkg.packageId, packageVersion: pkg.packageVersion, packageDigest: pkg.packageDigest,
    steps: [
      { stepId: 'normalize', adapterId: 'normalize', dependsOn: [], input: {} },
      { stepId: 'summarize', adapterId: 'summarize', dependsOn: ['normalize'], input: {} },
    ],
  });
  return { pkg, plan };
}

async function replay(trialId: string, overrides: Partial<Parameters<typeof runSkillReplay>[0]> = {}) {
  const { pkg, plan } = fixture();
  return runSkillReplay({
    tenantId: pkg.tenantId, trialId, package: pkg, plan, mode: 'shadow',
    caseInput: { text: '  Hello  ' }, adapters, environment,
    startedAt: '2026-10-07T00:00:00.000Z', endedAt: '2026-10-07T00:00:01.000Z',
    ...overrides,
  });
}

describe('[SKILL-REPLAY] deterministic local replay', () => {
  it('produces the same replay digest for the same plan and input', async () => {
    const first = await replay('trial-1');
    const second = await replay('trial-2', {
      startedAt: '2026-10-07T00:05:00.000Z', endedAt: '2026-10-07T00:05:01.000Z',
    });
    expect(first.ok).toBe(true);
    expect(second.replayDigest).toBe(first.replayDigest);
    expect(second.outputDigest).toBe(first.outputDigest);
  });

  it('fails closed on a non-deterministic or side-effecting adapter', async () => {
    const unsafe = { ...adapters, normalize: { ...adapters.normalize!, deterministic: false as const } };
    await expect(replay('trial-unsafe', {
      adapters: unsafe as unknown as Record<string, DeterministicStepAdapter>,
    })).rejects.toThrow('SKILL_REPLAY_ADAPTER_UNSAFE:normalize');
  });

  it('attributes an adapter failure to the exact compiled step', async () => {
    const failing = {
      ...adapters,
      summarize: { ...adapters.summarize!, execute: () => { throw new Error('fixture failure'); } },
    };
    const result = await replay('trial-failed', { adapters: failing });
    expect(result).toMatchObject({ ok: false, failureStepRef: 'summarize' });
    expect(result.trial).toMatchObject({ ok: false, failureStepRef: 'summarize', recordedBy: 'system:skill-trial' });
  });

  it('requires a package-bound human approval record for live mode', async () => {
    const { pkg, plan } = fixture();
    const base = {
      tenantId: pkg.tenantId, trialId: 'trial-live', package: pkg, plan, mode: 'live' as const,
      caseInput: { text: 'hello' }, adapters, environment,
      startedAt: '2026-10-07T00:00:00.000Z', endedAt: '2026-10-07T00:00:01.000Z',
    };
    await expect(runSkillReplay(base)).rejects.toThrow('SKILL_REPLAY_APPROVAL_REQUIRED');
    const nonHuman: HumanReplayApproval = {
      approvalRef: 'approval-live-1', tenantId: pkg.tenantId, decidedBy: 'system:auto', decision: 'approved',
      action: 'capability.live-replay', packageDigest: pkg.packageDigest, planDigest: plan.planDigest,
    };
    await expect(runSkillReplay({ ...base, approval: nonHuman })).rejects.toThrow('SKILL_REPLAY_APPROVAL_INVALID');
    const human = { ...nonHuman, decidedBy: 'human:boss-a' } satisfies HumanReplayApproval;
    const approved = await runSkillReplay({ ...base, approval: human });
    expect(approved.trial.liveApprovalRef).toBe(human.approvalRef);
  });

  it('rejects a plan with forward dependencies or a different package binding', () => {
    const { pkg } = fixture();
    expect(() => compileSkillPlan(pkg, {
      schema: 'hummer.compiled-skill-plan', version: 1, planId: 'bad-dependency',
      packageId: pkg.packageId, packageVersion: pkg.packageVersion, packageDigest: pkg.packageDigest,
      steps: [
        { stepId: 'first', adapterId: 'normalize', dependsOn: ['later'], input: {} },
        { stepId: 'later', adapterId: 'summarize', dependsOn: [], input: {} },
      ],
    })).toThrow('SKILL_REPLAY_PLAN_INVALID:first:later');
    expect(() => compileSkillPlan(pkg, {
      schema: 'hummer.compiled-skill-plan', version: 1, planId: 'bad-package',
      packageId: pkg.packageId, packageVersion: pkg.packageVersion, packageDigest: 'f'.repeat(64), steps: [],
    })).toThrow('SKILL_REPLAY_PACKAGE_MISMATCH');
  });
});

describe('[SKILL-REPLAY] executable regression suite', () => {
  it('derives a stable passing report by executing every case', async () => {
    const { pkg, plan } = fixture();
    const baseline = await replay('trial-baseline');
    const suite = createRegressionSuite(pkg, plan, {
      suiteId: pkg.regressionSuiteRef,
      cases: [
        { caseId: 'hello', input: { text: '  Hello  ' }, expectedOutputDigest: baseline.outputDigest },
        { caseId: 'hello-repeat', input: { text: '  Hello  ' }, expectedOutputDigest: baseline.outputDigest },
      ],
    });
    const report = await runRegressionSuite({
      package: pkg, plan, suite, adapters, environment, executedAt: '2026-10-07T00:10:00.000Z',
    });
    expect(report.passed).toBe(true);
    expect(report.cases).toHaveLength(2);
    expect(report.evidenceDigest).toMatch(/^[a-f0-9]{64}$/);
    const repeated = await runRegressionSuite({
      package: pkg, plan, suite, adapters, environment, executedAt: '2026-10-07T00:20:00.000Z',
    });
    expect(repeated.evidenceDigest).toBe(report.evidenceDigest);
  });

  it('records a failed case instead of accepting a caller pass boolean', async () => {
    const { pkg, plan } = fixture();
    const suite = createRegressionSuite(pkg, plan, {
      suiteId: pkg.regressionSuiteRef,
      cases: [{ caseId: 'wrong-expectation', input: { text: 'hello' }, expectedOutputDigest: 'f'.repeat(64) }],
    });
    const report = await runRegressionSuite({ package: pkg, plan, suite, adapters, environment });
    expect(report).toMatchObject({ passed: false, cases: [{ caseId: 'wrong-expectation', passed: false }] });
  });
});

describe('[SKILL-REPLAY] promotion assessment', () => {
  async function trials(count: number): Promise<SkillReplayResult[]> {
    return Promise.all(Array.from({ length: count }, (_, index) => replay(`trial-${index + 1}`)));
  }

  async function passingReport(): Promise<SkillRegressionReport> {
    const { pkg, plan } = fixture();
    const baseline = await replay('trial-regression-baseline');
    const suite = createRegressionSuite(pkg, plan, {
      suiteId: pkg.regressionSuiteRef,
      cases: [{ caseId: 'promotion-case', input: { text: '  Hello  ' }, expectedOutputDigest: baseline.outputDigest }],
    });
    return runRegressionSuite({ package: pkg, plan, suite, adapters, environment });
  }

  it('rejects promotion with fewer than five successful unique shadow trials', async () => {
    const { pkg, plan } = fixture();
    const decision = assessSkillPromotion(pkg, plan, await trials(4), await passingReport());
    expect(decision).toMatchObject({ allowed: false, reasons: ['insufficient_shadow_trials'] });
  });

  it('rejects promotion when any trial failed', async () => {
    const { pkg, plan } = fixture();
    const records = await trials(5);
    records[4] = await replay('trial-failed-promotion', {
      adapters: { ...adapters, summarize: { ...adapters.summarize!, execute: () => { throw new Error('fail'); } } },
    });
    const decision = assessSkillPromotion(pkg, plan, records, await passingReport());
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain('shadow_trial_failed');
  });

  it('rejects promotion when an executed regression case failed', async () => {
    const { pkg, plan } = fixture();
    const suite = createRegressionSuite(pkg, plan, {
      suiteId: pkg.regressionSuiteRef,
      cases: [{ caseId: 'failed-promotion-case', input: { text: 'hello' }, expectedOutputDigest: 'f'.repeat(64) }],
    });
    const failed = await runRegressionSuite({ package: pkg, plan, suite, adapters, environment });
    const decision = assessSkillPromotion(pkg, plan, await trials(5), failed);
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain('regression_failed');
  });

  it('rejects duplicate trials and replay evidence forged outside the runner', async () => {
    const { pkg, plan } = fixture();
    const duplicate = await trials(5);
    duplicate[4] = duplicate[0]!;
    expect(assessSkillPromotion(pkg, plan, duplicate, await passingReport()).reasons).toContain('duplicate_trial_id');

    const forged = await trials(5);
    forged[4] = { ...forged[4]!, outputDigest: 'f'.repeat(64) };
    expect(assessSkillPromotion(pkg, plan, forged, await passingReport()).reasons).toContain('invalid_replay');
  });

  it('approves exactly-bound evidence and derives the existing TrialRecord', async () => {
    const { pkg, plan } = fixture();
    const decision = assessSkillPromotion(pkg, plan, await trials(5), await passingReport());
    expect(decision).toMatchObject({ allowed: true, reasons: ['promotion_gate_passed'] });
    if (!decision.allowed) throw new Error(`unexpected promotion denial: ${decision.reasons.join(',')}`);
    expect(decision.trialRecord).toMatchObject({ shadowRuns: 5, success: 5, failure: 0, regressionPassed: true });
  });
});
