import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
import {
  computeCapabilityInstallRequestDigest,
  computeCapabilityPackageDigest,
  computeTeamReadOnlyShareDigest,
  createTrialRecordFromSystemTrials,
  type CapabilityInstallGateInput,
  type CapabilityPackageAuthorInput,
  type CapabilityPackageV1,
  type SkillTrialSystemRecordInput,
  type TeamReadOnlyShare,
} from '@hummer/contracts';
import { openPersistence } from '../../../apps/desktop/src/persistence/database.js';
import { openPublicMarketStore, type PublicMarketStore } from './index.js';

const at = '2026-10-07T10:00:00.000Z';
const digest = 'a'.repeat(64);
const temporaryDirectories: string[] = [];

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

interface Fixture {
  market: PublicMarketStore;
  databasePath: string;
  sourceTenantId: string;
  sourceActorRef: string;
  targetTenantId: string;
  targetActorRef: string;
  reporterTenantId: string;
  reporterActorRef: string;
  moderationTenantId: string;
  moderatorActorRef: string;
  pkg: CapabilityPackageV1;
  trials: SkillTrialSystemRecordInput[];
}

describe('[PUBLIC-MARKET-W10] verified package and redacted public projection', () => {
  it('publishes only a verified package and exposes source, trials, failures, permissions, and integrity without tenant secrets', () => {
    const fixture = setup();
    registerAndPublish(fixture);

    const [listing] = fixture.market.browse();
    expect(listing).toMatchObject({
      schema: 'hummer.public-capability-listing',
      listingId: 'listing-research',
      packageDigest: fixture.pkg.packageDigest,
      integrity: { kind: 'package_digest', digest: fixture.pkg.packageDigest },
      provenance: { runtime: 'codex', demoSessionCount: 1 },
      trialRecord: { shadowRuns: 5, success: 5, failure: 0, regressionPassed: true },
      failureNotes: [{ summary: 'Publisher-recorded failure note', digest: expect.stringMatching(/^[a-f0-9]{64}$/) }],
      declaredPermissions: fixture.pkg.declaredPermissions,
      sourceBoundary: { applicationCount: 1, windowPatternCount: 1 },
    });
    const publicBytes = JSON.stringify(listing);
    for (const secret of [
      fixture.sourceTenantId,
      fixture.pkg.provenance.expertActorRef,
      fixture.pkg.provenance.nodeId,
      fixture.pkg.provenance.device,
      fixture.pkg.provenance.demoSessionIds[0]!,
      fixture.pkg.evidenceRefs[0]!,
      'workspace/private-source',
    ]) expect(publicBytes).not.toContain(secret);

    fixture.market.close();
  });

  it('rejects unverified packages and a trial aggregate that is not backed by exact system trials', () => {
    const fixture = setup();
    expect(() => fixture.market.registerVerifiedPackage({
      requestTenantId: fixture.sourceTenantId,
      actorRef: fixture.sourceActorRef,
      package: { ...fixture.pkg, status: 'verified' },
      trials: fixture.trials,
    })).toThrow(/verified shared package/i);

    expect(() => fixture.market.registerVerifiedPackage({
      requestTenantId: fixture.sourceTenantId,
      actorRef: fixture.sourceActorRef,
      package: fixture.pkg,
      trials: fixture.trials.slice(0, 4),
    })).toThrow(/trial aggregate/i);
    fixture.market.close();
  });
});

describe('[PUBLIC-MARKET-AUTHZ] tenant and membership boundaries', () => {
  it('rejects cross-tenant and forged actors with the same opaque authorization failure', () => {
    const fixture = setup();
    const denied = [
      () => fixture.market.registerVerifiedPackage({
        requestTenantId: fixture.sourceTenantId,
        actorRef: fixture.reporterActorRef,
        package: fixture.pkg,
        trials: fixture.trials,
      }),
      () => fixture.market.registerVerifiedPackage({
        requestTenantId: fixture.reporterTenantId,
        actorRef: fixture.reporterActorRef,
        package: fixture.pkg,
        trials: fixture.trials,
      }),
      () => fixture.market.registerVerifiedPackage({
        requestTenantId: fixture.sourceTenantId,
        actorRef: 'human:forged',
        package: fixture.pkg,
        trials: fixture.trials,
      }),
    ];
    for (const operation of denied) expect(operation).toThrow(/^Marketplace authorization denied$/);

    registerAndPublish(fixture);
    expect(() => fixture.market.report({
      reportId: 'report-forged',
      listingId: 'listing-research',
      reporterTenantId: fixture.reporterTenantId,
      reporterActorRef: fixture.sourceActorRef,
      reason: 'forged reporter',
    })).toThrow(/^Marketplace authorization denied$/);
    expect(() => fixture.market.authorizeInstall({
      attemptId: 'attempt-forged',
      listingId: 'listing-research',
      targetTenantId: fixture.targetTenantId,
      gate: installGate(fixture, { requestedByActorRef: 'human:forged' }),
    })).toThrow(/^Marketplace authorization denied$/);
    fixture.market.close();
  });
});

describe('[PUBLIC-MARKET-INSTALL-GATE] existing trusted install gate', () => {
  it('records an approved exact-package gate and denies a permission expansion', () => {
    const fixture = setup();
    registerAndPublish(fixture);
    const approved = fixture.market.authorizeInstall({
      attemptId: 'attempt-approved',
      listingId: 'listing-research',
      targetTenantId: fixture.targetTenantId,
      gate: installGate(fixture),
    });
    expect(approved).toMatchObject({ decision: 'approved', reasons: ['install_gate_passed'] });

    const deniedGate = installGate(fixture, { gateId: 'gate-denied' });
    deniedGate.permissionReview = {
      approvedPermissions: [],
      deniedPermissions: fixture.pkg.declaredPermissions,
      evidenceDigest: digest,
    };
    deniedGate.requestDigest = computeCapabilityInstallRequestDigest(deniedGate);
    const denied = fixture.market.authorizeInstall({
      attemptId: 'attempt-denied',
      listingId: 'listing-research',
      targetTenantId: fixture.targetTenantId,
      gate: deniedGate,
    });
    expect(denied.decision).toBe('denied');
    expect(denied.reasons).toEqual(expect.arrayContaining(['permission_denied', 'permission_declaration_mismatch']));
    fixture.market.close();
  });

  it('rejects a gate rebound to a different package digest before installation', () => {
    const fixture = setup();
    registerAndPublish(fixture);
    const gate = installGate(fixture);
    gate.share.packageDigest = 'b'.repeat(64);
    expect(() => fixture.market.authorizeInstall({
      attemptId: 'attempt-rebound',
      listingId: 'listing-research',
      targetTenantId: fixture.targetTenantId,
      gate,
    })).toThrow(/exact public package/i);
    fixture.market.close();
  });
});

describe('[PUBLIC-MARKET-TAKEDOWN] report and human moderation', () => {
  it('keeps a reported listing visible until a tenant-member human moderator takes it down, then blocks browse and install', () => {
    const fixture = setup();
    registerAndPublish(fixture);
    fixture.market.report({
      reportId: 'report-1',
      listingId: 'listing-research',
      reporterTenantId: fixture.reporterTenantId,
      reporterActorRef: fixture.reporterActorRef,
      reason: 'The public provenance needs review.',
    });

    expect(fixture.market.browse()).toHaveLength(1);
    expect(() => directTakedown(fixture.databasePath, 'listing-research')).toThrow(/human moderation action/i);
    expect(() => fixture.market.takeDown({
      actionId: 'action-unauthorized',
      reportId: 'report-1',
      listingId: 'listing-research',
      requestTenantId: fixture.sourceTenantId,
      moderatorActorRef: fixture.sourceActorRef,
      reason: 'cross-tenant moderation',
    })).toThrow(/^Marketplace authorization denied$/);
    expect(fixture.market.listOpenReports(
      fixture.moderationTenantId,
      fixture.moderatorActorRef,
    )).toHaveLength(1);

    fixture.market.takeDown({
      actionId: 'action-1',
      reportId: 'report-1',
      listingId: 'listing-research',
      requestTenantId: fixture.moderationTenantId,
      moderatorActorRef: fixture.moderatorActorRef,
      reason: 'Human review confirmed the provenance disclosure is insufficient.',
    });
    expect(fixture.market.browse()).toEqual([]);
    expect(() => fixture.market.authorizeInstall({
      attemptId: 'attempt-after-takedown',
      listingId: 'listing-research',
      targetTenantId: fixture.targetTenantId,
      gate: installGate(fixture),
    })).toThrow(/unavailable for installation/i);
    fixture.market.close();
  });
});

describe('[MARKETPLACE-P3-DRY-RUN] author claims, orders, and reconciliation', () => {
  it('requires a separately verified author claim and reconciles an exact dry-run debit and credit', () => {
    const fixture = setup();
    registerAndPublish(fixture);
    const claim = fixture.market.declareAuthorClaim({
      claimId: 'claim-research',
      listingId: 'listing-research',
      sourceTenantId: fixture.sourceTenantId,
      claimantActorRef: fixture.sourceActorRef,
      declarationEvidenceDigest: digest,
    });
    expect(claim.status).toBe('pending');
    expect(() => fixture.market.createDryRunOffer({
      offerId: 'offer-too-early', claimId: claim.claimId,
      sourceTenantId: fixture.sourceTenantId, actorRef: fixture.sourceActorRef, priceCents: 9_900,
    })).toThrow(/verified author claim/i);

    const verified = fixture.market.verifyAuthorClaim({
      claimId: claim.claimId,
      requestTenantId: fixture.moderationTenantId,
      moderatorActorRef: fixture.moderatorActorRef,
      verificationEvidenceDigest: 'b'.repeat(64),
    });
    expect(verified).toMatchObject({ status: 'verified', verificationEvidenceDigest: 'b'.repeat(64) });
    const offer = fixture.market.createDryRunOffer({
      offerId: 'offer-research', claimId: claim.claimId,
      sourceTenantId: fixture.sourceTenantId, actorRef: fixture.sourceActorRef, priceCents: 9_900,
    });
    expect(offer).toMatchObject({ priceCents: 9_900, currency: 'CNY', mode: 'dry_run', status: 'active' });

    fixture.market.authorizeInstall({
      attemptId: 'attempt-commerce', listingId: 'listing-research',
      targetTenantId: fixture.targetTenantId, gate: installGate(fixture),
    });
    const order = fixture.market.placeDryRunOrder({
      orderId: 'order-research', offerId: offer.offerId, installAttemptId: 'attempt-commerce',
      buyerTenantId: fixture.targetTenantId, buyerActorRef: fixture.targetActorRef,
      termsDigest: 'c'.repeat(64),
    });
    expect(order).toMatchObject({
      listingId: 'listing-research', amountCents: 9_900, currency: 'CNY', mode: 'dry_run', status: 'placed',
    });
    const settlement = fixture.market.settleDryRunOrder({
      settlementId: 'settlement-research', orderId: order.orderId,
      sourceTenantId: fixture.sourceTenantId, actorRef: fixture.sourceActorRef,
    });
    expect(settlement).toMatchObject({ amountCents: 9_900, currency: 'CNY', mode: 'dry_run' });
    expect(fixture.market.dryRunOrder(order.orderId)?.status).toBe('settled');
    expect(fixture.market.reconcileDryRunSettlement({
      settlementId: settlement.settlementId,
      requestTenantId: fixture.sourceTenantId,
      actorRef: fixture.sourceActorRef,
    })).toEqual({
      settlementId: 'settlement-research', orderId: 'order-research', mode: 'dry_run', amountCents: 9_900,
      debitCents: 9_900, creditCents: 9_900, signedBalanceCents: 0, reconciled: true,
    });
    expect(() => fixture.market.reconcileDryRunSettlement({
      settlementId: settlement.settlementId,
      requestTenantId: fixture.moderationTenantId,
      actorRef: fixture.moderatorActorRef,
    })).toThrow(/^Marketplace authorization denied$/);
    const bytes = JSON.stringify({ offer, order, settlement });
    for (const forbidden of ['cardNumber', 'bankAccount', 'paymentToken', 'payout', 'invoice', 'webhook']) {
      expect(bytes).not.toContain(forbidden);
    }
    fixture.market.close();
  });

  it('fails closed on forged moderation, missing install approval, replayed settlement, and revoked authorship', () => {
    const fixture = setup();
    registerAndPublish(fixture);
    fixture.market.declareAuthorClaim({
      claimId: 'claim-negative', listingId: 'listing-research', sourceTenantId: fixture.sourceTenantId,
      claimantActorRef: fixture.sourceActorRef, declarationEvidenceDigest: digest,
    });
    expect(() => fixture.market.verifyAuthorClaim({
      claimId: 'claim-negative', requestTenantId: fixture.sourceTenantId,
      moderatorActorRef: fixture.sourceActorRef, verificationEvidenceDigest: digest,
    })).toThrow(/^Marketplace authorization denied$/);
    fixture.market.verifyAuthorClaim({
      claimId: 'claim-negative', requestTenantId: fixture.moderationTenantId,
      moderatorActorRef: fixture.moderatorActorRef, verificationEvidenceDigest: digest,
    });
    const offer = fixture.market.createDryRunOffer({
      offerId: 'offer-negative', claimId: 'claim-negative', sourceTenantId: fixture.sourceTenantId,
      actorRef: fixture.sourceActorRef, priceCents: 19_800,
    });
    expect(() => fixture.market.placeDryRunOrder({
      orderId: 'order-no-install', offerId: offer.offerId, installAttemptId: 'attempt-missing',
      buyerTenantId: fixture.targetTenantId, buyerActorRef: fixture.targetActorRef, termsDigest: digest,
    })).toThrow(/approved exact install attempt/i);

    fixture.market.authorizeInstall({
      attemptId: 'attempt-negative', listingId: 'listing-research',
      targetTenantId: fixture.targetTenantId, gate: installGate(fixture, { gateId: 'gate-commerce-negative' }),
    });
    const order = fixture.market.placeDryRunOrder({
      orderId: 'order-negative', offerId: offer.offerId, installAttemptId: 'attempt-negative',
      buyerTenantId: fixture.targetTenantId, buyerActorRef: fixture.targetActorRef, termsDigest: digest,
    });
    fixture.market.settleDryRunOrder({
      settlementId: 'settlement-negative', orderId: order.orderId,
      sourceTenantId: fixture.sourceTenantId, actorRef: fixture.sourceActorRef,
    });
    expect(() => fixture.market.settleDryRunOrder({
      settlementId: 'settlement-replay', orderId: order.orderId,
      sourceTenantId: fixture.sourceTenantId, actorRef: fixture.sourceActorRef,
    })).toThrow(/placed dry-run order/i);

    const revoked = fixture.market.revokeAuthorClaim({
      claimId: 'claim-negative', sourceTenantId: fixture.sourceTenantId,
      claimantActorRef: fixture.sourceActorRef, reason: 'Author withdrew the verified claim.',
    });
    expect(revoked.status).toBe('revoked');
    expect(fixture.market.dryRunOffer(offer.offerId)?.status).toBe('withdrawn');
    expect(() => fixture.market.placeDryRunOrder({
      orderId: 'order-after-revoke', offerId: offer.offerId, installAttemptId: 'attempt-negative',
      buyerTenantId: fixture.targetTenantId, buyerActorRef: fixture.targetActorRef, termsDigest: digest,
    })).toThrow(/active dry-run offer/i);
    fixture.market.close();
  });
});

function setup(): Fixture {
  const directory = temporaryDirectory();
  const persistence = openPersistence({ dataDirectory: directory, now: () => new Date(at) });
  const source = persistence.identity.createCompany({
    companyName: 'Source Publisher', displayName: 'Source Human', email: uniqueEmail('source'),
  });
  const target = persistence.identity.createCompany({
    companyName: 'Target Installer', displayName: 'Target Human', email: uniqueEmail('target'),
  });
  const reporter = persistence.identity.createCompany({
    companyName: 'Reporter', displayName: 'Reporter Human', email: uniqueEmail('reporter'),
  });
  const moderator = persistence.identity.createCompany({
    companyName: 'Marketplace Operations', displayName: 'Moderator Human', email: uniqueEmail('moderator'),
  });
  const databasePath = persistence.databasePath;
  persistence.close();
  const market = openPublicMarketStore({
    databasePath,
    now: () => new Date(at),
    moderationTenantId: moderator.tenant.id,
  });
  const { pkg, trials } = capabilityPackage(source.tenant.id);
  return {
    market,
    databasePath,
    sourceTenantId: source.tenant.id,
    sourceActorRef: `human:${source.membership.humanUserId}`,
    targetTenantId: target.tenant.id,
    targetActorRef: `human:${target.membership.humanUserId}`,
    reporterTenantId: reporter.tenant.id,
    reporterActorRef: `human:${reporter.membership.humanUserId}`,
    moderationTenantId: moderator.tenant.id,
    moderatorActorRef: `human:${moderator.membership.humanUserId}`,
    pkg,
    trials,
  };
}

function registerAndPublish(fixture: Fixture): void {
  fixture.market.registerVerifiedPackage({
    requestTenantId: fixture.sourceTenantId,
    actorRef: fixture.sourceActorRef,
    package: fixture.pkg,
    trials: fixture.trials,
  });
  fixture.market.publish({
    requestTenantId: fixture.sourceTenantId,
    actorRef: fixture.sourceActorRef,
    listingId: 'listing-research',
    packageId: fixture.pkg.packageId,
    packageVersion: fixture.pkg.packageVersion,
  });
}

function capabilityPackage(tenantId: string): { pkg: CapabilityPackageV1; trials: SkillTrialSystemRecordInput[] } {
  const author: CapabilityPackageAuthorInput = {
    schema: 'hummer.capability-package-author-input',
    version: 1,
    tenantId,
    packageId: 'cap-research',
    packageVersion: 1,
    title: 'Evidence research',
    goal: 'Produce an evidence-grounded synthesis.',
    preset: 'expert-work',
    capabilityTrack: {
      responsibilities: ['Research'], workflows: ['Collect then synthesize'], standards: ['Cite evidence'],
      heuristics: ['Prefer primary sources'], pitfalls: ['Do not invent evidence'], examples: ['A linked report'],
    },
    behaviorTrack: {
      expressionPreferences: ['Be concise'], interactionRules: ['State uncertainty'],
      corrections: [{ scene: 'No source', wrong: 'Claim certainty', correct: 'Flag uncertainty' }],
    },
    runtimeProfile: 'runtime-default',
    toolIds: ['web-read'],
    requiredCapabilities: ['network.read'],
    acceptanceCriteria: ['Every material claim has evidence.'],
    sourceBoundary: {
      apps: ['Private Browser Name'], windows: ['Private Research Window'],
      includePaths: ['workspace/private-source'], excludePaths: ['workspace/secrets'],
    },
    provenance: {
      demoSessionIds: ['demo-private-1'], expertActorRef: 'expert:private-alice', nodeId: 'node-private-1',
      device: 'private-laptop', runtime: 'codex', runtimeVersion: '1.0.0', agentVersion: '1.0.0', capturedAt: at,
    },
    evidenceRefs: ['evi-private-1'],
    failureNotes: ['Evidence absence fails closed.'],
    declaredPermissions: [{ capability: 'network.read', access: 'read', paths: [] }],
    regressionSuiteRef: 'suite-1',
    receiptRef: 'receipt-1',
    status: 'verified',
    deletionAudit: {},
  };
  const packageDigest = computeCapabilityPackageDigest(author);
  const trials = Array.from({ length: 5 }, (_, index): SkillTrialSystemRecordInput => ({
    schema: 'hummer.skill-trial-system-record-input',
    version: 1,
    tenantId,
    trialId: `trial-${index + 1}`,
    packageId: author.packageId,
    packageVersion: author.packageVersion,
    packageDigest,
    recordedBy: 'system:skill-trial',
    mode: 'shadow',
    ok: true,
    startedAt: `2026-10-07T09:5${index}:00Z`,
    endedAt: `2026-10-07T09:5${index}:30Z`,
    environment: {
      nodeId: 'node-trial', os: 'win32', runtime: 'codex', runtimeVersion: '1.0.0', appVersions: { browser: '1.2.3' },
    },
    receiptRef: `receipt-trial-${index + 1}`,
  }));
  const trialRecord = createTrialRecordFromSystemTrials(trials, { passed: true, evidenceDigest: digest });
  return {
    trials,
    pkg: {
      ...author,
      schema: 'hummer.capability-package',
      status: 'shared',
      packageDigest,
      trialRecord,
    },
  };
}

function installGate(
  fixture: Fixture,
  overrides: Partial<CapabilityInstallGateInput> = {},
): CapabilityInstallGateInput {
  const share: TeamReadOnlyShare = {
    schema: 'hummer.capability-team-share',
    version: 1,
    shareId: overrides.gateId ? `share-${overrides.gateId}` : 'share-public-install',
    sourceTenantId: fixture.sourceTenantId,
    targetTenantId: fixture.targetTenantId,
    packageId: fixture.pkg.packageId,
    packageVersion: fixture.pkg.packageVersion,
    invitation: {
      invitationId: overrides.gateId ? `invite-${overrides.gateId}` : 'invite-public-install',
      sourceTenantId: fixture.sourceTenantId,
      targetTenantId: fixture.targetTenantId,
      packageId: fixture.pkg.packageId,
      packageVersion: fixture.pkg.packageVersion,
      packageDigest: fixture.pkg.packageDigest,
      status: 'accepted',
      expiresAt: '2026-10-08T10:00:00Z',
      evidenceDigest: digest,
    },
    access: 'read_only',
    allowEdit: false,
    allowCopyToTenant: false,
    packageDigest: fixture.pkg.packageDigest,
    shareDigest: digest,
    package: fixture.pkg,
    sharedByActorRef: fixture.sourceActorRef,
    sharedAt: '2026-10-07T09:59:00Z',
  };
  share.shareDigest = computeTeamReadOnlyShareDigest(share);
  const gate: CapabilityInstallGateInput = {
    schema: 'hummer.capability-install-gate-input',
    version: 1,
    gateId: 'gate-public-install',
    share,
    recordedBy: 'system:capability-install-gate',
    requestDigest: digest,
    shareDigest: share.shareDigest,
    exportDescriptor: {
      format: 'agent-skills', installEntry: 'manifest.json',
      fileDigests: {
        'SKILL.md': digest, 'work.md': digest, 'behavior.md': digest, 'work_skill.md': digest,
        'behavior_skill.md': digest, 'manifest.json': digest, 'meta.json': digest, 'receipt.json': digest,
      },
      containsRawRecording: false, containsCredentials: false, containsUnredactedCustomerData: false,
    },
    targetTenantId: fixture.targetTenantId,
    requestedByActorRef: fixture.targetActorRef,
    staticCheck: { status: 'passed', evidenceDigest: digest, findings: [] },
    permissionReview: { approvedPermissions: fixture.pkg.declaredPermissions, deniedPermissions: [], evidenceDigest: digest },
    sourceVerification: {
      provenance: { status: 'passed', evidenceDigest: digest },
      receipt: { status: 'passed', evidenceDigest: digest },
      packageDigest: { status: 'passed', evidenceDigest: digest },
      invitation: { status: 'passed', evidenceDigest: digest },
      regression: { status: 'passed', evidenceDigest: digest },
    },
    evaluatedAt: at,
    ...overrides,
  };
  gate.requestDigest = computeCapabilityInstallRequestDigest(gate);
  return gate;
}

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'hummer-public-market-'));
  temporaryDirectories.push(directory);
  return directory;
}

let emailSequence = 0;
function uniqueEmail(prefix: string): string {
  emailSequence += 1;
  return `${prefix}-${emailSequence}@example.test`;
}

function directTakedown(databasePath: string, listingId: string): void {
  const require = createRequire(import.meta.url);
  const Database = require('better-sqlite3') as new (path: string) => {
    prepare(sql: string): { run(...params: unknown[]): unknown };
    close(): void;
  };
  const database = new Database(databasePath);
  try {
    database.prepare("UPDATE listings SET status = 'taken_down' WHERE listing_id = ?").run(listingId);
  } finally {
    database.close();
  }
}
