import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AGENT_SKILLS_FILES,
  createInstallGateInput,
  createCapabilityExport,
  evaluateCapabilityInstallRequest,
  installCapabilityExport,
  installCapabilityExportDirectory,
  loadCapabilityExportDirectory,
  verifyCapabilityExport,
  verifyInstallGateInput,
  writeCapabilityExport,
  type CapabilityExportBundle,
  type InstallCapabilityInput,
} from './index.ts';
import {
  computeCapabilityPackageDigest,
  computeTeamReadOnlyShareDigest,
  type CapabilityPackageV1,
  type TeamReadOnlyShare,
} from '@hummer/contracts';

const capturedAt = '2026-10-07T01:00:00Z';

type Mutable<T> = { -readonly [Key in keyof T]: T[Key] extends object ? Mutable<T[Key]> : T[Key] };

function mutableClone<T>(value: T): Mutable<T> {
  return structuredClone(value) as Mutable<T>;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashLeaves(value: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  const visit = (item: unknown, path: string): void => {
    if (Array.isArray(item)) {
      if (item.length === 0) result[path || '/'] = sha256(canonicalJson(item));
      item.forEach((entry, index) => visit(entry, `${path}/${index}`));
    } else if (item && typeof item === 'object') {
      const entries = Object.entries(item);
      if (entries.length === 0) result[path || '/'] = sha256(canonicalJson(item));
      entries.forEach(([key, entry]) => visit(entry, `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`));
    } else {
      result[path || '/'] = sha256(canonicalJson(item));
    }
  };
  visit(value, '');
  return result;
}

function packageFixture(overrides: Partial<CapabilityPackageV1> = {}): CapabilityPackageV1 {
  const seed: CapabilityPackageV1 = {
    schema: 'hummer.capability-package',
    version: 1,
    tenantId: 'tenant-a',
    packageId: 'cap-research',
    packageVersion: 1,
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
      capturedAt,
    },
    evidenceRefs: ['evi-1'],
    trialRecord: {
      tenantId: 'tenant-a',
      packageId: 'cap-research',
      packageVersion: 1,
      packageDigest: '0'.repeat(64),
      trialIds: ['trial-1', 'trial-2', 'trial-3', 'trial-4', 'trial-5'],
      shadowRuns: 5,
      success: 5,
      failure: 0,
      lastRunAt: capturedAt,
      environments: [{
        nodeId: 'node-1',
        os: 'win32',
        runtime: 'codex',
        runtimeVersion: '1.0.0',
        appVersions: { browser: '1.2.3' },
      }],
      regressionPassed: true,
      regressionEvidenceDigest: 'b'.repeat(64),
    },
    failureNotes: ['Fails closed when evidence is unavailable.'],
    declaredPermissions: [{ capability: 'network.read', access: 'read', paths: ['workspace/research'] }],
    regressionSuiteRef: 'suite-1',
    receiptRef: 'receipt-1',
    packageDigest: '0'.repeat(64),
    status: 'shared',
    deletionAudit: {},
    ...overrides,
  };
  const packageDigest = computeCapabilityPackageDigest(seed);
  return {
    ...seed,
    packageDigest,
    trialRecord: {
      ...seed.trialRecord,
      tenantId: seed.tenantId,
      packageId: seed.packageId,
      packageVersion: seed.packageVersion,
      packageDigest,
    },
  };
}

function receiptFixture(pkg: CapabilityPackageV1) {
  const packageDigest = computeCapabilityPackageDigest(pkg);
  const payload = {
    packageDigest,
    provenanceDigest: sha256(canonicalJson(pkg.provenance)),
    receiptRef: pkg.receiptRef,
    regressionPassed: true,
    regressionEvidenceDigest: pkg.trialRecord.regressionEvidenceDigest,
    successfulShadowTrialIds: [...pkg.trialRecord.trialIds].sort(),
  };
  const canonicalPayload = canonicalJson(payload);
  const eventMaterial = {
    actorRef: 'system:capability-export',
    aggregateId: pkg.packageId,
    aggregateType: 'capability_package',
    aggregateVersion: pkg.packageVersion,
    correlationId: `capability-export-${pkg.packageId}-v${pkg.packageVersion}`,
    id: `event-${pkg.packageId}-v${pkg.packageVersion}`,
    occurredAt: capturedAt,
    payload,
    previousHash: null,
    tenantId: pkg.tenantId,
    type: 'capability.verified',
  };
  const domainEvents = [{
    position: 1,
    ...eventMaterial,
    canonicalPayload,
    hash: sha256(canonicalJson(eventMaterial)),
  }];
  const receipt = {
    receiptRef: pkg.receiptRef,
    tenantId: pkg.tenantId,
    generatedAt: capturedAt,
    chainIntegrity: { valid: true as const, checked: 1 },
    capability: {
      packageId: pkg.packageId,
      packageVersion: pkg.packageVersion,
      packageDigest,
      evidenceRefs: pkg.evidenceRefs,
      trialRecord: pkg.trialRecord,
      regressionSuiteRef: pkg.regressionSuiteRef,
    },
  };
  const content = { receipt, domainEvents };
  return {
    schema: 'hummer.outcome-receipt',
    version: 1,
    receipt,
    domainEvents,
    manifest: {
      algorithm: 'SHA-256',
      rootHash: sha256(canonicalJson(content)),
      fieldHashes: hashLeaves(content),
    },
  };
}

function exportFixture(pkg = packageFixture()): CapabilityExportBundle {
  return createCapabilityExport(pkg, receiptFixture(pkg));
}

function shareFixture(bundle: CapabilityExportBundle, overrides: Partial<TeamReadOnlyShare> = {}): TeamReadOnlyShare {
  const value: TeamReadOnlyShare = {
    schema: 'hummer.capability-team-share',
    version: 1,
    shareId: 'share-1',
    sourceTenantId: 'tenant-a',
    targetTenantId: 'tenant-b',
    packageId: bundle.package.packageId,
    packageVersion: bundle.package.packageVersion,
    invitation: {
      invitationId: 'invite-1',
      sourceTenantId: 'tenant-a',
      targetTenantId: 'tenant-b',
      packageId: bundle.package.packageId,
      packageVersion: bundle.package.packageVersion,
      packageDigest: bundle.packageDigest,
      status: 'accepted',
      expiresAt: '2026-10-08T01:00:00Z',
      evidenceDigest: 'c'.repeat(64),
    },
    access: 'read_only',
    allowEdit: false,
    allowCopyToTenant: false,
    packageDigest: bundle.packageDigest,
    shareDigest: '0'.repeat(64),
    package: bundle.package,
    sharedByActorRef: 'human:alice',
    sharedAt: capturedAt,
    ...overrides,
  };
  value.shareDigest = computeTeamReadOnlyShareDigest(value);
  return value;
}

async function installInput(
  bundle: CapabilityExportBundle,
  overrides: Partial<InstallCapabilityInput> = {},
): Promise<InstallCapabilityInput> {
  return {
    bundle,
    share: shareFixture(bundle),
    installRoot: await mkdtemp(join(tmpdir(), 'hummer-capability-install-')),
    targetTenantId: 'tenant-b',
    validInvitationEvidenceDigests: ['c'.repeat(64)],
    approvedPermissions: bundle.package.declaredPermissions,
    gateId: 'gate-1',
    requestedByActorRef: 'human:bob',
    evaluatedAt: capturedAt,
    ...overrides,
  };
}

describe('[CAP-AGENTSKILLS] deterministic Agent Skills export', () => {
  it('emits exactly eight deterministic LF files with per-file and root SHA-256 digests', () => {
    const first = exportFixture();
    const second = exportFixture();

    expect(Object.keys(first.files).sort()).toEqual([...AGENT_SKILLS_FILES].sort());
    expect(first).toEqual(second);
    expect(first.rootHash).toMatch(/^[a-f0-9]{64}$/);
    for (const file of AGENT_SKILLS_FILES) {
      expect(first.fileDigests[file]).toMatch(/^[a-f0-9]{64}$/);
      expect(first.files[file]).not.toContain('\r');
    }
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.package)).toBe(true);
  });

  it('preserves normalized boundary and permission paths without mutating the source package', () => {
    const source = packageFixture();
    const before = structuredClone(source);
    const bundle = exportFixture(source);
    const manifest = JSON.parse(bundle.files['manifest.json']) as {
      sourceBoundary: { includePaths: string[] };
      declaredPermissions: Array<{ paths: string[] }>;
    };

    expect(manifest.sourceBoundary.includePaths).toEqual(['workspace/research']);
    expect(manifest.declaredPermissions[0]?.paths).toEqual(['workspace/research']);
    expect(source).toEqual(before);
  });

  it('rejects raw recordings, likely credentials, unredacted markers and unsafe paths', () => {
    expect(() => exportFixture(packageFixture({ goal: 'data:video/mp4;base64,AAAA' }))).toThrow(
      'raw_recording.embedded_video',
    );
    expect(() => exportFixture(packageFixture({ failureNotes: ['api_key: "correct-horse-battery"'] }))).toThrow(
      'credential.assignment',
    );
    expect(() => exportFixture(packageFixture({ goal: 'Contains UNREDACTED customer rows' }))).toThrow(
      'unredacted.marker',
    );
    expect(() => exportFixture(packageFixture({
      sourceBoundary: { ...packageFixture().sourceBoundary, includePaths: ['../outside'] },
    }))).toThrow('CAPABILITY_PACKAGE_INVALID');
  });
});

describe('[CAP-MANIFEST] bundle and manifest verification', () => {
  it('links the manifest, meta and receipt and passes the repository receipt verifier', async () => {
    const bundle = exportFixture();
    const manifest = JSON.parse(bundle.files['manifest.json']) as Record<string, unknown>;
    const meta = JSON.parse(bundle.files['meta.json']) as { package: CapabilityPackageV1; rootHash?: unknown };
    const receipt = JSON.parse(bundle.files['receipt.json']) as { receipt: { capability: Record<string, unknown> } };

    expect(manifest.packageDigest).toBe(bundle.packageDigest);
    expect(manifest.rootHash).toBeUndefined();
    expect(meta.package).toEqual(bundle.package);
    expect(meta.package.packageDigest).toBe(bundle.packageDigest);
    expect(meta.rootHash).toBeUndefined();
    expect(receipt.receipt.capability.packageDigest).toBe(bundle.packageDigest);
    expect(manifest.installEntry).toBe('manifest.json');
    expect(manifest.artifacts).toEqual(AGENT_SKILLS_FILES);
    expect(verifyCapabilityExport(bundle)).toEqual({ ok: true, issues: [] });

    const directory = await mkdtemp(join(tmpdir(), 'hummer-capability-receipt-'));
    const receiptPath = join(directory, 'receipt.json');
    await writeFile(receiptPath, bundle.files['receipt.json'], 'utf8');
    const verified = spawnSync(process.execPath, [resolve('scripts/verify-receipt.mjs'), receiptPath], {
      encoding: 'utf8',
      windowsHide: true,
    });
    expect(verified.status, verified.stdout || verified.stderr).toBe(0);
    expect(JSON.parse(verified.stdout)).toMatchObject({ valid: true, checkedEvents: 1 });
  });

  it('passes the dependency-free external capability verifier and rejects tampered bytes', async () => {
    const bundle = exportFixture();
    const directory = await mkdtemp(join(tmpdir(), 'hummer-capability-external-verifier-'));
    const validPath = join(directory, 'bundle.json');
    await writeFile(validPath, `${JSON.stringify(bundle)}\n`, 'utf8');
    const command = resolve('scripts/verify-capability-export.mjs');
    const valid = spawnSync(process.execPath, [command, validPath], { encoding: 'utf8', windowsHide: true });
    expect(valid.status, valid.stdout || valid.stderr).toBe(0);
    expect(JSON.parse(valid.stdout)).toMatchObject({
      valid: true,
      packageId: bundle.package.packageId,
      packageDigest: bundle.packageDigest,
      rootHash: bundle.rootHash,
      files: 8,
    });

    const tampered = mutableClone(bundle);
    tampered.files['work.md'] += '\nTampered after export.\n';
    const tamperedPath = join(directory, 'tampered.json');
    await writeFile(tamperedPath, `${JSON.stringify(tampered)}\n`, 'utf8');
    const denied = spawnSync(process.execPath, [command, tamperedPath], { encoding: 'utf8', windowsHide: true });
    expect(denied.status).toBe(1);
    expect(JSON.parse(denied.stderr)).toMatchObject({ valid: false, code: 'verification.failed' });
    expect(denied.stderr).toContain('file.digest_mismatch:work.md');

    const forgedReceipt = mutableClone(bundle);
    const receipt = JSON.parse(forgedReceipt.files['receipt.json']) as { manifest: { rootHash: string } };
    receipt.manifest.rootHash = 'f'.repeat(64);
    forgedReceipt.files['receipt.json'] = `${JSON.stringify(receipt, null, 2)}\n`;
    forgedReceipt.fileDigests['receipt.json'] = sha256(forgedReceipt.files['receipt.json']);
    forgedReceipt.descriptor.fileDigests['receipt.json'] = forgedReceipt.fileDigests['receipt.json'];
    forgedReceipt.rootHash = sha256(AGENT_SKILLS_FILES.slice().sort().map((name) =>
      `${name}\u0000${forgedReceipt.fileDigests[name]}\n`).join(''));
    const forgedPath = join(directory, 'forged-receipt.json');
    await writeFile(forgedPath, `${JSON.stringify(forgedReceipt)}\n`, 'utf8');
    const forged = spawnSync(process.execPath, [command, forgedPath], { encoding: 'utf8', windowsHide: true });
    expect(forged.status).toBe(1);
    expect(forged.stderr).toContain('receipt.manifest_integrity');
  });

  it('rejects altered bytes, digests, root hashes, descriptors and extra files', () => {
    const bundle = exportFixture();
    const contentTamper = mutableClone(bundle);
    contentTamper.files['work.md'] += '\nTampered\n';
    expect(verifyCapabilityExport(contentTamper).issues).toContain('file.content_mismatch:work.md');

    const digestTamper = mutableClone(bundle);
    digestTamper.fileDigests['SKILL.md'] = 'b'.repeat(64);
    expect(verifyCapabilityExport(digestTamper).issues).toContain('file.digest_mismatch:SKILL.md');

    const rootTamper = mutableClone(bundle);
    rootTamper.rootHash = 'c'.repeat(64);
    expect(verifyCapabilityExport(rootTamper).issues).toContain('bundle.root_hash_mismatch');

    const descriptorTamper = mutableClone(bundle);
    descriptorTamper.descriptor.fileDigests['meta.json'] = 'd'.repeat(64);
    expect(verifyCapabilityExport(descriptorTamper).issues).toContain('bundle.descriptor_mismatch');

    const extraFile = mutableClone(bundle) as Mutable<CapabilityExportBundle> & { files: Record<string, string> };
    extraFile.files['install.ps1'] = 'Write-Host bypass';
    expect(verifyCapabilityExport(extraFile).issues).toContain('files.exact_set_mismatch');
  });

  it('rejects packages that are draft, retired, or request undeclared capabilities', () => {
    expect(() => exportFixture(packageFixture({ status: 'draft' }))).toThrow('NOT_EXPORTABLE');
    expect(() => exportFixture(packageFixture({ status: 'retired' }))).toThrow('NOT_EXPORTABLE');
    expect(() => exportFixture(packageFixture({
      requiredCapabilities: ['network.read', 'filesystem.write'],
    }))).toThrow('CAPABILITY_PERMISSION_UNDECLARED:filesystem.write');
  });

  it('enumerates the real export directory and verifies hashes from file bytes', async () => {
    const bundle = exportFixture();
    const root = await mkdtemp(join(tmpdir(), 'hummer-capability-export-'));
    const source = await writeCapabilityExport(bundle, join(root, 'bundle'));
    const loaded = await loadCapabilityExportDirectory(source);
    expect(loaded).toEqual(bundle);

    await chmod(join(source, 'work.md'), 0o644);
    await writeFile(join(source, 'work.md'), `${bundle.files['work.md']}\nTampered\n`, 'utf8');
    await expect(loadCapabilityExportDirectory(source)).rejects.toThrow('CAPABILITY_EXPORT_INVALID');

    const extraRoot = await mkdtemp(join(tmpdir(), 'hummer-capability-export-extra-'));
    const extraSource = await writeCapabilityExport(bundle, join(extraRoot, 'bundle'));
    await writeFile(join(extraSource, 'install.ps1'), 'Write-Host bypass', 'utf8');
    await expect(loadCapabilityExportDirectory(extraSource)).rejects.toThrow('CAPABILITY_EXPORT_FILE_SET_INVALID');
  });

  it('loads without external claims and rejects meta package tampering or legacy root injection', async () => {
    const bundle = exportFixture();
    const root = await mkdtemp(join(tmpdir(), 'hummer-capability-self-describing-'));
    const source = await writeCapabilityExport(bundle, join(root, 'bundle'));

    await expect(loadCapabilityExportDirectory(source)).resolves.toEqual(bundle);
    await expect(loadCapabilityExportDirectory({
      sourceDirectory: source,
      package: bundle.package,
      descriptor: bundle.descriptor,
      rootHash: 'f'.repeat(64),
    })).rejects.toThrow('CAPABILITY_EXPORT_EXTERNAL_CLAIMS_REJECTED');

    const tamperRoot = await mkdtemp(join(tmpdir(), 'hummer-capability-meta-tamper-'));
    const tamperSource = await writeCapabilityExport(bundle, join(tamperRoot, 'bundle'));
    const metaPath = join(tamperSource, 'meta.json');
    const meta = JSON.parse(await readFile(metaPath, 'utf8')) as { package: CapabilityPackageV1 };
    meta.package.title = 'Tampered package title';
    await chmod(metaPath, 0o644);
    await writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
    await expect(loadCapabilityExportDirectory(tamperSource)).rejects.toThrow('CAPABILITY_EXPORT_META_INVALID');
  });

  it('rejects shared packages without five unique successful shadow trials and regression evidence', () => {
    const valid = packageFixture();
    expect(() => exportFixture(packageFixture({
      trialRecord: {
        ...valid.trialRecord,
        trialIds: ['trial-1', 'trial-2', 'trial-3', 'trial-4'],
        shadowRuns: 4,
        success: 4,
      },
    }))).toThrow('CAPABILITY_PACKAGE_INVALID');
    expect(() => exportFixture(packageFixture({
      trialRecord: {
        ...valid.trialRecord,
        trialIds: ['trial-1', 'trial-2', 'trial-3', 'trial-4', 'trial-4'],
      },
    }))).toThrow('CAPABILITY_PACKAGE_INVALID');
    expect(() => exportFixture(packageFixture({
      trialRecord: { ...valid.trialRecord, success: 4, failure: 1 },
    }))).toThrow('CAPABILITY_PACKAGE_INVALID');
    expect(() => exportFixture(packageFixture({
      trialRecord: { ...valid.trialRecord, regressionPassed: false },
    }))).toThrow('CAPABILITY_PACKAGE_INVALID');
  });

  it('rejects a source receipt with a forged root, event, or package binding', () => {
    const pkg = packageFixture();
    const forgedRoot = receiptFixture(pkg);
    forgedRoot.manifest.rootHash = 'f'.repeat(64);
    expect(() => createCapabilityExport(pkg, forgedRoot)).toThrow('CAPABILITY_RECEIPT_INVALID:root_hash');

    const forgedEvent = receiptFixture(pkg);
    forgedEvent.domainEvents[0]!.hash = 'e'.repeat(64);
    forgedEvent.manifest.fieldHashes = hashLeaves({
      receipt: forgedEvent.receipt,
      domainEvents: forgedEvent.domainEvents,
    });
    forgedEvent.manifest.rootHash = sha256(canonicalJson({
      receipt: forgedEvent.receipt,
      domainEvents: forgedEvent.domainEvents,
    }));
    expect(() => createCapabilityExport(pkg, forgedEvent)).toThrow('CAPABILITY_RECEIPT_INVALID:event_hash');

    const wrongPackage = receiptFixture(pkg);
    wrongPackage.receipt.capability.packageId = 'cap-other';
    const wrongContent = { receipt: wrongPackage.receipt, domainEvents: wrongPackage.domainEvents };
    wrongPackage.manifest.fieldHashes = hashLeaves(wrongContent);
    wrongPackage.manifest.rootHash = sha256(canonicalJson(wrongContent));
    expect(() => createCapabilityExport(pkg, wrongPackage)).toThrow('CAPABILITY_RECEIPT_INVALID:package_binding');

    const forgedProvenance = receiptFixture(pkg);
    const provenanceEvent = forgedProvenance.domainEvents[0]!;
    const provenancePayload = {
      ...JSON.parse(provenanceEvent.canonicalPayload) as Record<string, unknown>,
      provenanceDigest: 'd'.repeat(64),
    };
    provenanceEvent.canonicalPayload = canonicalJson(provenancePayload);
    provenanceEvent.hash = sha256(canonicalJson({
      actorRef: provenanceEvent.actorRef,
      aggregateId: provenanceEvent.aggregateId,
      aggregateType: provenanceEvent.aggregateType,
      aggregateVersion: provenanceEvent.aggregateVersion,
      correlationId: provenanceEvent.correlationId,
      id: provenanceEvent.id,
      occurredAt: provenanceEvent.occurredAt,
      payload: provenancePayload,
      previousHash: provenanceEvent.previousHash,
      tenantId: provenanceEvent.tenantId,
      type: provenanceEvent.type,
    }));
    const provenanceContent = { receipt: forgedProvenance.receipt, domainEvents: forgedProvenance.domainEvents };
    forgedProvenance.manifest.fieldHashes = hashLeaves(provenanceContent);
    forgedProvenance.manifest.rootHash = sha256(canonicalJson(provenanceContent));
    expect(() => createCapabilityExport(pkg, forgedProvenance)).toThrow(
      'CAPABILITY_RECEIPT_INVALID:source_evidence',
    );

    const failedRegression = receiptFixture(pkg);
    const event = failedRegression.domainEvents[0]!;
    const failedPayload = {
      packageDigest: pkg.packageDigest,
      provenanceDigest: sha256(canonicalJson(pkg.provenance)),
      receiptRef: pkg.receiptRef,
      regressionPassed: false,
      regressionEvidenceDigest: pkg.trialRecord.regressionEvidenceDigest,
      successfulShadowTrialIds: [...pkg.trialRecord.trialIds].sort(),
    };
    event.canonicalPayload = canonicalJson(failedPayload);
    event.hash = sha256(canonicalJson({
      actorRef: event.actorRef,
      aggregateId: event.aggregateId,
      aggregateType: event.aggregateType,
      aggregateVersion: event.aggregateVersion,
      correlationId: event.correlationId,
      id: event.id,
      occurredAt: event.occurredAt,
      payload: failedPayload,
      previousHash: event.previousHash,
      tenantId: event.tenantId,
      type: event.type,
    }));
    const failedContent = { receipt: failedRegression.receipt, domainEvents: failedRegression.domainEvents };
    failedRegression.manifest.fieldHashes = hashLeaves(failedContent);
    failedRegression.manifest.rootHash = sha256(canonicalJson(failedContent));
    expect(() => createCapabilityExport(pkg, failedRegression)).toThrow(
      'CAPABILITY_RECEIPT_INVALID:trial_regression_evidence',
    );
  });
});

describe('[CAP-PERMISSIONS] install permission boundary', () => {
  it('exports a complete byte-derived gate input and returns structured denials', async () => {
    const bundle = exportFixture();
    const fullInput = await installInput(bundle);
    const { installRoot: _installRoot, ...evaluationInput } = fullInput;
    const approved = evaluateCapabilityInstallRequest(evaluationInput);
    expect(createInstallGateInput(evaluationInput)).toEqual(approved);

    expect(approved.status).toBe('approved');
    expect(approved.gateInput?.recordedBy).toBe('system:capability-install-gate');
    expect(approved.gateInput?.exportDescriptor.fileDigests['work.md']).toBe(sha256(bundle.files['work.md']));
    expect(approved.gateInput?.sourceVerification).toMatchObject({
      provenance: { status: 'passed' },
      receipt: { status: 'passed' },
      packageDigest: { status: 'passed' },
      invitation: { status: 'passed' },
      regression: { status: 'passed' },
    });
    expect(approved.decision).toMatchObject({
      decision: 'approved',
      packageDigest: bundle.packageDigest,
      shareDigest: fullInput.share.shareDigest,
      requestDigest: approved.gateInput?.requestDigest,
    });
    expect(verifyInstallGateInput(approved.gateInput)).toMatchObject({
      status: 'approved',
      decision: { decision: 'approved' },
    });
    expect(verifyInstallGateInput({ ...approved.gateInput, paymentToken: 'not-allowed' })).toEqual({
      status: 'denied',
      reasons: ['install_gate_contract_invalid'],
    });

    const tampered = mutableClone(bundle);
    tampered.files['work.md'] += '\nTampered after export\n';
    const deniedBytes = evaluateCapabilityInstallRequest({ ...evaluationInput, bundle: tampered });
    expect(deniedBytes).toMatchObject({
      status: 'denied',
      gateInput: { staticCheck: { status: 'failed' } },
      decision: { decision: 'denied' },
    });
    expect(deniedBytes.gateInput?.exportDescriptor.fileDigests['work.md']).toBe(
      sha256(tampered.files['work.md']),
    );

    const deniedInvitation = evaluateCapabilityInstallRequest({
      ...evaluationInput,
      validInvitationEvidenceDigests: [],
    });
    expect(deniedInvitation).toMatchObject({
      status: 'denied',
      gateInput: { sourceVerification: { invitation: { status: 'failed' } } },
      decision: { decision: 'denied' },
    });
  });

  it('denies added, changed-access, changed-path and explicitly denied permissions', async () => {
    const bundle = exportFixture();
    const cases: Array<Partial<InstallCapabilityInput>> = [
      { approvedPermissions: [
        ...bundle.package.declaredPermissions,
        { capability: 'filesystem.write', access: 'write', paths: ['outputs'] },
      ] },
      { approvedPermissions: [{ capability: 'network.read', access: 'egress', paths: ['workspace/research'] }] },
      { approvedPermissions: [{ capability: 'network.read', access: 'read', paths: ['workspace'] }] },
      { deniedPermissions: bundle.package.declaredPermissions },
    ];
    for (const override of cases) {
      await expect(installCapabilityExport(await installInput(bundle, override))).rejects.toThrow(
        'CAPABILITY_INSTALL_GATE_DENIED',
      );
    }
  });

  it('installs an exact-permission bundle once and refuses overwrite without changing source bytes', async () => {
    const created = exportFixture();
    const exportRoot = await mkdtemp(join(tmpdir(), 'hummer-capability-install-source-'));
    const sourceDirectory = await writeCapabilityExport(created, join(exportRoot, 'bundle'));
    const bundle = await loadCapabilityExportDirectory(sourceDirectory);
    const before = structuredClone(bundle);
    const input = await installInput(bundle);
    const { bundle: _bundle, ...directoryInput } = input;
    const installed = await installCapabilityExportDirectory({ ...directoryInput, sourceDirectory });
    const skillBefore = await readFile(join(installed.targetDirectory, 'SKILL.md'), 'utf8');

    expect(installed.readOnly).toBe(true);
    expect(installed.decision.decision).toBe('approved');
    expect(installed.decision.packageDigest).toBe(bundle.packageDigest);
    expect(installed.decision.shareDigest).toBe(input.share.shareDigest);
    expect(installed.decision.requestDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(installed.decision.decidedBy).toBe('system:capability-install-gate');
    expect(bundle).toEqual(before);
    await expect(installCapabilityExportDirectory({ ...directoryInput, sourceDirectory })).rejects.toThrow(
      'CAPABILITY_INSTALL_TARGET_EXISTS',
    );
    expect(await readFile(join(installed.targetDirectory, 'SKILL.md'), 'utf8')).toBe(skillBefore);
    expect(bundle).toEqual(before);
  });
});

describe('[CAP-SHARING] cross-tenant read-only installation', () => {
  it('requires a contract-valid read-only share and a currently valid invitation', async () => {
    const bundle = exportFixture();
    await expect(installCapabilityExport(await installInput(bundle, {
      validInvitationEvidenceDigests: [],
    }))).rejects.toThrow('CAPABILITY_INSTALL_GATE_DENIED');
    await expect(installCapabilityExport(await installInput(bundle, {
      share: { ...shareFixture(bundle), access: 'write' } as unknown as TeamReadOnlyShare,
    }))).rejects.toThrow('CAPABILITY_INSTALL_GATE_DENIED:share_contract_invalid');
    await expect(installCapabilityExport(await installInput(bundle, {
      share: { ...shareFixture(bundle), allowEdit: true } as unknown as TeamReadOnlyShare,
    }))).rejects.toThrow('CAPABILITY_INSTALL_GATE_DENIED:share_contract_invalid');
    await expect(installCapabilityExport(await installInput(bundle, {
      share: { ...shareFixture(bundle), allowCopyToTenant: true } as unknown as TeamReadOnlyShare,
    }))).rejects.toThrow('CAPABILITY_INSTALL_GATE_DENIED:share_contract_invalid');
    await expect(installCapabilityExport(await installInput(bundle, {
      evaluatedAt: '2026-10-09T01:00:00Z',
    }))).rejects.toThrow('CAPABILITY_INSTALL_GATE_DENIED');
  });

  it('binds target tenant, package bytes and digest to the authenticated share', async () => {
    const bundle = exportFixture();
    await expect(installCapabilityExport(await installInput(bundle, {
      targetTenantId: 'tenant-c',
    }))).rejects.toThrow('CAPABILITY_INSTALL_GATE_DENIED');
    await expect(installCapabilityExport(await installInput(bundle, {
      share: { ...shareFixture(bundle), packageDigest: 'f'.repeat(64) },
    }))).rejects.toThrow('CAPABILITY_INSTALL_GATE_DENIED:share_contract_invalid');
    await expect(installCapabilityExport(await installInput(bundle, {
      share: { ...shareFixture(bundle), package: { ...bundle.package, title: 'Substituted' } },
    }))).rejects.toThrow('CAPABILITY_INSTALL_GATE_DENIED:share_contract_invalid');
  });

  it('rejects tenant/package path injection before creating an install target', async () => {
    expect(() => exportFixture(packageFixture({ packageId: '../escape' }))).toThrow('CAPABILITY_PACKAGE_INVALID');
    const reserved = exportFixture(packageFixture({ packageId: 'CON' }));
    await expect(installCapabilityExport(await installInput(reserved, {
      share: shareFixture(reserved),
    }))).rejects.toThrow('CAPABILITY_INSTALL_PATH_INVALID:packageId');
  });

  it('rejects a symlink or junction install root before writing any file', async () => {
    const bundle = exportFixture();
    const actualRoot = await mkdtemp(join(tmpdir(), 'hummer-capability-real-root-'));
    const linkParent = await mkdtemp(join(tmpdir(), 'hummer-capability-link-parent-'));
    const linkedRoot = join(linkParent, 'junction-root');
    await symlink(actualRoot, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(installCapabilityExport(await installInput(bundle, {
      installRoot: linkedRoot,
    }))).rejects.toThrow('CAPABILITY_INSTALL_PATH_SYMLINK:installRoot');
  });
});
