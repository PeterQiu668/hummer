import { createHash } from 'node:crypto';
import {
  createTrialRecordFromSystemTrials,
  validateCapabilityContract,
  type CapabilityPackageV1,
  type SkillTrialSystemRecordInput,
  type TrialRecord,
} from '@hummer/contracts';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | { readonly [key: string]: JsonValue } | readonly JsonValue[];

export interface CompiledSkillStep {
  readonly stepId: string;
  readonly adapterId: string;
  readonly dependsOn: readonly string[];
  readonly input: JsonValue;
}

export interface CompiledSkillPlanInput {
  readonly schema: 'hummer.compiled-skill-plan';
  readonly version: 1;
  readonly planId: string;
  readonly packageId: string;
  readonly packageVersion: number;
  readonly packageDigest: string;
  readonly steps: readonly CompiledSkillStep[];
}

export interface CompiledSkillPlan extends CompiledSkillPlanInput {
  readonly planDigest: string;
}

export interface ReplayEnvironment {
  readonly nodeId: string;
  readonly os: string;
  readonly runtime: string;
  readonly runtimeVersion: string;
  readonly appVersions: Readonly<Record<string, string>>;
}

export interface StepExecutionInput {
  readonly caseInput: JsonValue;
  readonly stepInput: JsonValue;
  readonly priorOutputs: Readonly<Record<string, JsonValue>>;
}

export interface DeterministicStepAdapter {
  readonly adapterId: string;
  readonly deterministic: true;
  readonly sideEffects: 'none';
  execute(input: StepExecutionInput): JsonValue | Promise<JsonValue>;
}

export interface HumanReplayApproval {
  readonly approvalRef: string;
  readonly tenantId: string;
  readonly decidedBy: string;
  readonly decision: 'approved' | 'declined';
  readonly action: 'capability.live-replay';
  readonly packageDigest: string;
  readonly planDigest: string;
}

export interface ReplayStepResult {
  readonly stepId: string;
  readonly status: 'passed' | 'failed';
  readonly outputDigest?: string;
  readonly errorCode?: 'adapter_failed';
}

export interface SkillReplayResult {
  readonly schema: 'hummer.skill-replay-result';
  readonly version: 1;
  readonly tenantId: string;
  readonly packageId: string;
  readonly packageVersion: number;
  readonly packageDigest: string;
  readonly planDigest: string;
  readonly inputDigest: string;
  readonly outputDigest: string;
  readonly replayDigest: string;
  readonly ok: boolean;
  readonly failureStepRef?: string;
  readonly steps: readonly ReplayStepResult[];
  readonly trial: SkillTrialSystemRecordInput;
}

export interface RunSkillReplayInput {
  readonly tenantId: string;
  readonly trialId: string;
  readonly package: CapabilityPackageV1;
  readonly plan: CompiledSkillPlan;
  readonly mode: 'shadow' | 'live';
  readonly caseInput: JsonValue;
  readonly adapters: Readonly<Record<string, DeterministicStepAdapter>>;
  readonly environment: ReplayEnvironment;
  readonly approval?: HumanReplayApproval;
  readonly startedAt?: string;
  readonly endedAt?: string;
  readonly receiptRef?: string;
}

export interface SkillRegressionCaseInput {
  readonly caseId: string;
  readonly input: JsonValue;
  readonly expectedOutputDigest: string;
}

export interface SkillRegressionSuite {
  readonly schema: 'hummer.skill-regression-suite';
  readonly version: 1;
  readonly suiteId: string;
  readonly packageId: string;
  readonly packageVersion: number;
  readonly packageDigest: string;
  readonly planDigest: string;
  readonly cases: readonly SkillRegressionCaseInput[];
  readonly suiteDigest: string;
}

export interface SkillRegressionCaseResult {
  readonly caseId: string;
  readonly passed: boolean;
  readonly expectedOutputDigest: string;
  readonly actualOutputDigest: string;
  readonly replayDigest: string;
  readonly failureStepRef?: string;
}

export interface SkillRegressionReport {
  readonly schema: 'hummer.skill-regression-report';
  readonly version: 1;
  readonly suiteId: string;
  readonly suiteDigest: string;
  readonly packageId: string;
  readonly packageVersion: number;
  readonly packageDigest: string;
  readonly planDigest: string;
  readonly passed: boolean;
  readonly cases: readonly SkillRegressionCaseResult[];
  readonly executedAt: string;
  readonly evidenceDigest: string;
}

export interface RunRegressionSuiteInput {
  readonly package: CapabilityPackageV1;
  readonly plan: CompiledSkillPlan;
  readonly suite: SkillRegressionSuite;
  readonly adapters: Readonly<Record<string, DeterministicStepAdapter>>;
  readonly environment: ReplayEnvironment;
  readonly executedAt?: string;
}

export type PromotionDenialReason =
  | 'invalid_package'
  | 'invalid_plan'
  | 'invalid_replay'
  | 'invalid_trial'
  | 'trial_binding_mismatch'
  | 'duplicate_trial_id'
  | 'non_shadow_trial'
  | 'insufficient_shadow_trials'
  | 'shadow_trial_failed'
  | 'regression_report_invalid'
  | 'regression_binding_mismatch'
  | 'regression_failed';

export type SkillPromotionDecision =
  | { readonly allowed: true; readonly reasons: readonly ['promotion_gate_passed']; readonly trialRecord: TrialRecord }
  | { readonly allowed: false; readonly reasons: readonly PromotionDenialReason[] };

const IDENTIFIER = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;

export function compileSkillPlan(
  capability: CapabilityPackageV1,
  input: CompiledSkillPlanInput,
): CompiledSkillPlan {
  assertCapability(capability);
  if (input.schema !== 'hummer.compiled-skill-plan' || input.version !== 1 || !IDENTIFIER.test(input.planId)) {
    throw new Error('SKILL_REPLAY_PLAN_INVALID:header');
  }
  assertPackageBinding(capability, input, 'SKILL_REPLAY_PACKAGE_MISMATCH');
  if (!Array.isArray(input.steps) || input.steps.length > 256) throw new Error('SKILL_REPLAY_PLAN_INVALID:steps');
  const seen = new Set<string>();
  for (const step of input.steps) {
    if (!IDENTIFIER.test(step.stepId) || !IDENTIFIER.test(step.adapterId) || seen.has(step.stepId)) {
      throw new Error(`SKILL_REPLAY_PLAN_INVALID:${step.stepId || 'step'}`);
    }
    if (!Array.isArray(step.dependsOn) || new Set(step.dependsOn).size !== step.dependsOn.length) {
      throw new Error(`SKILL_REPLAY_PLAN_INVALID:${step.stepId}:dependencies`);
    }
    for (const dependency of step.dependsOn) {
      if (!seen.has(dependency)) throw new Error(`SKILL_REPLAY_PLAN_INVALID:${step.stepId}:${dependency}`);
    }
    canonicalJson(step.input);
    seen.add(step.stepId);
  }
  const normalized = deepFreeze(structuredClone(input));
  return deepFreeze({ ...normalized, planDigest: sha256(canonicalJson(normalized)) });
}

export async function runSkillReplay(input: RunSkillReplayInput): Promise<SkillReplayResult> {
  assertCapability(input.package);
  assertCompiledPlan(input.package, input.plan);
  if (input.tenantId !== input.package.tenantId) throw new Error('SKILL_REPLAY_TENANT_MISMATCH');
  if (!IDENTIFIER.test(input.trialId)) throw new Error('SKILL_REPLAY_TRIAL_ID_INVALID');
  assertEnvironment(input.environment);
  assertTimes(input.startedAt, input.endedAt);
  if (input.mode === 'live') assertLiveApproval(input);

  for (const step of input.plan.steps) {
    const adapter = input.adapters[step.adapterId];
    if (!adapter || adapter.adapterId !== step.adapterId || adapter.deterministic !== true || adapter.sideEffects !== 'none') {
      throw new Error(`SKILL_REPLAY_ADAPTER_UNSAFE:${step.stepId}`);
    }
  }

  const caseInput = deepFreeze(structuredClone(input.caseInput));
  const inputDigest = sha256(canonicalJson(caseInput));
  const priorOutputs: Record<string, JsonValue> = {};
  const steps: ReplayStepResult[] = [];
  let failureStepRef: string | undefined;

  for (const step of input.plan.steps) {
    const adapter = input.adapters[step.adapterId]!;
    try {
      const output = await adapter.execute(deepFreeze({
        caseInput,
        stepInput: deepFreeze(structuredClone(step.input)),
        priorOutputs: deepFreeze(structuredClone(priorOutputs)),
      }));
      const clonedOutput = deepFreeze(structuredClone(output));
      const outputDigest = sha256(canonicalJson(clonedOutput));
      priorOutputs[step.stepId] = clonedOutput;
      steps.push({ stepId: step.stepId, status: 'passed', outputDigest });
    } catch {
      failureStepRef = step.stepId;
      steps.push({ stepId: step.stepId, status: 'failed', errorCode: 'adapter_failed' });
      break;
    }
  }

  const ok = failureStepRef === undefined;
  const finalOutput = input.plan.steps.length === 0
    ? caseInput
    : priorOutputs[input.plan.steps[Math.max(0, steps.length - 1)]?.stepId ?? ''] ?? null;
  const outputDigest = sha256(canonicalJson(finalOutput));
  const replayDigest = sha256(canonicalJson({
    packageDigest: input.package.packageDigest,
    planDigest: input.plan.planDigest,
    inputDigest,
    outputDigest,
    ok,
    failureStepRef: failureStepRef ?? null,
    steps,
  }));
  const startedAt = input.startedAt ?? new Date().toISOString();
  const endedAt = input.endedAt ?? startedAt;
  const trialCandidate: SkillTrialSystemRecordInput = {
    schema: 'hummer.skill-trial-system-record-input',
    version: 1,
    tenantId: input.tenantId,
    trialId: input.trialId,
    packageId: input.package.packageId,
    packageVersion: input.package.packageVersion,
    packageDigest: input.package.packageDigest,
    recordedBy: 'system:skill-trial',
    mode: input.mode,
    ok,
    ...(failureStepRef ? { failureStepRef } : {}),
    startedAt,
    endedAt,
    environment: structuredClone(input.environment),
    ...(input.receiptRef ? { receiptRef: input.receiptRef } : {}),
    ...(input.mode === 'live' ? { liveApprovalRef: input.approval!.approvalRef } : {}),
  };
  const trialValidation = validateCapabilityContract('SkillTrialSystemRecordInput', trialCandidate);
  if (trialValidation.issues) throw new Error(`SKILL_REPLAY_TRIAL_INVALID:${trialValidation.issues[0]?.message}`);

  return deepFreeze({
    schema: 'hummer.skill-replay-result', version: 1,
    tenantId: input.tenantId,
    packageId: input.package.packageId,
    packageVersion: input.package.packageVersion,
    packageDigest: input.package.packageDigest,
    planDigest: input.plan.planDigest,
    inputDigest, outputDigest, replayDigest, ok,
    ...(failureStepRef ? { failureStepRef } : {}),
    steps,
    trial: trialValidation.value,
  });
}

export function createRegressionSuite(
  capability: CapabilityPackageV1,
  plan: CompiledSkillPlan,
  input: { readonly suiteId: string; readonly cases: readonly SkillRegressionCaseInput[] },
): SkillRegressionSuite {
  assertCapability(capability);
  assertCompiledPlan(capability, plan);
  if (input.suiteId !== capability.regressionSuiteRef || !IDENTIFIER.test(input.suiteId)) {
    throw new Error('SKILL_REGRESSION_SUITE_INVALID:suite_binding');
  }
  if (!Array.isArray(input.cases) || input.cases.length === 0 || input.cases.length > 256) {
    throw new Error('SKILL_REGRESSION_SUITE_INVALID:cases');
  }
  const caseIds = new Set<string>();
  for (const testCase of input.cases) {
    if (!IDENTIFIER.test(testCase.caseId) || caseIds.has(testCase.caseId) || !SHA256.test(testCase.expectedOutputDigest)) {
      throw new Error(`SKILL_REGRESSION_SUITE_INVALID:${testCase.caseId || 'case'}`);
    }
    canonicalJson(testCase.input);
    caseIds.add(testCase.caseId);
  }
  const body = deepFreeze({
    schema: 'hummer.skill-regression-suite' as const,
    version: 1 as const,
    suiteId: input.suiteId,
    packageId: capability.packageId,
    packageVersion: capability.packageVersion,
    packageDigest: capability.packageDigest,
    planDigest: plan.planDigest,
    cases: structuredClone(input.cases),
  });
  return deepFreeze({ ...body, suiteDigest: sha256(canonicalJson(body)) });
}

export async function runRegressionSuite(input: RunRegressionSuiteInput): Promise<SkillRegressionReport> {
  assertCapability(input.package);
  assertCompiledPlan(input.package, input.plan);
  assertRegressionSuite(input.package, input.plan, input.suite);
  const cases: SkillRegressionCaseResult[] = [];
  for (const testCase of input.suite.cases) {
    const replay = await runSkillReplay({
      tenantId: input.package.tenantId,
      trialId: regressionTrialId(input.suite.suiteId, testCase.caseId),
      package: input.package,
      plan: input.plan,
      mode: 'shadow',
      caseInput: testCase.input,
      adapters: input.adapters,
      environment: input.environment,
      startedAt: '1970-01-01T00:00:00.000Z',
      endedAt: '1970-01-01T00:00:00.000Z',
    });
    cases.push({
      caseId: testCase.caseId,
      passed: replay.ok && replay.outputDigest === testCase.expectedOutputDigest,
      expectedOutputDigest: testCase.expectedOutputDigest,
      actualOutputDigest: replay.outputDigest,
      replayDigest: replay.replayDigest,
      ...(replay.failureStepRef ? { failureStepRef: replay.failureStepRef } : {}),
    });
  }
  const body = {
    schema: 'hummer.skill-regression-report' as const,
    version: 1 as const,
    suiteId: input.suite.suiteId,
    suiteDigest: input.suite.suiteDigest,
    packageId: input.package.packageId,
    packageVersion: input.package.packageVersion,
    packageDigest: input.package.packageDigest,
    planDigest: input.plan.planDigest,
    passed: cases.every((item) => item.passed),
    cases,
  };
  return deepFreeze({
    ...body,
    executedAt: input.executedAt ?? new Date().toISOString(),
    evidenceDigest: sha256(canonicalJson(body)),
  });
}

export function assessSkillPromotion(
  capability: CapabilityPackageV1,
  plan: CompiledSkillPlan,
  replays: readonly SkillReplayResult[],
  regression: SkillRegressionReport,
): SkillPromotionDecision {
  const reasons: PromotionDenialReason[] = [];
  try { assertCapability(capability); } catch { reasons.push('invalid_package'); }
  try { assertCompiledPlan(capability, plan); } catch { reasons.push('invalid_plan'); }
  if (reasons.length) return { allowed: false, reasons };

  const validatedTrials: SkillTrialSystemRecordInput[] = [];
  for (const replay of replays) {
    if (!isReplayResultValid(replay, capability, plan)) {
      reasons.push('invalid_replay');
      continue;
    }
    const trial = replay.trial;
    const checked = validateCapabilityContract('SkillTrialSystemRecordInput', trial);
    if (checked.issues) reasons.push('invalid_trial');
    else validatedTrials.push(checked.value);
  }
  if (new Set(validatedTrials.map((trial) => trial.trialId)).size !== validatedTrials.length) {
    reasons.push('duplicate_trial_id');
  }
  if (validatedTrials.some((trial) =>
    trial.tenantId !== capability.tenantId || trial.packageId !== capability.packageId ||
    trial.packageVersion !== capability.packageVersion || trial.packageDigest !== capability.packageDigest
  )) reasons.push('trial_binding_mismatch');
  if (validatedTrials.some((trial) => trial.mode !== 'shadow')) reasons.push('non_shadow_trial');
  if (validatedTrials.length < 5) reasons.push('insufficient_shadow_trials');
  if (validatedTrials.some((trial) => !trial.ok)) reasons.push('shadow_trial_failed');

  if (!isRegressionReportValid(regression)) reasons.push('regression_report_invalid');
  else {
    if (regression.packageId !== capability.packageId || regression.packageVersion !== capability.packageVersion ||
        regression.packageDigest !== capability.packageDigest || regression.planDigest !== plan.planDigest ||
        regression.suiteId !== capability.regressionSuiteRef) {
      reasons.push('regression_binding_mismatch');
    }
    if (!regression.passed) reasons.push('regression_failed');
  }
  const uniqueReasons = [...new Set(reasons)];
  if (uniqueReasons.length) return { allowed: false, reasons: uniqueReasons };

  const trialRecord = createTrialRecordFromSystemTrials(validatedTrials, {
    passed: true,
    evidenceDigest: regression.evidenceDigest,
  });
  return { allowed: true, reasons: ['promotion_gate_passed'], trialRecord };
}

function assertCapability(capability: CapabilityPackageV1): void {
  const checked = validateCapabilityContract('CapabilityPackageV1', capability);
  if (checked.issues) throw new Error(`SKILL_REPLAY_PACKAGE_INVALID:${checked.issues[0]?.message}`);
}

function assertCompiledPlan(capability: CapabilityPackageV1, plan: CompiledSkillPlan): void {
  const { planDigest, ...body } = plan;
  const recompiled = compileSkillPlan(capability, body);
  if (planDigest !== recompiled.planDigest) throw new Error('SKILL_REPLAY_PLAN_INVALID:digest');
}

function assertPackageBinding(
  capability: CapabilityPackageV1,
  binding: { packageId: string; packageVersion: number; packageDigest: string },
  code: string,
): void {
  if (binding.packageId !== capability.packageId || binding.packageVersion !== capability.packageVersion ||
      binding.packageDigest !== capability.packageDigest) throw new Error(code);
}

function assertEnvironment(environment: ReplayEnvironment): void {
  if (!IDENTIFIER.test(environment.nodeId) || !environment.os || !environment.runtime || !environment.runtimeVersion ||
      typeof environment.appVersions !== 'object' || environment.appVersions === null || Array.isArray(environment.appVersions)) {
    throw new Error('SKILL_REPLAY_ENVIRONMENT_INVALID');
  }
  canonicalJson(environment.appVersions);
}

function assertTimes(startedAt?: string, endedAt?: string): void {
  if ((startedAt === undefined) !== (endedAt === undefined)) throw new Error('SKILL_REPLAY_TIME_INVALID');
  if (startedAt !== undefined) {
    if (!Number.isFinite(Date.parse(startedAt)) || !Number.isFinite(Date.parse(endedAt!)) || endedAt! < startedAt) {
      throw new Error('SKILL_REPLAY_TIME_INVALID');
    }
  }
}

function assertLiveApproval(input: RunSkillReplayInput): void {
  const approval = input.approval;
  if (!approval) throw new Error('SKILL_REPLAY_APPROVAL_REQUIRED');
  if (!IDENTIFIER.test(approval.approvalRef) || approval.decision !== 'approved' || !approval.decidedBy.startsWith('human:') ||
      approval.action !== 'capability.live-replay' || approval.tenantId !== input.tenantId ||
      approval.packageDigest !== input.package.packageDigest || approval.planDigest !== input.plan.planDigest) {
    throw new Error('SKILL_REPLAY_APPROVAL_INVALID');
  }
}

function assertRegressionSuite(
  capability: CapabilityPackageV1,
  plan: CompiledSkillPlan,
  suite: SkillRegressionSuite,
): void {
  const { suiteDigest, ...body } = suite;
  if (suiteDigest !== sha256(canonicalJson(body))) throw new Error('SKILL_REGRESSION_SUITE_INVALID:digest');
  if (suite.suiteId !== capability.regressionSuiteRef || suite.packageId !== capability.packageId ||
      suite.packageVersion !== capability.packageVersion || suite.packageDigest !== capability.packageDigest ||
      suite.planDigest !== plan.planDigest || suite.cases.length === 0) {
    throw new Error('SKILL_REGRESSION_SUITE_INVALID:binding');
  }
}

function isRegressionReportValid(report: SkillRegressionReport): boolean {
  if (report.schema !== 'hummer.skill-regression-report' || report.version !== 1 || report.cases.length === 0) return false;
  const { evidenceDigest, executedAt: _executedAt, ...body } = report;
  return evidenceDigest === sha256(canonicalJson(body)) && report.passed === report.cases.every((item) => item.passed);
}

function isReplayResultValid(
  replay: SkillReplayResult,
  capability: CapabilityPackageV1,
  plan: CompiledSkillPlan,
): boolean {
  if (replay.schema !== 'hummer.skill-replay-result' || replay.version !== 1 ||
      replay.tenantId !== capability.tenantId || replay.packageId !== capability.packageId ||
      replay.packageVersion !== capability.packageVersion || replay.packageDigest !== capability.packageDigest ||
      replay.planDigest !== plan.planDigest || !SHA256.test(replay.inputDigest) || !SHA256.test(replay.outputDigest)) return false;
  if (replay.ok !== replay.steps.every((step) => step.status === 'passed')) return false;
  if (replay.failureStepRef !== replay.steps.find((step) => step.status === 'failed')?.stepId) return false;
  if (replay.trial.ok !== replay.ok || replay.trial.failureStepRef !== replay.failureStepRef) return false;
  const expectedDigest = sha256(canonicalJson({
    packageDigest: replay.packageDigest,
    planDigest: replay.planDigest,
    inputDigest: replay.inputDigest,
    outputDigest: replay.outputDigest,
    ok: replay.ok,
    failureStepRef: replay.failureStepRef ?? null,
    steps: replay.steps,
  }));
  return replay.replayDigest === expectedDigest;
}

function regressionTrialId(suiteId: string, caseId: string): string {
  return `reg-${sha256(`${suiteId}\0${caseId}`).slice(0, 24)}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(normalizeJson(value));
}

function normalizeJson(value: unknown): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('SKILL_REPLAY_JSON_INVALID:number');
    return value;
  }
  if (Array.isArray(value)) return value.map(normalizeJson);
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error('SKILL_REPLAY_JSON_INVALID:object');
    const result: Record<string, JsonValue> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item === undefined) throw new Error('SKILL_REPLAY_JSON_INVALID:undefined');
      result[key] = normalizeJson(item);
    }
    return result;
  }
  throw new Error(`SKILL_REPLAY_JSON_INVALID:${typeof value}`);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}
