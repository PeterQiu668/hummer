import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import {
  assessCapabilityInstallGate,
  CapabilityContractSchemas,
  CapabilityInstallGateDecisionStandardSchema,
  CapabilityInstallGateInputStandardSchema,
  CapabilityPackageAuthorInputStandardSchema,
  CapabilityPackageV1StandardSchema,
  createCapabilityInstallGateDecision,
  createTrialRecordFromSystemTrials,
  evaluateCapabilityVersionAppend,
  SkillTrialSystemRecordInputStandardSchema,
  TeamReadOnlyShareStandardSchema,
  validateCapabilityContract,
  type CapabilityContractName,
  type CapabilityInstallGateInput,
  type CapabilityPackageAuthorInput,
  type CapabilityPackageV1,
  type SkillTrialSystemRecordInput,
  type TeamReadOnlyShare,
} from '../index.ts';

const at = '2026-10-07T01:00:00Z';
const digest = 'a'.repeat(64);

function authorInput(version = 1): CapabilityPackageAuthorInput {
  return {
    schema: 'hummer.capability-package-author-input',
    version: 1,
    tenantId: 'tenant-a',
    packageId: 'cap-research',
    packageVersion: version,
    ...(version > 1 ? { supersedesVersion: version - 1 } : {}),
    title: 'Research synthesis',
    goal: 'Produce an evidence-grounded synthesis.',
    preset: 'expert-work',
    capabilityTrack: {
      responsibilities: ['Research'],
      workflows: ['Collect then synthesize'],
      standards: ['Cite evidence'],
      heuristics: ['Prefer primary sources'],
      pitfalls: ['Do not invent evidence'],
      examples: ['A linked report'],
    },
    behaviorTrack: {
      expressionPreferences: ['Be concise'],
      interactionRules: ['State uncertainty'],
      corrections: [{ scene: 'No source', wrong: 'Claim certainty', correct: 'Flag uncertainty' }],
    },
    runtimeProfile: 'runtime-default',
    toolIds: ['web-read'],
    requiredCapabilities: ['network.read'],
    acceptanceCriteria: ['Every material claim has evidence.'],
    sourceBoundary: {
      apps: ['Browser'],
      windows: ['Research'],
      includePaths: ['workspace/research'],
      excludePaths: ['workspace/secrets'],
    },
    provenance: {
      demoSessionIds: ['demo-1'],
      expertActorRef: 'expert:alice',
      nodeId: 'node-1',
      device: 'laptop-a',
      runtime: 'codex',
      runtimeVersion: '1.0.0',
      agentVersion: '1.0.0',
      capturedAt: at,
    },
    evidenceRefs: ['evi-1'],
    failureNotes: ['Fails closed when evidence is unavailable.'],
    declaredPermissions: [{ capability: 'network.read', access: 'read', paths: [] }],
    regressionSuiteRef: 'suite-1',
    receiptRef: 'receipt-1',
    status: 'verified',
    deletionAudit: {},
  };
}

function systemTrial(overrides: Partial<SkillTrialSystemRecordInput> = {}): SkillTrialSystemRecordInput {
  return {
    schema: 'hummer.skill-trial-system-record-input',
    version: 1,
    tenantId: 'tenant-a',
    trialId: 'trial-1',
    packageId: 'cap-research',
    packageVersion: 1,
    recordedBy: 'system:skill-trial',
    mode: 'shadow',
    ok: true,
    startedAt: '2026-10-07T00:55:00Z',
    endedAt: at,
    environment: {
      nodeId: 'node-1',
      os: 'win32',
      runtime: 'codex',
      runtimeVersion: '1.0.0',
      appVersions: { browser: '1.2.3' },
    },
    receiptRef: 'receipt-trial-1',
    ...overrides,
  };
}

function packageV1(version = 1, status: CapabilityPackageV1['status'] = 'shared'): CapabilityPackageV1 {
  const input = authorInput(version);
  return {
    ...input,
    schema: 'hummer.capability-package',
    status,
    trialRecord: {
      shadowRuns: 1,
      success: 1,
      failure: 0,
      lastRunAt: at,
      environments: [systemTrial({ packageVersion: version }).environment],
    },
  };
}

function share(): TeamReadOnlyShare {
  return {
    schema: 'hummer.capability-team-share',
    version: 1,
    shareId: 'share-1',
    sourceTenantId: 'tenant-a',
    targetTenantId: 'tenant-b',
    invitationRef: 'invite-1',
    access: 'read_only',
    allowEdit: false,
    allowCopyToTenant: false,
    packageDigest: digest,
    package: packageV1(),
    sharedByActorRef: 'human:alice',
    sharedAt: at,
  };
}

function gateInput(): CapabilityInstallGateInput {
  const fileDigest = digest;
  return {
    schema: 'hummer.capability-install-gate-input',
    version: 1,
    gateId: 'gate-1',
    share: share(),
    exportDescriptor: {
      format: 'agent-skills',
      installEntry: 'manifest.json',
      fileDigests: {
        'SKILL.md': fileDigest,
        'work.md': fileDigest,
        'behavior.md': fileDigest,
        'work_skill.md': fileDigest,
        'behavior_skill.md': fileDigest,
        'manifest.json': fileDigest,
        'meta.json': fileDigest,
        'receipt.json': fileDigest,
      },
      containsRawRecording: false,
      containsCredentials: false,
      containsUnredactedCustomerData: false,
    },
    targetTenantId: 'tenant-b',
    requestedByActorRef: 'human:bob',
    staticCheck: { passed: true, findings: [] },
    permissionReview: {
      approvedPermissions: [{ capability: 'network.read', access: 'read', paths: [] }],
      deniedPermissions: [],
    },
    sourceVerification: {
      provenanceVerified: true,
      receiptVerified: true,
      digestVerified: true,
    },
    evaluatedAt: at,
  };
}

const standards = {
  CapabilityPackageAuthorInput: CapabilityPackageAuthorInputStandardSchema,
  SkillTrialSystemRecordInput: SkillTrialSystemRecordInputStandardSchema,
  CapabilityPackageV1: CapabilityPackageV1StandardSchema,
  TeamReadOnlyShare: TeamReadOnlyShareStandardSchema,
  CapabilityInstallGateInput: CapabilityInstallGateInputStandardSchema,
  CapabilityInstallGateDecision: CapabilityInstallGateDecisionStandardSchema,
} as const;

function validSamples() {
  const gate = gateInput();
  return {
    CapabilityPackageAuthorInput: authorInput(),
    SkillTrialSystemRecordInput: systemTrial(),
    CapabilityPackageV1: packageV1(),
    TeamReadOnlyShare: share(),
    CapabilityInstallGateInput: gate,
    CapabilityInstallGateDecision: createCapabilityInstallGateDecision(gate),
  } as const;
}

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('[CAPABILITY-CONTRACT-V1] TypeBox is the runtime source of truth', () => {
  it('keeps raw Ajv and Standard Schema structurally consistent for every contract', async () => {
    const samples = validSamples();
    for (const name of Object.keys(CapabilityContractSchemas) as CapabilityContractName[]) {
      const schema = CapabilityContractSchemas[name];
      expect(standards[name].jsonSchema).toBe(schema);
      const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: false });
      const validate = ajv.compile(schema);
      expect(validate(samples[name]), name).toBe(true);
      expect(await standards[name]['~standard'].validate(samples[name]), name).toHaveProperty('value');
    }
  });

  it('rejects an unknown top-level field and wrong version in every contract through both validators', async () => {
    const samples = validSamples();
    for (const name of Object.keys(CapabilityContractSchemas) as CapabilityContractName[]) {
      for (const invalid of [
        { ...samples[name], unexpected: true },
        { ...samples[name], version: 2 },
      ]) {
        const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: false });
        expect(ajv.compile(CapabilityContractSchemas[name])(invalid), name).toBe(false);
        expect(await standards[name]['~standard'].validate(invalid), name).toHaveProperty('issues');
      }
    }
  });

  it('rejects unknown nested fields instead of preserving them', () => {
    const pkg = copy(packageV1()) as CapabilityPackageV1 & { provenance: Record<string, unknown> };
    pkg.provenance.unexpected = true;
    expect(validateCapabilityContract('CapabilityPackageV1', pkg)).toHaveProperty('issues');

    const gate = copy(gateInput()) as CapabilityInstallGateInput & { staticCheck: Record<string, unknown> };
    gate.staticCheck.unexpected = true;
    expect(validateCapabilityContract('CapabilityInstallGateInput', gate)).toHaveProperty('issues');
  });
});

describe('[CAPABILITY-TRIAL-SYSTEM-ONLY] trial provenance and aggregation', () => {
  it('does not accept trialRecord on the author input surface', () => {
    expect(validateCapabilityContract('CapabilityPackageAuthorInput', {
      ...authorInput(),
      trialRecord: packageV1().trialRecord,
    })).toHaveProperty('issues');
  });

  it('accepts only the system trial recorder and enforces live/failure evidence', () => {
    expect(validateCapabilityContract('SkillTrialSystemRecordInput', {
      ...systemTrial(), recordedBy: 'human:alice',
    })).toHaveProperty('issues');
    expect(validateCapabilityContract('SkillTrialSystemRecordInput', {
      ...systemTrial(), mode: 'live',
    })).toHaveProperty('issues');
    expect(validateCapabilityContract('SkillTrialSystemRecordInput', {
      ...systemTrial(), mode: 'live', liveApprovalRef: 'approval-1',
    })).toHaveProperty('value');
    expect(validateCapabilityContract('SkillTrialSystemRecordInput', {
      ...systemTrial(), ok: false, receiptRef: undefined,
    })).toHaveProperty('issues');
  });

  it('derives TrialRecord from valid same-version SkillTrial records', () => {
    const result = createTrialRecordFromSystemTrials([
      systemTrial(),
      systemTrial({ trialId: 'trial-2', ok: false, failureStepRef: 'step-2', endedAt: '2026-10-07T01:05:00Z' }),
    ]);
    expect(result).toMatchObject({ shadowRuns: 2, success: 1, failure: 1, lastRunAt: '2026-10-07T01:05:00Z' });
    expect(result.environments).toHaveLength(1);
  });

  it('refuses empty, cross-tenant and cross-version trial aggregation', () => {
    expect(() => createTrialRecordFromSystemTrials([])).toThrow('at least one');
    expect(() => createTrialRecordFromSystemTrials([
      systemTrial(), systemTrial({ trialId: 'trial-2', tenantId: 'tenant-b' }),
    ])).toThrow('one tenant and package version');
    expect(() => createTrialRecordFromSystemTrials([
      systemTrial(), systemTrial({ trialId: 'trial-2', packageVersion: 2 }),
    ])).toThrow('one tenant and package version');
    expect(() => createTrialRecordFromSystemTrials([
      systemTrial({ mode: 'live', liveApprovalRef: 'approval-1' }),
    ])).toThrow('shadow SkillTrial');
  });

  it('rejects a fabricated aggregate count and missing shared trust fields', () => {
    expect(validateCapabilityContract('CapabilityPackageV1', {
      ...packageV1(), trialRecord: { ...packageV1().trialRecord, shadowRuns: 9 },
    })).toHaveProperty('issues');

    for (const field of [
      'provenance', 'sourceBoundary', 'trialRecord', 'failureNotes',
      'declaredPermissions', 'evidenceRefs', 'receiptRef',
    ] as const) {
      const invalid = copy(packageV1()) as Record<string, unknown>;
      delete invalid[field];
      expect(validateCapabilityContract('CapabilityPackageV1', invalid), field).toHaveProperty('issues');
    }
  });
});

describe('[CAPABILITY-VERSION-APPEND-ONLY] package versions are immutable', () => {
  it('allows a first version and a correctly linked next version', () => {
    expect(evaluateCapabilityVersionAppend([], authorInput(1))).toEqual({ allowed: true });
    expect(evaluateCapabilityVersionAppend([packageV1(1, 'verified')], authorInput(2))).toEqual({ allowed: true });
  });

  it('denies same-version overwrite, gaps, identity changes and malformed history', () => {
    expect(evaluateCapabilityVersionAppend([packageV1(1)], authorInput(1))).toEqual({
      allowed: false, reason: 'version_already_exists',
    });
    expect(evaluateCapabilityVersionAppend([packageV1(1)], authorInput(3))).toEqual({
      allowed: false, reason: 'version_not_next',
    });
    expect(evaluateCapabilityVersionAppend([packageV1(1)], { ...authorInput(2), packageId: 'cap-other' })).toEqual({
      allowed: false, reason: 'identity_mismatch',
    });
    expect(evaluateCapabilityVersionAppend([{ ...packageV1(1), trialRecord: { shadowRuns: 1 } }], authorInput(2))).toEqual({
      allowed: false, reason: 'invalid_existing',
    });
    expect(evaluateCapabilityVersionAppend([packageV1(2)], authorInput(3))).toEqual({
      allowed: false, reason: 'invalid_existing',
    });
  });
});

describe('[CAPABILITY-TEAM-READ-ONLY] share and install gate', () => {
  it('accepts only a complete shared package from its source tenant', () => {
    expect(validateCapabilityContract('TeamReadOnlyShare', share())).toHaveProperty('value');
    expect(validateCapabilityContract('TeamReadOnlyShare', {
      ...share(), package: packageV1(1, 'verified'),
    })).toHaveProperty('issues');
    expect(validateCapabilityContract('TeamReadOnlyShare', {
      ...share(), sourceTenantId: 'tenant-c',
    })).toHaveProperty('issues');
  });

  it('requires an invitation for cross-tenant sharing but not same-tenant sharing', () => {
    const crossTenant = { ...share() };
    delete (crossTenant as Partial<TeamReadOnlyShare>).invitationRef;
    expect(validateCapabilityContract('TeamReadOnlyShare', crossTenant)).toHaveProperty('issues');

    const sameTenant = { ...share(), targetTenantId: 'tenant-a' };
    delete (sameTenant as Partial<TeamReadOnlyShare>).invitationRef;
    expect(validateCapabilityContract('TeamReadOnlyShare', sameTenant)).toHaveProperty('value');
  });

  it('rejects edit, tenant-copy, public visibility, price and payment additions', () => {
    for (const invalid of [
      { ...share(), allowEdit: true },
      { ...share(), allowCopyToTenant: true },
      { ...share(), access: 'write' },
      { ...share(), visibility: 'public' },
      { ...share(), priceCents: 9900 },
      { ...share(), payment: { currency: 'CNY' } },
    ]) {
      expect(validateCapabilityContract('TeamReadOnlyShare', invalid)).toHaveProperty('issues');
    }
  });

  it('approves only when checks, provenance, receipt, digest and exact permissions pass', () => {
    expect(assessCapabilityInstallGate(gateInput())).toEqual({
      allowed: true, reasons: ['install_gate_passed'],
    });

    const invalidCases: Array<[Partial<CapabilityInstallGateInput>, string]> = [
      [{ staticCheck: { passed: false, findings: [{ code: 'malware', message: 'blocked' }] } }, 'static_check_failed'],
      [{ sourceVerification: { provenanceVerified: false, receiptVerified: true, digestVerified: true } }, 'provenance_unverified'],
      [{ sourceVerification: { provenanceVerified: true, receiptVerified: false, digestVerified: true } }, 'receipt_unverified'],
      [{ sourceVerification: { provenanceVerified: true, receiptVerified: true, digestVerified: false } }, 'digest_unverified'],
      [{ permissionReview: {
        approvedPermissions: [],
        deniedPermissions: [{ capability: 'network.read', access: 'read', paths: [] }],
      } }, 'permission_denied'],
      [{ permissionReview: {
        approvedPermissions: [
          { capability: 'network.read', access: 'read', paths: [] },
          { capability: 'filesystem.write', access: 'write', paths: ['outputs'] },
        ],
        deniedPermissions: [],
      } }, 'permission_declaration_mismatch'],
      [{ permissionReview: {
        approvedPermissions: [{ capability: 'network.read', access: 'egress', paths: [] }],
        deniedPermissions: [],
      } }, 'permission_declaration_mismatch'],
    ];
    for (const [override, reason] of invalidCases) {
      const assessment = assessCapabilityInstallGate({ ...gateInput(), ...override });
      expect(assessment.allowed, reason).toBe(false);
      expect(assessment.reasons, reason).toContain(reason);
    }
  });

  it('fails closed on target mismatch, unknown market fields and invalid nested share', () => {
    expect(assessCapabilityInstallGate({ ...gateInput(), targetTenantId: 'tenant-c' })).toEqual({
      allowed: false, reasons: ['invalid_contract'],
    });
    expect(assessCapabilityInstallGate({ ...gateInput(), paymentToken: 'secret' })).toEqual({
      allowed: false, reasons: ['invalid_contract'],
    });
    expect(assessCapabilityInstallGate({
      ...gateInput(), share: { ...share(), access: 'write' },
    })).toEqual({ allowed: false, reasons: ['invalid_contract'] });
  });

  it('requires the complete Agent Skills export and forbids unsafe bundle claims', () => {
    const missingReceipt = copy(gateInput());
    delete (missingReceipt.exportDescriptor.fileDigests as Partial<typeof missingReceipt.exportDescriptor.fileDigests>)[
      'receipt.json'
    ];
    expect(assessCapabilityInstallGate(missingReceipt)).toEqual({
      allowed: false, reasons: ['invalid_contract'],
    });
    expect(assessCapabilityInstallGate({
      ...gateInput(),
      exportDescriptor: { ...gateInput().exportDescriptor, containsRawRecording: true },
    })).toEqual({ allowed: false, reasons: ['invalid_contract'] });
    expect(assessCapabilityInstallGate({
      ...gateInput(),
      exportDescriptor: { ...gateInput().exportDescriptor, installEntry: 'install.ps1' },
    })).toEqual({ allowed: false, reasons: ['invalid_contract'] });
  });

  it('emits a strict, machine-valid gate decision without installing anything', async () => {
    const decision = createCapabilityInstallGateDecision(gateInput());
    expect(decision.decision).toBe('approved');
    expect(await CapabilityInstallGateDecisionStandardSchema['~standard'].validate(decision)).toHaveProperty('value');
    expect(validateCapabilityContract('CapabilityInstallGateDecision', {
      ...decision, decision: 'denied',
    })).toHaveProperty('issues');
    expect(() => createCapabilityInstallGateDecision({ ...gateInput(), targetTenantId: 'tenant-c' })).toThrow(
      'invalid capability install gate input',
    );
  });
});
