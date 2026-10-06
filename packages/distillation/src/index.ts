import { createHash } from 'node:crypto';
import {
  computeCapabilityPackageDigest,
  validateCapabilityContract,
  validatePrivacyContract,
  type CapabilityPackageAuthorInput,
  type CapabilityPackageV1,
  type DemoSessionV1,
} from '@hummer/contracts';

export type CapabilityTrack = CapabilityPackageV1['capabilityTrack'];
export type BoundedBehaviorTrack = CapabilityPackageV1['behaviorTrack'];

export interface SyntheticDemoRecord {
  schema: 'hummer.synthetic-demo-record';
  version: 1;
  synthetic: true;
  recordId: string;
  tenantId: string;
  sessionId: string;
  segmentId: string;
  occurredAt: string;
  app: string;
  window: string;
  evidenceRef: string;
  action: {
    kind: 'observe' | 'click' | 'key' | 'scroll';
    description: string;
    targetHint?: string;
  };
  judgment?: {
    needsHuman: true;
    scene: string;
    reason: string;
  };
}

export interface GroundingRequest {
  session: DemoSessionV1;
  record: SyntheticDemoRecord;
}

export type GroundingDecision =
  | {
      status: 'grounded';
      element: { stableId: string; role: string; label?: string };
      matchedBy: 'accessibility-id' | 'semantic-role-label' | 'visual-model';
      sourceRecordId: string;
      evidenceRef: string;
      candidateCount: 1;
      confidence: number;
    }
  | { status: 'needs-human'; reason: string }
  | { status: 'failed'; reason: string };

export interface GuiGroundingAdapter {
  readonly id: string;
  ground(request: GroundingRequest): Promise<GroundingDecision>;
}

export interface DistillationSpec {
  packageId: string;
  title: string;
  goal: string;
  runtimeProfile: string;
  toolIds: string[];
  requiredCapabilities: string[];
  acceptanceCriteria: string[];
  includePaths: string[];
  excludePaths: string[];
  device: string;
  runtime: string;
  runtimeVersion: string;
  agentVersion: string;
  declaredPermissions: CapabilityPackageV1['declaredPermissions'];
  regressionSuiteRef: string;
  receiptRef: string;
  groundingMinConfidence?: number;
}

export interface DistillationSource {
  demoSessionId: string;
  segmentId: string;
  recordId: string;
  evidenceRef: string;
  app: string;
  window: string;
}

export interface JudgmentAnnotation {
  annotationId: string;
  sourceRecordId: string;
  scene: string;
  reason: string;
  disposition: 'needs-human';
}

export interface GroundedAction {
  stepRef: string;
  sourceRecordId: string;
  action: SyntheticDemoRecord['action']['kind'];
  description: string;
  element: {
    stableId: string;
    role: string;
    label?: string;
  };
  grounding: {
    adapterId: string;
    matchedBy: 'accessibility-id' | 'semantic-role-label' | 'visual-model';
    confidence: number;
    evidenceRef: string;
  };
  judgmentAnnotationRef?: string;
}

export interface ReviewableCapabilityDraft {
  schema: 'hummer.distillation-draft';
  version: 1;
  draftId: string;
  generatedFrom: 'synthetic-structured-records-only';
  reviewStatus: 'needs-human-review';
  generatedAt: string;
  package: CapabilityPackageAuthorInput;
  packageDigest: string;
  capabilityTrack: CapabilityTrack;
  boundedBehaviorTrack: BoundedBehaviorTrack;
  sources: DistillationSource[];
  judgmentAnnotations: JudgmentAnnotation[];
  groundedActions: GroundedAction[];
}

export interface GroundingFailure {
  recordId: string;
  code:
    | 'adapter-error'
    | 'adapter-failed'
    | 'adapter-needs-human'
    | 'ambiguous-candidates'
    | 'low-confidence'
    | 'unbound-grounding-evidence'
    | 'invalid-adapter-result';
  reason: string;
}

export type DistillationResult =
  | { ok: true; draft: ReviewableCapabilityDraft }
  | { ok: false; status: 'needs-human'; failures: GroundingFailure[] };

export type CapabilityCorrectionChange =
  | {
      kind: 'replace-capability-item';
      field: keyof CapabilityTrack;
      index: number;
      wrong: string;
      correct: string;
    }
  | {
      kind: 'append-behavior-correction';
      scene: string;
      wrong: string;
      correct: string;
    };

export interface CapabilityCorrectionProposal {
  schema: 'hummer.distillation-correction';
  version: 1;
  proposalId: string;
  tenantId: string;
  packageId: string;
  basePackageVersion: number;
  basePackageDigest: string;
  requestedByActorRef: string;
  requestedAt: string;
  change: CapabilityCorrectionChange;
  proposalDigest: string;
}

export interface DraftAuditEntry {
  auditId: string;
  action: 'created' | 'correction-applied' | 'rollback-applied';
  actorRef: string;
  at: string;
  fromVersion?: number;
  toVersion: number;
  targetVersion?: number;
  proposalDigest?: string;
  fromDigest?: string;
  toDigest: string;
}

export interface DraftRevisionHistory {
  schema: 'hummer.distillation-history';
  version: 1;
  tenantId: string;
  packageId: string;
  revisions: ReviewableCapabilityDraft[];
  audit: DraftAuditEntry[];
}

const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const isoUtc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const sha256Pattern = /^[a-f0-9]{64}$/;

/**
 * Compiles strict, explicitly synthetic records into a reviewable author draft.
 * No draft is emitted when any element cannot be grounded to exactly one source.
 */
export async function distillSyntheticDemo(input: {
  session: unknown;
  records: readonly unknown[];
  adapter: GuiGroundingAdapter;
  spec: DistillationSpec;
  generatedAt: string;
}): Promise<DistillationResult> {
  const sessionValidation = validatePrivacyContract('DemoSessionV1', input.session);
  if (sessionValidation.issues) throw new TypeError(`invalid DemoSession: ${sessionValidation.issues[0]?.message}`);
  const session = sessionValidation.value;
  if (session.status !== 'ended') throw new Error('DemoSession must be ended before distillation');
  if (session.localOnly !== true) throw new Error('DemoSession must remain local-only');
  if (!isoUtc.test(input.generatedAt)) throw new TypeError('generatedAt must be an ISO UTC timestamp');
  validateSpec(input.spec);
  if (!input.adapter || typeof input.adapter.id !== 'string' || !input.adapter.id.trim() || typeof input.adapter.ground !== 'function') {
    throw new TypeError('A replaceable GuiGroundingAdapter is required');
  }

  const records = input.records.map(validateSyntheticRecord);
  if (records.length === 0) throw new Error('At least one synthetic source record is required');
  validateRecordSet(session, records);
  const annotations = records.flatMap((record) => record.judgment ? [{
    annotationId: `judge_${shortDigest({ recordId: record.recordId, judgment: record.judgment })}`,
    sourceRecordId: record.recordId,
    scene: record.judgment.scene,
    reason: record.judgment.reason,
    disposition: 'needs-human' as const,
  }] : []);
  if (annotations.length === 0) throw new Error('At least one needs-human judgment annotation is required');

  const failures: GroundingFailure[] = [];
  const groundedActions: GroundedAction[] = [];
  const minConfidence = input.spec.groundingMinConfidence ?? 0.9;
  for (const [index, record] of records.entries()) {
    let decision: GroundingDecision;
    try {
      decision = await input.adapter.ground({ session: structuredClone(session), record: structuredClone(record) });
    } catch (error) {
      failures.push({ recordId: record.recordId, code: 'adapter-error', reason: safeError(error) });
      continue;
    }
    const checked = validateGroundingDecision(decision, record, minConfidence);
    if (!checked.ok) {
      failures.push({ recordId: record.recordId, code: checked.code, reason: checked.reason });
      continue;
    }
    const annotation = annotations.find((item) => item.sourceRecordId === record.recordId);
    groundedActions.push({
      stepRef: `step_${String(index + 1).padStart(3, '0')}`,
      sourceRecordId: record.recordId,
      action: record.action.kind,
      description: record.action.description,
      element: structuredClone(checked.decision.element),
      grounding: {
        adapterId: input.adapter.id,
        matchedBy: checked.decision.matchedBy,
        confidence: checked.decision.confidence,
        evidenceRef: checked.decision.evidenceRef,
      },
      ...(annotation ? { judgmentAnnotationRef: annotation.annotationId } : {}),
    });
  }
  if (failures.length > 0) return { ok: false, status: 'needs-human', failures };

  const sources = records.map((record): DistillationSource => ({
    demoSessionId: session.sessionId,
    segmentId: record.segmentId,
    recordId: record.recordId,
    evidenceRef: record.evidenceRef,
    app: record.app,
    window: record.window,
  }));
  const packageInput: CapabilityPackageAuthorInput = {
    schema: 'hummer.capability-package-author-input',
    version: 1,
    tenantId: session.tenantId,
    packageId: input.spec.packageId,
    packageVersion: 1,
    title: input.spec.title,
    goal: input.spec.goal,
    preset: 'expert-work',
    capabilityTrack: {
      responsibilities: [input.spec.goal],
      workflows: groundedActions.map((action) => `${action.stepRef}: ${action.description} [element:${action.element.stableId}]${action.judgmentAnnotationRef ? ` [needs-human:${action.judgmentAnnotationRef}]` : ''}`),
      standards: [
        ...input.spec.acceptanceCriteria,
        'Grounding must resolve to exactly one evidence-bound element; otherwise stop for human review.',
      ],
      heuristics: annotations.map((annotation) => `At ${annotation.scene}, stop for human judgment: ${annotation.reason}`),
      pitfalls: [
        'Never guess an element when grounding is missing, ambiguous, or below the configured confidence threshold.',
        ...session.sourceBoundary.excluded.map((item) => `Never use excluded source: ${item}`),
      ],
      examples: [],
    },
    behaviorTrack: {
      expressionPreferences: ['State observed evidence and uncertainty without claiming expert equivalence.'],
      interactionRules: annotations.map((annotation) => `Ask a human before proceeding in ${annotation.scene}: ${annotation.reason}`),
      corrections: [],
    },
    runtimeProfile: input.spec.runtimeProfile,
    toolIds: [...input.spec.toolIds],
    requiredCapabilities: [...input.spec.requiredCapabilities],
    acceptanceCriteria: [...input.spec.acceptanceCriteria],
    sourceBoundary: {
      apps: [...session.sourceBoundary.apps],
      windows: [...session.sourceBoundary.windows],
      includePaths: [...input.spec.includePaths],
      excludePaths: [...input.spec.excludePaths],
    },
    provenance: {
      demoSessionIds: [session.sessionId],
      expertActorRef: session.expertActorRef,
      nodeId: session.nodeId,
      device: input.spec.device,
      runtime: input.spec.runtime,
      runtimeVersion: input.spec.runtimeVersion,
      agentVersion: input.spec.agentVersion,
      capturedAt: session.endedAt!,
    },
    evidenceRefs: [...new Set(sources.map((source) => source.evidenceRef))],
    failureNotes: ['This draft was produced from synthetic structured records only and still requires human review.'],
    declaredPermissions: structuredClone(input.spec.declaredPermissions),
    regressionSuiteRef: input.spec.regressionSuiteRef,
    receiptRef: input.spec.receiptRef,
    status: 'draft',
    deletionAudit: {},
  };
  assertAuthorPackage(packageInput);
  const packageDigest = computeCapabilityPackageDigest(packageInput);
  return {
    ok: true,
    draft: {
      schema: 'hummer.distillation-draft',
      version: 1,
      draftId: `draft_${shortDigest({ packageDigest, sessionId: session.sessionId })}`,
      generatedFrom: 'synthetic-structured-records-only',
      reviewStatus: 'needs-human-review',
      generatedAt: input.generatedAt,
      package: packageInput,
      packageDigest,
      capabilityTrack: structuredClone(packageInput.capabilityTrack),
      boundedBehaviorTrack: structuredClone(packageInput.behaviorTrack),
      sources,
      judgmentAnnotations: annotations,
      groundedActions,
    },
  };
}

/** Parses only two explicit correction grammars; any other prose is rejected. */
export function proposeNaturalLanguageCorrection(
  draft: ReviewableCapabilityDraft,
  instruction: string,
  requestedByActorRef: string,
  requestedAt: string,
): CapabilityCorrectionProposal {
  validateDraft(draft);
  requireHuman(requestedByActorRef);
  if (!isoUtc.test(requestedAt)) throw new TypeError('requestedAt must be an ISO UTC timestamp');
  const normalized = instruction.trim();
  if (!normalized) throw new TypeError('Correction instruction is required');

  let change: CapabilityCorrectionChange | undefined;
  const replace = normalized.match(/^replace\s+(responsibility|workflow|standard|heuristic|pitfall|example)\s+"([^"]+)"\s+with\s+"([^"]+)"$/i)
    ?? normalized.match(/^将(职责|流程|标准|启发式|陷阱|示例)[“"]([^”"]+)[”"]改为[“"]([^”"]+)[”"]$/u);
  if (replace) {
    const field = capabilityField(replace[1]!);
    const wrong = replace[2]!.trim();
    const correct = replace[3]!.trim();
    const index = draft.package.capabilityTrack[field].indexOf(wrong);
    if (index < 0) throw new Error('Correction target does not exist in the current capability track');
    change = { kind: 'replace-capability-item', field, index, wrong, correct };
  }
  const behavior = normalized.match(/^when\s+"([^"]+)",\s*replace\s+"([^"]+)"\s+with\s+"([^"]+)"$/i)
    ?? normalized.match(/^在[“"]([^”"]+)[”"]场景[，,]\s*将[“"]([^”"]+)[”"]改为[“"]([^”"]+)[”"]$/u);
  if (!change && behavior) {
    change = {
      kind: 'append-behavior-correction',
      scene: behavior[1]!.trim(),
      wrong: behavior[2]!.trim(),
      correct: behavior[3]!.trim(),
    };
  }
  if (!change) throw new Error('Correction instruction is outside the bounded grammar');
  for (const value of Object.values(change)) {
    if (typeof value === 'string' && (value.length === 0 || value.length > 32_768)) {
      throw new TypeError('Correction values must be non-empty and bounded');
    }
  }
  const base = {
    schema: 'hummer.distillation-correction' as const,
    version: 1 as const,
    tenantId: draft.package.tenantId,
    packageId: draft.package.packageId,
    basePackageVersion: draft.package.packageVersion,
    basePackageDigest: draft.packageDigest,
    requestedByActorRef,
    requestedAt,
    change,
  };
  const proposalId = `corr_${shortDigest(base)}`;
  const proposalWithoutDigest = { ...base, proposalId };
  return { ...proposalWithoutDigest, proposalDigest: digest(proposalWithoutDigest) };
}

export function createDraftRevisionHistory(
  draft: ReviewableCapabilityDraft,
  actorRef: string,
  at: string,
): DraftRevisionHistory {
  validateDraft(draft);
  requireHuman(actorRef);
  if (!isoUtc.test(at)) throw new TypeError('Audit timestamp must be an ISO UTC timestamp');
  return {
    schema: 'hummer.distillation-history',
    version: 1,
    tenantId: draft.package.tenantId,
    packageId: draft.package.packageId,
    revisions: [structuredClone(draft)],
    audit: [{
      auditId: `audit_${shortDigest({ action: 'created', actorRef, at, digest: draft.packageDigest })}`,
      action: 'created',
      actorRef,
      at,
      toVersion: draft.package.packageVersion,
      toDigest: draft.packageDigest,
    }],
  };
}

export function applyCorrection(
  history: DraftRevisionHistory,
  proposal: CapabilityCorrectionProposal,
): DraftRevisionHistory {
  const current = validateHistory(history);
  requireHuman(proposal.requestedByActorRef);
  validateProposal(proposal);
  if (proposal.tenantId !== history.tenantId || proposal.packageId !== history.packageId ||
      proposal.tenantId !== current.package.tenantId || proposal.packageId !== current.package.packageId) {
    throw new Error('Correction proposal is bound to a different tenant or package');
  }
  if (proposal.basePackageVersion !== current.package.packageVersion || proposal.basePackageDigest !== current.packageDigest) {
    throw new Error('Correction proposal is stale or bound to another package revision');
  }

  const nextPackage = structuredClone(current.package);
  nextPackage.packageVersion += 1;
  nextPackage.supersedesVersion = current.package.packageVersion;
  nextPackage.previousPackageDigest = current.packageDigest;
  nextPackage.status = 'draft';
  if (proposal.change.kind === 'replace-capability-item') {
    const list = nextPackage.capabilityTrack[proposal.change.field];
    if (list[proposal.change.index] !== proposal.change.wrong) {
      throw new Error('Correction target no longer matches the current package');
    }
    list[proposal.change.index] = proposal.change.correct;
  } else {
    nextPackage.behaviorTrack.corrections.push({
      scene: proposal.change.scene,
      wrong: proposal.change.wrong,
      correct: proposal.change.correct,
    });
  }
  assertAuthorPackage(nextPackage);
  return appendRevision(history, current, nextPackage, {
    action: 'correction-applied',
    actorRef: proposal.requestedByActorRef,
    at: proposal.requestedAt,
    proposalDigest: proposal.proposalDigest,
  });
}

/** Rollback is append-only: it creates a new version containing an older version's reviewable content. */
export function rollbackDraft(
  history: DraftRevisionHistory,
  targetVersion: number,
  actorRef: string,
  at: string,
): DraftRevisionHistory {
  const current = validateHistory(history);
  requireHuman(actorRef);
  if (!isoUtc.test(at)) throw new TypeError('Rollback timestamp must be an ISO UTC timestamp');
  if (!Number.isSafeInteger(targetVersion) || targetVersion < 1 || targetVersion >= current.package.packageVersion) {
    throw new Error('Rollback target must be an existing earlier package version');
  }
  const target = history.revisions.find((revision) => revision.package.packageVersion === targetVersion);
  if (!target) throw new Error('Rollback target revision does not exist');
  if (target.package.packageId !== history.packageId || target.package.tenantId !== history.tenantId) {
    throw new Error('Rollback target is bound to a different tenant or package');
  }
  const nextPackage = structuredClone(target.package);
  nextPackage.packageVersion = current.package.packageVersion + 1;
  nextPackage.supersedesVersion = current.package.packageVersion;
  nextPackage.previousPackageDigest = current.packageDigest;
  nextPackage.status = 'draft';
  assertAuthorPackage(nextPackage);
  return appendRevision(history, current, nextPackage, {
    action: 'rollback-applied',
    actorRef,
    at,
    targetVersion,
  }, target);
}

function appendRevision(
  history: DraftRevisionHistory,
  current: ReviewableCapabilityDraft,
  nextPackage: CapabilityPackageAuthorInput,
  action: Omit<DraftAuditEntry, 'auditId' | 'fromVersion' | 'toVersion' | 'fromDigest' | 'toDigest'>,
  sourceDraft: ReviewableCapabilityDraft = current,
): DraftRevisionHistory {
  const packageDigest = computeCapabilityPackageDigest(nextPackage);
  const next: ReviewableCapabilityDraft = {
    ...structuredClone(sourceDraft),
    generatedAt: action.at,
    package: nextPackage,
    packageDigest,
    capabilityTrack: structuredClone(nextPackage.capabilityTrack),
    boundedBehaviorTrack: structuredClone(nextPackage.behaviorTrack),
  };
  const auditBase = {
    ...action,
    fromVersion: current.package.packageVersion,
    toVersion: nextPackage.packageVersion,
    fromDigest: current.packageDigest,
    toDigest: packageDigest,
  };
  const auditEntry: DraftAuditEntry = {
    auditId: `audit_${shortDigest(auditBase)}`,
    ...auditBase,
  };
  return {
    ...structuredClone(history),
    revisions: [...history.revisions.map((revision) => structuredClone(revision)), next],
    audit: [...history.audit.map((entry) => structuredClone(entry)), auditEntry],
  };
}

function validateRecordSet(session: DemoSessionV1, records: SyntheticDemoRecord[]): void {
  const activeSegments = new Map(session.segments.filter((segment) => !segment.deletedAt).map((segment) => [segment.segId, segment]));
  const evidence = new Set(session.evidenceRefs);
  const ids = new Set<string>();
  const bySegment = new Map<string, number>();
  for (const record of records) {
    if (ids.has(record.recordId)) throw new Error('Synthetic source record ids must be unique');
    ids.add(record.recordId);
    if (record.tenantId !== session.tenantId || record.sessionId !== session.sessionId) {
      throw new Error('Synthetic source record is bound to a different tenant or session');
    }
    if (!activeSegments.has(record.segmentId)) throw new Error('Synthetic source record references a missing or deleted segment');
    if (!session.sourceBoundary.apps.includes(record.app) || !session.sourceBoundary.windows.includes(record.window) ||
        session.sourceBoundary.excluded.includes(record.app) || session.sourceBoundary.excluded.includes(record.window) ||
        session.sourceBoundary.excluded.includes(`${record.app}::${record.window}`)) {
      throw new Error('Synthetic source record is outside the DemoSession source boundary');
    }
    if (!evidence.has(record.evidenceRef)) throw new Error('Synthetic source record has no bound DemoSession evidence source');
    bySegment.set(record.segmentId, (bySegment.get(record.segmentId) ?? 0) + 1);
  }
  for (const [segmentId, segment] of activeSegments) {
    if ((bySegment.get(segmentId) ?? 0) !== segment.recordCount) {
      throw new Error('Synthetic source records do not account for every active segment record');
    }
  }
}

function validateSyntheticRecord(value: unknown): SyntheticDemoRecord {
  if (!isRecord(value)) throw new TypeError('Synthetic source record must be an object');
  exactKeys(value, ['schema', 'version', 'synthetic', 'recordId', 'tenantId', 'sessionId', 'segmentId', 'occurredAt', 'app', 'window', 'evidenceRef', 'action', 'judgment']);
  if (value.schema !== 'hummer.synthetic-demo-record' || value.version !== 1 || value.synthetic !== true) {
    throw new TypeError('Only strict, explicitly synthetic demo records are accepted');
  }
  for (const field of ['recordId', 'tenantId', 'sessionId', 'segmentId', 'evidenceRef'] as const) requireIdentifier(value[field], field);
  for (const field of ['app', 'window'] as const) requireText(value[field], field);
  if (typeof value.occurredAt !== 'string' || !isoUtc.test(value.occurredAt)) throw new TypeError('occurredAt must be an ISO UTC timestamp');
  if (!isRecord(value.action)) throw new TypeError('Synthetic source action is required');
  exactKeys(value.action, ['kind', 'description', 'targetHint']);
  if (!['observe', 'click', 'key', 'scroll'].includes(String(value.action.kind))) throw new TypeError('Synthetic source action kind is unsupported');
  requireText(value.action.description, 'action.description');
  if (value.action.targetHint !== undefined) requireText(value.action.targetHint, 'action.targetHint');
  if (value.judgment !== undefined) {
    if (!isRecord(value.judgment)) throw new TypeError('judgment must be an object');
    exactKeys(value.judgment, ['needsHuman', 'scene', 'reason']);
    if (value.judgment.needsHuman !== true) throw new TypeError('judgment.needsHuman must be true');
    requireText(value.judgment.scene, 'judgment.scene');
    requireText(value.judgment.reason, 'judgment.reason');
  }
  return structuredClone(value) as unknown as SyntheticDemoRecord;
}

function validateGroundingDecision(
  value: unknown,
  record: SyntheticDemoRecord,
  minConfidence: number,
): { ok: true; decision: Extract<GroundingDecision, { status: 'grounded' }> } | { ok: false; code: GroundingFailure['code']; reason: string } {
  if (!isRecord(value) || typeof value.status !== 'string') return { ok: false, code: 'invalid-adapter-result', reason: 'Grounding adapter returned an invalid result' };
  if (value.status === 'failed' || value.status === 'needs-human') {
    try {
      exactKeys(value, ['status', 'reason']);
      requireText(value.reason, 'grounding reason');
    } catch (error) {
      return { ok: false, code: 'invalid-adapter-result', reason: safeError(error) };
    }
    return {
      ok: false,
      code: value.status === 'failed' ? 'adapter-failed' : 'adapter-needs-human',
      reason: String(value.reason),
    };
  }
  if (value.status !== 'grounded') return { ok: false, code: 'invalid-adapter-result', reason: 'Grounding adapter returned an unknown status' };
  try {
    exactKeys(value, ['status', 'element', 'matchedBy', 'sourceRecordId', 'evidenceRef', 'candidateCount', 'confidence']);
    if (!isRecord(value.element)) throw new TypeError('Grounded element is required');
    exactKeys(value.element, ['stableId', 'role', 'label']);
    requireText(value.element.stableId, 'element.stableId');
    requireText(value.element.role, 'element.role');
    if (value.element.label !== undefined) requireText(value.element.label, 'element.label');
    if (!['accessibility-id', 'semantic-role-label', 'visual-model'].includes(String(value.matchedBy))) throw new TypeError('matchedBy is unsupported');
    if (typeof value.confidence !== 'number' || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) throw new TypeError('confidence must be from zero to one');
  } catch (error) {
    return { ok: false, code: 'invalid-adapter-result', reason: safeError(error) };
  }
  if (value.candidateCount !== 1) return { ok: false, code: 'ambiguous-candidates', reason: 'Grounding must resolve to exactly one candidate' };
  if (value.sourceRecordId !== record.recordId || value.evidenceRef !== record.evidenceRef) {
    return { ok: false, code: 'unbound-grounding-evidence', reason: 'Grounding evidence is not bound to the source record' };
  }
  if ((value.confidence as number) < minConfidence) return { ok: false, code: 'low-confidence', reason: 'Grounding confidence is below the configured threshold' };
  return { ok: true, decision: structuredClone(value) as unknown as Extract<GroundingDecision, { status: 'grounded' }> };
}

function validateSpec(spec: DistillationSpec): void {
  if (!isRecord(spec)) throw new TypeError('Distillation spec is required');
  exactKeys(spec as unknown as Record<string, unknown>, ['packageId', 'title', 'goal', 'runtimeProfile', 'toolIds', 'requiredCapabilities', 'acceptanceCriteria', 'includePaths', 'excludePaths', 'device', 'runtime', 'runtimeVersion', 'agentVersion', 'declaredPermissions', 'regressionSuiteRef', 'receiptRef', 'groundingMinConfidence']);
  for (const field of ['packageId', 'runtimeProfile', 'regressionSuiteRef', 'receiptRef'] as const) requireIdentifier(spec[field], field);
  for (const field of ['title', 'goal', 'device', 'runtime', 'runtimeVersion', 'agentVersion'] as const) requireText(spec[field], field);
  for (const field of ['toolIds', 'requiredCapabilities', 'acceptanceCriteria', 'includePaths', 'excludePaths', 'declaredPermissions'] as const) {
    if (!Array.isArray(spec[field])) throw new TypeError(`${field} must be an array`);
  }
  if (spec.acceptanceCriteria.length === 0) throw new TypeError('At least one acceptance criterion is required');
  if (spec.groundingMinConfidence !== undefined &&
      (typeof spec.groundingMinConfidence !== 'number' || spec.groundingMinConfidence < 0.5 || spec.groundingMinConfidence > 1)) {
    throw new TypeError('groundingMinConfidence must be from 0.5 to 1');
  }
}

function validateDraft(draft: ReviewableCapabilityDraft): void {
  if (!draft || draft.schema !== 'hummer.distillation-draft' || draft.version !== 1 ||
      draft.generatedFrom !== 'synthetic-structured-records-only' || draft.reviewStatus !== 'needs-human-review') {
    throw new TypeError('Invalid reviewable capability draft');
  }
  assertAuthorPackage(draft.package);
  if (draft.packageDigest !== computeCapabilityPackageDigest(draft.package)) throw new Error('Draft package digest is invalid');
  if (canonicalJson(draft.capabilityTrack) !== canonicalJson(draft.package.capabilityTrack) ||
      canonicalJson(draft.boundedBehaviorTrack) !== canonicalJson(draft.package.behaviorTrack)) {
    throw new Error('Draft tracks do not match the package author contract');
  }
  if (draft.sources.length === 0) throw new Error('Draft source list must not be empty');
  if (draft.judgmentAnnotations.length === 0) throw new Error('Draft requires at least one needs-human judgment annotation');
}

function validateHistory(history: DraftRevisionHistory): ReviewableCapabilityDraft {
  if (!history || history.schema !== 'hummer.distillation-history' || history.version !== 1 || history.revisions.length === 0) {
    throw new TypeError('Invalid distillation revision history');
  }
  for (const [index, revision] of history.revisions.entries()) {
    validateDraft(revision);
    if (revision.package.tenantId !== history.tenantId || revision.package.packageId !== history.packageId ||
        revision.package.packageVersion !== index + 1) throw new Error('Distillation revision history identity or versions are invalid');
    if (index > 0 && (revision.package.supersedesVersion !== index ||
        revision.package.previousPackageDigest !== history.revisions[index - 1]!.packageDigest)) {
      throw new Error('Distillation revision digest chain is invalid');
    }
  }
  if (history.audit.length !== history.revisions.length) throw new Error('Every distillation revision requires one audit entry');
  return history.revisions.at(-1)!;
}

function validateProposal(proposal: CapabilityCorrectionProposal): void {
  if (!proposal || proposal.schema !== 'hummer.distillation-correction' || proposal.version !== 1) throw new TypeError('Invalid correction proposal');
  exactKeys(proposal as unknown as Record<string, unknown>, [
    'schema', 'version', 'proposalId', 'tenantId', 'packageId', 'basePackageVersion',
    'basePackageDigest', 'requestedByActorRef', 'requestedAt', 'change', 'proposalDigest',
  ]);
  requireIdentifier(proposal.tenantId, 'proposal tenantId');
  requireIdentifier(proposal.packageId, 'proposal packageId');
  requireHuman(proposal.requestedByActorRef);
  if (!isoUtc.test(proposal.requestedAt)) throw new TypeError('Proposal timestamp must be an ISO UTC timestamp');
  if (!Number.isSafeInteger(proposal.basePackageVersion) || proposal.basePackageVersion < 1) throw new TypeError('Proposal base version is invalid');
  if (!sha256Pattern.test(proposal.basePackageDigest) || !sha256Pattern.test(proposal.proposalDigest)) throw new TypeError('Correction proposal digest is invalid');
  if (!isRecord(proposal.change)) throw new TypeError('Correction proposal change is invalid');
  if (proposal.change.kind === 'replace-capability-item') {
    exactKeys(proposal.change, ['kind', 'field', 'index', 'wrong', 'correct']);
    if (!['responsibilities', 'workflows', 'standards', 'heuristics', 'pitfalls', 'examples'].includes(String(proposal.change.field)) ||
        !Number.isSafeInteger(proposal.change.index) || proposal.change.index < 0) throw new TypeError('Capability correction target is invalid');
    requireText(proposal.change.wrong, 'proposal change wrong');
    requireText(proposal.change.correct, 'proposal change correct');
  } else if (proposal.change.kind === 'append-behavior-correction') {
    exactKeys(proposal.change, ['kind', 'scene', 'wrong', 'correct']);
    requireText(proposal.change.scene, 'proposal change scene');
    requireText(proposal.change.wrong, 'proposal change wrong');
    requireText(proposal.change.correct, 'proposal change correct');
  } else {
    throw new TypeError('Correction proposal change kind is invalid');
  }
  const { proposalDigest, ...unsigned } = proposal;
  if (proposalDigest !== digest(unsigned)) throw new Error('Correction proposal was altered after it was created');
  const { proposalId: _proposalId, ...base } = unsigned;
  if (proposal.proposalId !== `corr_${shortDigest(base)}`) throw new Error('Correction proposal identifier is not bound to its request');
}

function assertAuthorPackage(value: CapabilityPackageAuthorInput): void {
  const validation = validateCapabilityContract('CapabilityPackageAuthorInput', value);
  if (validation.issues) throw new TypeError(`invalid capability author draft: ${validation.issues[0]?.message}`);
}

function capabilityField(value: string): keyof CapabilityTrack {
  const fields: Record<string, keyof CapabilityTrack> = {
    responsibility: 'responsibilities', 职责: 'responsibilities',
    workflow: 'workflows', 流程: 'workflows',
    standard: 'standards', 标准: 'standards',
    heuristic: 'heuristics', 启发式: 'heuristics',
    pitfall: 'pitfalls', 陷阱: 'pitfalls',
    example: 'examples', 示例: 'examples',
  };
  const field = fields[value.toLowerCase()] ?? fields[value];
  if (!field) throw new TypeError('Unsupported capability correction field');
  return field;
}

function requireHuman(actorRef: string): void {
  if (!/^human:[A-Za-z0-9_-]+$/.test(actorRef)) throw new TypeError('Only a human actor may correct or roll back a distilled draft');
}

function requireIdentifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !identifier.test(value)) throw new TypeError(`${label} must be a valid identifier`);
}

function requireText(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > 32_768) throw new TypeError(`${label} must be non-empty bounded text`);
}

function exactKeys(value: Record<string, unknown>, allowed: string[]): void {
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length > 0) throw new TypeError(`Unsupported fields: ${extras.join(', ')}`);
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : 'Grounding adapter failed without a safe reason';
}

function shortDigest(value: unknown): string {
  return digest(value).slice(0, 24);
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
