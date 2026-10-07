import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import { openPersistence } from '../../desktop/src/persistence/database.js';
import { openPublicMarketStore, type PublicMarketStore } from '../../../packages/public-market/src/index.js';
import { isPublicCapabilityListing } from '../../../src/features/capabilities/publicMarketResponseValidator.js';
import { createStaticBadgeTokenAuthenticator, type BadgeScope } from '../src/badge-auth.js';
import { createFleetRelayServer, type PublicMarketplaceHttpPort } from '../src/fastify-transport.js';
import type { FleetIngress } from '../src/ports.js';

const at = '2026-10-07T10:00:00.000Z';
const digest = 'a'.repeat(64);
const temporaryDirectories: string[] = [];

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

describe('[PUBLIC-MARKET-HTTP-E2E] public Relay surface and protected moderation', () => {
  it('keeps reports non-destructive, requires a human moderator, then hides and blocks install after takedown', async () => {
    const fixture = setup();
    const { app } = server(fixture);

    const browse = await app.inject({ method: 'GET', url: '/v1/public/capabilities' });
    expect(browse.statusCode).toBe(200);
    const projection = browse.json<{ listings: unknown[] }>().listings[0];
    expect(isPublicCapabilityListing(projection)).toBe(true);
    const publicBytes = JSON.stringify(projection);
    for (const secret of [fixture.sourceTenantId, fixture.pkg.provenance.expertActorRef, fixture.pkg.provenance.nodeId, fixture.pkg.provenance.device]) {
      expect(publicBytes).not.toContain(secret);
    }

    const unknown = { ...(projection as Record<string, unknown>), tenantId: fixture.sourceTenantId };
    expect(isPublicCapabilityListing(unknown)).toBe(false);
    const missing = { ...(projection as Record<string, unknown>) };
    delete missing.trialRecord;
    expect(isPublicCapabilityListing(missing)).toBe(false);

    const detail = await app.inject({ method: 'GET', url: '/v1/public/capabilities/listing-research' });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().listing.title).toBe('Evidence research');

    const report = await app.inject({
      method: 'POST', url: '/v1/public/capabilities/listing-research/reports',
      headers: { authorization: 'Bearer reporter-token' },
      payload: { reportId: 'report-http-1', reason: 'Provenance needs human review.' },
    });
    expect(report.statusCode).toBe(200);
    expect(report.json()).toEqual({ report: { reportId: 'report-http-1', listingId: 'listing-research', status: 'open', createdAt: at } });
    expect(JSON.stringify(report.json())).not.toContain(fixture.reporterTenantId);
    expect((await app.inject({ method: 'GET', url: '/v1/public/capabilities' })).json().listings).toHaveLength(1);

    const publicCannotModerate = await app.inject({
      method: 'POST', url: '/v1/marketplace/moderation/listings/listing-research/takedown',
      payload: { actionId: 'action-forged', reportId: 'report-http-1', reason: 'no badge' },
    });
    expect(publicCannotModerate.statusCode).toBe(401);

    const wrongScope = await app.inject({
      method: 'GET', url: '/v1/marketplace/moderation/reports',
      headers: { authorization: 'Bearer reporter-token' },
    });
    expect(wrongScope.statusCode).toBe(403);

    const reports = await app.inject({
      method: 'GET', url: '/v1/marketplace/moderation/reports',
      headers: { authorization: 'Bearer moderator-token' },
    });
    expect(reports.statusCode).toBe(200);
    expect(reports.json().reports).toHaveLength(1);

    const takedown = await app.inject({
      method: 'POST', url: '/v1/marketplace/moderation/listings/listing-research/takedown',
      headers: { authorization: 'Bearer moderator-token' },
      payload: { actionId: 'action-http-1', reportId: 'report-http-1', reason: 'Human review confirmed insufficient disclosure.' },
    });
    expect(takedown.statusCode).toBe(200);
    expect(takedown.json()).toEqual({ status: 'taken_down' });

    expect((await app.inject({ method: 'GET', url: '/v1/public/capabilities' })).json().listings).toEqual([]);
    expect((await app.inject({ method: 'GET', url: '/v1/public/capabilities/listing-research' })).statusCode).toBe(404);
    const installAfterTakedown = await app.inject({
      method: 'POST', url: '/v1/public/capabilities/listing-research/install-authorizations',
      headers: { authorization: 'Bearer installer-token' },
      payload: { attemptId: 'attempt-http-after', targetTenantId: fixture.targetTenantId, gate: installGate(fixture) },
    });
    expect(installAfterTakedown.statusCode).toBe(404);
    expect(installAfterTakedown.json().error.code).toBe('public_listing_not_found');

    await app.close();
    fixture.market.close();
  });

  it('exposes claim-verified dry-run commerce while rejecting payment fields and wrong roles', async () => {
    const fixture = setup();
    const { app } = server(fixture);

    const unknownField = await app.inject({
      method: 'POST', url: '/v1/marketplace/author-claims',
      headers: { authorization: 'Bearer source-commerce-token' },
      payload: {
        claimId: 'claim-http', listingId: 'listing-research', declarationEvidenceDigest: digest,
        autoVerify: true,
      },
    });
    expect(unknownField.statusCode).toBe(400);

    const claim = await app.inject({
      method: 'POST', url: '/v1/marketplace/author-claims',
      headers: { authorization: 'Bearer source-commerce-token' },
      payload: { claimId: 'claim-http', listingId: 'listing-research', declarationEvidenceDigest: digest },
    });
    expect(claim.statusCode).toBe(200);
    expect(claim.json().claim.status).toBe('pending');

    const selfVerify = await app.inject({
      method: 'POST', url: '/v1/marketplace/author-claims/claim-http/verify',
      headers: { authorization: 'Bearer source-commerce-token' },
      payload: { verificationEvidenceDigest: digest },
    });
    expect(selfVerify.statusCode).toBe(403);
    const verified = await app.inject({
      method: 'POST', url: '/v1/marketplace/author-claims/claim-http/verify',
      headers: { authorization: 'Bearer moderator-token' },
      payload: { verificationEvidenceDigest: 'b'.repeat(64) },
    });
    expect(verified.statusCode).toBe(200);
    expect(verified.json().claim.status).toBe('verified');

    const offer = await app.inject({
      method: 'POST', url: '/v1/marketplace/offers',
      headers: { authorization: 'Bearer source-commerce-token' },
      payload: { offerId: 'offer-http', claimId: 'claim-http', priceCents: 9_900 },
    });
    expect(offer.statusCode).toBe(200);
    expect(offer.json().offer).toMatchObject({ priceCents: 9_900, currency: 'CNY', mode: 'dry_run' });

    const install = await app.inject({
      method: 'POST', url: '/v1/public/capabilities/listing-research/install-authorizations',
      headers: { authorization: 'Bearer installer-token' },
      payload: { attemptId: 'attempt-http-commerce', targetTenantId: fixture.targetTenantId, gate: installGate(fixture) },
    });
    expect(install.statusCode).toBe(200);

    const paymentField = await app.inject({
      method: 'POST', url: '/v1/marketplace/orders',
      headers: { authorization: 'Bearer buyer-commerce-token' },
      payload: {
        orderId: 'order-forbidden', offerId: 'offer-http', installAttemptId: 'attempt-http-commerce',
        termsDigest: 'c'.repeat(64), paymentToken: 'forbidden',
      },
    });
    expect(paymentField.statusCode).toBe(400);

    const order = await app.inject({
      method: 'POST', url: '/v1/marketplace/orders',
      headers: { authorization: 'Bearer buyer-commerce-token' },
      payload: {
        orderId: 'order-http', offerId: 'offer-http', installAttemptId: 'attempt-http-commerce',
        termsDigest: 'c'.repeat(64),
      },
    });
    expect(order.statusCode).toBe(200);
    expect(order.json().order).toMatchObject({ amountCents: 9_900, currency: 'CNY', mode: 'dry_run', status: 'placed' });

    const buyerCannotSettle = await app.inject({
      method: 'POST', url: '/v1/marketplace/orders/order-http/settlements',
      headers: { authorization: 'Bearer buyer-commerce-token' }, payload: { settlementId: 'settlement-wrong-role' },
    });
    expect(buyerCannotSettle.statusCode).toBe(403);
    const settlement = await app.inject({
      method: 'POST', url: '/v1/marketplace/orders/order-http/settlements',
      headers: { authorization: 'Bearer source-commerce-token' }, payload: { settlementId: 'settlement-http' },
    });
    expect(settlement.statusCode).toBe(200);
    expect(settlement.json().settlement.mode).toBe('dry_run');

    const reconciliation = await app.inject({
      method: 'GET', url: '/v1/marketplace/settlements/settlement-http/reconciliation',
      headers: { authorization: 'Bearer source-commerce-token' },
    });
    expect(reconciliation.statusCode).toBe(200);
    expect(reconciliation.json().reconciliation).toMatchObject({
      amountCents: 9_900, debitCents: 9_900, creditCents: 9_900,
      signedBalanceCents: 0, reconciled: true, mode: 'dry_run',
    });
    const crossTenantReconciliation = await app.inject({
      method: 'GET', url: '/v1/marketplace/settlements/settlement-http/reconciliation',
      headers: { authorization: 'Bearer moderator-settle-token' },
    });
    expect(crossTenantReconciliation.statusCode).toBe(403);
    expect(JSON.stringify({
      claim: claim.json(), offer: offer.json(), order: order.json(), settlement: settlement.json(),
    })).not.toMatch(/paymentToken|cardNumber|bankAccount|payout|invoice|webhook/i);

    await app.close();
    fixture.market.close();
  });

  it('returns an explicit unavailable response instead of fallback data when no market adapter is configured', async () => {
    const { app } = createFleetRelayServer({} as FleetIngress, {
      authenticator: createStaticBadgeTokenAuthenticator([]),
      now: () => new Date(at),
    });
    const response = await app.inject({ method: 'GET', url: '/v1/public/capabilities' });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('public_market_unavailable');
    await app.close();
  });
});

interface Fixture {
  market: PublicMarketStore;
  sourceTenantId: string;
  sourceActorRef: string;
  targetTenantId: string;
  targetActorRef: string;
  reporterTenantId: string;
  reporterActorRef: string;
  moderationTenantId: string;
  moderatorActorRef: string;
  pkg: CapabilityPackageV1;
}

function setup(): Fixture {
  const directory = mkdtempSync(join(tmpdir(), 'hummer-public-market-http-'));
  temporaryDirectories.push(directory);
  const persistence = openPersistence({ dataDirectory: directory, now: () => new Date(at) });
  const source = persistence.identity.createCompany({ companyName: 'Publisher', displayName: 'Publisher', email: 'publisher-http@example.test' });
  const target = persistence.identity.createCompany({ companyName: 'Installer', displayName: 'Installer', email: 'installer-http@example.test' });
  const reporter = persistence.identity.createCompany({ companyName: 'Reporter', displayName: 'Reporter', email: 'reporter-http@example.test' });
  const moderator = persistence.identity.createCompany({ companyName: 'Operations', displayName: 'Moderator', email: 'moderator-http@example.test' });
  const databasePath = persistence.databasePath;
  persistence.close();
  const market = openPublicMarketStore({ databasePath, moderationTenantId: moderator.tenant.id, now: () => new Date(at) });
  const { pkg, trials } = capabilityPackage(source.tenant.id);
  const sourceActorRef = `human:${source.membership.humanUserId}`;
  market.registerVerifiedPackage({ requestTenantId: source.tenant.id, actorRef: sourceActorRef, package: pkg, trials });
  market.publish({ requestTenantId: source.tenant.id, actorRef: sourceActorRef, listingId: 'listing-research', packageId: pkg.packageId, packageVersion: pkg.packageVersion });
  return {
    market, sourceTenantId: source.tenant.id, sourceActorRef,
    targetTenantId: target.tenant.id, targetActorRef: `human:${target.membership.humanUserId}`,
    reporterTenantId: reporter.tenant.id, reporterActorRef: `human:${reporter.membership.humanUserId}`,
    moderationTenantId: moderator.tenant.id, moderatorActorRef: `human:${moderator.membership.humanUserId}`, pkg,
  };
}

function server(fixture: Fixture) {
  const publicMarket: PublicMarketplaceHttpPort = {
    browse: () => fixture.market.browse() as unknown as readonly Readonly<Record<string, unknown>>[],
    report: (input) => fixture.market.report(input) as unknown as Readonly<Record<string, unknown>>,
    listOpenReports: (tenantId, actorRef) => fixture.market.listOpenReports(tenantId, actorRef) as unknown as readonly Readonly<Record<string, unknown>>[],
    takeDown: (input) => fixture.market.takeDown(input),
    authorizeInstall: (input) => fixture.market.authorizeInstall({ ...input, gate: input.gate as CapabilityInstallGateInput }) as unknown as Readonly<Record<string, unknown>>,
    declareAuthorClaim: (input) => fixture.market.declareAuthorClaim(input) as unknown as Readonly<Record<string, unknown>>,
    verifyAuthorClaim: (input) => fixture.market.verifyAuthorClaim(input) as unknown as Readonly<Record<string, unknown>>,
    revokeAuthorClaim: (input) => fixture.market.revokeAuthorClaim(input) as unknown as Readonly<Record<string, unknown>>,
    createDryRunOffer: (input) => fixture.market.createDryRunOffer(input) as unknown as Readonly<Record<string, unknown>>,
    withdrawDryRunOffer: (input) => fixture.market.withdrawDryRunOffer(input) as unknown as Readonly<Record<string, unknown>>,
    placeDryRunOrder: (input) => fixture.market.placeDryRunOrder(input) as unknown as Readonly<Record<string, unknown>>,
    settleDryRunOrder: (input) => fixture.market.settleDryRunOrder(input) as unknown as Readonly<Record<string, unknown>>,
    reconcileDryRunSettlement: (input) => fixture.market.reconcileDryRunSettlement(input) as unknown as Readonly<Record<string, unknown>>,
  };
  return createFleetRelayServer({} as FleetIngress, {
    publicMarket,
    now: () => new Date(at),
    authenticator: createStaticBadgeTokenAuthenticator([
      badge('reporter-token', fixture.reporterTenantId, fixture.reporterActorRef, ['marketplace.report']),
      badge('moderator-token', fixture.moderationTenantId, fixture.moderatorActorRef, ['marketplace.moderate']),
      badge('installer-token', fixture.targetTenantId, fixture.targetActorRef, ['capability.install.evaluate']),
      badge('source-commerce-token', fixture.sourceTenantId, fixture.sourceActorRef, [
        'marketplace.claim', 'marketplace.offer', 'marketplace.settle',
      ]),
      badge('buyer-commerce-token', fixture.targetTenantId, fixture.targetActorRef, ['marketplace.order']),
      badge('moderator-settle-token', fixture.moderationTenantId, fixture.moderatorActorRef, ['marketplace.settle']),
    ]),
  });
}

function badge(token: string, tenantId: string, actorRef: string, scopes: BadgeScope[]) {
  return { token, tokenId: `token-${token}`, tenantId, actorRef, scopes, expiresAt: '2026-10-08T10:00:00.000Z' };
}

function capabilityPackage(tenantId: string): { pkg: CapabilityPackageV1; trials: SkillTrialSystemRecordInput[] } {
  const author: CapabilityPackageAuthorInput = {
    schema: 'hummer.capability-package-author-input', version: 1, tenantId, packageId: 'cap-research', packageVersion: 1,
    title: 'Evidence research', goal: 'Produce an evidence-grounded synthesis.', preset: 'expert-work',
    capabilityTrack: { responsibilities: ['Research'], workflows: ['Collect'], standards: ['Cite'], heuristics: ['Primary sources'], pitfalls: ['No invention'], examples: ['Linked report'] },
    behaviorTrack: { expressionPreferences: ['Concise'], interactionRules: ['State uncertainty'], corrections: [{ scene: 'No source', wrong: 'Certainty', correct: 'Flag uncertainty' }] },
    runtimeProfile: 'runtime-default', toolIds: ['web-read'], requiredCapabilities: ['network.read'], acceptanceCriteria: ['Claims have evidence'],
    sourceBoundary: { apps: ['Private Browser'], windows: ['Private Window'], includePaths: ['private/source'], excludePaths: ['private/secret'] },
    provenance: { demoSessionIds: ['demo-private'], expertActorRef: 'expert:private', nodeId: 'node-private', device: 'private-device', runtime: 'codex', runtimeVersion: '0.153.4', agentVersion: '1.0.0', capturedAt: at },
    evidenceRefs: ['evi-private'], failureNotes: ['Missing evidence fails closed.'], declaredPermissions: [{ capability: 'network.read', access: 'read', paths: [] }],
    regressionSuiteRef: 'suite-1', receiptRef: 'receipt-1', status: 'verified', deletionAudit: {},
  };
  const packageDigest = computeCapabilityPackageDigest(author);
  const trials = Array.from({ length: 5 }, (_, index): SkillTrialSystemRecordInput => ({
    schema: 'hummer.skill-trial-system-record-input', version: 1, tenantId, trialId: `trial-http-${index + 1}`,
    packageId: author.packageId, packageVersion: author.packageVersion, packageDigest, recordedBy: 'system:skill-trial', mode: 'shadow', ok: true,
    startedAt: `2026-10-07T09:5${index}:00Z`, endedAt: `2026-10-07T09:5${index}:30Z`,
    environment: { nodeId: 'node-trial', os: 'win32', runtime: 'codex', runtimeVersion: '0.153.4', appVersions: {} }, receiptRef: `receipt-${index + 1}`,
  }));
  return { pkg: { ...author, schema: 'hummer.capability-package', status: 'shared', packageDigest, trialRecord: createTrialRecordFromSystemTrials(trials, { passed: true, evidenceDigest: digest }) }, trials };
}

function installGate(fixture: Fixture): CapabilityInstallGateInput {
  const share: TeamReadOnlyShare = {
    schema: 'hummer.capability-team-share', version: 1, shareId: 'share-http', sourceTenantId: fixture.sourceTenantId, targetTenantId: fixture.targetTenantId,
    packageId: fixture.pkg.packageId, packageVersion: fixture.pkg.packageVersion,
    invitation: { invitationId: 'invite-http', sourceTenantId: fixture.sourceTenantId, targetTenantId: fixture.targetTenantId, packageId: fixture.pkg.packageId, packageVersion: fixture.pkg.packageVersion, packageDigest: fixture.pkg.packageDigest, status: 'accepted', expiresAt: '2026-10-08T10:00:00Z', evidenceDigest: digest },
    access: 'read_only', allowEdit: false, allowCopyToTenant: false, packageDigest: fixture.pkg.packageDigest, shareDigest: digest,
    package: fixture.pkg, sharedByActorRef: fixture.sourceActorRef, sharedAt: at,
  };
  share.shareDigest = computeTeamReadOnlyShareDigest(share);
  const gate: CapabilityInstallGateInput = {
    schema: 'hummer.capability-install-gate-input', version: 1, gateId: 'gate-http', share, recordedBy: 'system:capability-install-gate',
    requestDigest: digest, shareDigest: share.shareDigest,
    exportDescriptor: { format: 'agent-skills', installEntry: 'manifest.json', fileDigests: { 'SKILL.md': digest, 'work.md': digest, 'behavior.md': digest, 'work_skill.md': digest, 'behavior_skill.md': digest, 'manifest.json': digest, 'meta.json': digest, 'receipt.json': digest }, containsRawRecording: false, containsCredentials: false, containsUnredactedCustomerData: false },
    targetTenantId: fixture.targetTenantId, requestedByActorRef: fixture.targetActorRef,
    staticCheck: { status: 'passed', evidenceDigest: digest, findings: [] }, permissionReview: { approvedPermissions: fixture.pkg.declaredPermissions, deniedPermissions: [], evidenceDigest: digest },
    sourceVerification: { provenance: { status: 'passed', evidenceDigest: digest }, receipt: { status: 'passed', evidenceDigest: digest }, packageDigest: { status: 'passed', evidenceDigest: digest }, invitation: { status: 'passed', evidenceDigest: digest }, regression: { status: 'passed', evidenceDigest: digest } }, evaluatedAt: at,
  };
  gate.requestDigest = computeCapabilityInstallRequestDigest(gate);
  return gate;
}
