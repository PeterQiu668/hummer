import { createHash } from 'node:crypto';
import {
  createCapabilityInstallGateDecision,
  createTrialRecordFromSystemTrials,
  validateCapabilityContract,
  type CapabilityInstallGateDecision,
  type CapabilityInstallGateInput,
  type CapabilityPackageV1,
  type SkillTrialSystemRecordInput,
} from '@hummer/contracts';
import { createRequire } from 'node:module';

interface SqliteRunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

interface SqliteStatement {
  run(...params: unknown[]): SqliteRunResult;
  get<T = unknown>(...params: unknown[]): T | undefined;
  all<T = unknown>(...params: unknown[]): T[];
}

interface SqliteDatabase {
  close(): void;
  pragma(source: string, options?: { simple?: boolean }): unknown;
  prepare(sql: string): SqliteStatement;
  transaction<TArgs extends unknown[], TResult>(fn: (...args: TArgs) => TResult): (...args: TArgs) => TResult;
}

interface SqliteConstructor {
  new (path: string): SqliteDatabase;
}

export interface OpenPublicMarketOptions {
  databasePath: string;
  moderationTenantId: string;
  now?: () => Date;
}

export interface RegisterPublicCapabilityInput {
  requestTenantId: string;
  actorRef: string;
  package: CapabilityPackageV1;
  trials: readonly SkillTrialSystemRecordInput[];
}

export interface PublishPublicListingInput {
  requestTenantId: string;
  actorRef: string;
  listingId: string;
  packageId: string;
  packageVersion: number;
}

export interface PublicCapabilityProjection {
  schema: 'hummer.public-capability-listing';
  version: 1;
  listingId: string;
  status: 'public';
  packageId: string;
  packageVersion: number;
  packageDigest: string;
  integrity: { kind: 'package_digest'; digest: string };
  title: string;
  goal: string;
  publisherRef: string;
  provenance: {
    capturedAt: string;
    runtime: string;
    runtimeVersion: string;
    agentVersion: string;
    demoSessionCount: number;
  };
  sourceBoundary: {
    applicationCount: number;
    windowPatternCount: number;
    includePathCount: number;
    excludePathCount: number;
  };
  trialRecord: {
    shadowRuns: number;
    success: number;
    failure: number;
    lastRunAt: string;
    regressionPassed: boolean;
    regressionEvidenceDigest: string;
  };
  failureNotes: Array<{ summary: 'Publisher-recorded failure note'; digest: string }>;
  declaredPermissions: CapabilityPackageV1['declaredPermissions'];
  receiptRef: string;
  evidenceCount: number;
  publishedAt: string;
}

export interface MarketplaceReportRecord {
  reportId: string;
  listingId: string;
  reporterTenantId: string;
  reporterActorRef: string;
  reason: string;
  status: 'open' | 'resolved_actioned';
  createdAt: string;
  resolvedAt: string | null;
}

export interface MarketplaceAuthorClaimRecord {
  claimId: string;
  listingId: string;
  sourceTenantId: string;
  claimantActorRef: string;
  status: 'pending' | 'verified' | 'revoked';
  declarationEvidenceDigest: string;
  verificationEvidenceDigest: string | null;
  declaredAt: string;
  verifiedAt: string | null;
  revokedAt: string | null;
  revocationReason: string | null;
}

export interface MarketplaceDryRunOffer {
  offerId: string;
  listingId: string;
  claimId: string;
  sourceTenantId: string;
  priceCents: number;
  currency: 'CNY';
  mode: 'dry_run';
  status: 'active' | 'withdrawn';
  createdAt: string;
  withdrawnAt: string | null;
}

export interface MarketplaceDryRunOrder {
  orderId: string;
  offerId: string;
  listingId: string;
  installAttemptId: string;
  sourceTenantId: string;
  buyerTenantId: string;
  buyerActorRef: string;
  amountCents: number;
  currency: 'CNY';
  mode: 'dry_run';
  status: 'placed' | 'settled';
  termsDigest: string;
  createdAt: string;
  settledAt: string | null;
}

export interface MarketplaceDryRunSettlement {
  settlementId: string;
  orderId: string;
  listingId: string;
  sourceTenantId: string;
  buyerTenantId: string;
  amountCents: number;
  currency: 'CNY';
  mode: 'dry_run';
  createdAt: string;
}

export interface MarketplaceDryRunReconciliation {
  settlementId: string;
  orderId: string;
  mode: 'dry_run';
  amountCents: number;
  debitCents: number;
  creditCents: number;
  signedBalanceCents: number;
  reconciled: boolean;
}

interface PackageRow {
  source_tenant_id: string;
  package_id: string;
  package_version: number;
  package_digest: string;
  package_json: string;
  integrity_digest: string;
}

interface ListingRow extends PackageRow {
  listing_id: string;
  status: 'public' | 'taken_down';
  public_projection_json: string;
  published_at: string;
}

interface ReportRow {
  report_id: string;
  listing_id: string;
  reporter_tenant_id: string;
  reporter_actor_ref: string;
  reason: string;
  status: 'open' | 'resolved_actioned';
  created_at: string;
  resolved_at: string | null;
}

interface AuthorClaimRow {
  claim_id: string;
  listing_id: string;
  source_tenant_id: string;
  claimant_actor_ref: string;
  declaration_evidence_digest: string;
  status: 'pending' | 'verified' | 'revoked';
  declared_at: string;
  verification_evidence_digest: string | null;
  verified_at: string | null;
  revoked_at: string | null;
  revocation_reason: string | null;
}

interface OfferRow {
  offer_id: string;
  listing_id: string;
  claim_id: string;
  source_tenant_id: string;
  price_cents: number;
  currency: 'CNY';
  mode: 'dry_run';
  status: 'active' | 'withdrawn';
  created_at: string;
  withdrawn_at: string | null;
}

interface OrderRow {
  order_id: string;
  offer_id: string;
  listing_id: string;
  install_attempt_id: string;
  source_tenant_id: string;
  buyer_tenant_id: string;
  buyer_actor_ref: string;
  amount_cents: number;
  currency: 'CNY';
  mode: 'dry_run';
  status: 'placed' | 'settled';
  terms_digest: string;
  created_at: string;
  settled_at: string | null;
}

interface SettlementRow {
  settlement_id: string;
  order_id: string;
  listing_id: string;
  source_tenant_id: string;
  buyer_tenant_id: string;
  amount_cents: number;
  currency: 'CNY';
  mode: 'dry_run';
  created_at: string;
}

/**
 * Local W10 persistence kernel. Public callers receive a redacted projection;
 * the complete package remains tenant-owned and is only used by the trusted
 * install gate.
 */
export class PublicMarketStore {
  constructor(
    private readonly database: SqliteDatabase,
    private readonly now: () => Date,
    private readonly moderationTenantId: string,
  ) {}

  close(): void {
    this.database.close();
  }

  registerVerifiedPackage(input: RegisterPublicCapabilityInput): void {
    this.requireTenantHuman(input.requestTenantId, input.actorRef);
    requireSameTenant(input.requestTenantId, input.package.tenantId);
    const checked = validateCapabilityContract('CapabilityPackageV1', input.package);
    if (checked.issues) throw new Error(`Public package is invalid: ${checked.issues[0]?.message}`);
    const pkg = checked.value;
    if (pkg.status !== 'shared') throw new Error('Only a verified shared package can enter the public marketplace');
    if (pkg.trialRecord.shadowRuns < 5 || pkg.trialRecord.failure !== 0 ||
        pkg.trialRecord.success !== pkg.trialRecord.shadowRuns || !pkg.trialRecord.regressionPassed) {
      throw new Error('Public package must have five successful shadow trials and a passing regression');
    }

    const trials = input.trials.map((trial) => {
      const result = validateCapabilityContract('SkillTrialSystemRecordInput', trial);
      if (result.issues) throw new Error(`Public package contains an invalid system trial: ${result.issues[0]?.message}`);
      if (trial.tenantId !== pkg.tenantId || trial.packageId !== pkg.packageId ||
          trial.packageVersion !== pkg.packageVersion || trial.packageDigest !== pkg.packageDigest) {
        throw new Error('Skill trial is not bound to the package tenant, identity, version, and digest');
      }
      return result.value;
    });
    const aggregate = createTrialRecordFromSystemTrials(trials, {
      passed: pkg.trialRecord.regressionPassed,
      evidenceDigest: pkg.trialRecord.regressionEvidenceDigest,
    });
    if (canonicalJson(aggregate) !== canonicalJson(pkg.trialRecord)) {
      throw new Error('Public package trial aggregate does not match the persisted system trials');
    }

    const verifiedAt = this.now().toISOString();
    const persist = this.database.transaction(() => {
      this.database.prepare(`
        INSERT INTO capability_packages (
          source_tenant_id, package_id, package_version, package_digest, package_json,
          integrity_kind, integrity_digest, verified_by_actor_ref, verified_at
        ) VALUES (?, ?, ?, ?, ?, 'package_digest', ?, ?, ?)
      `).run(
        pkg.tenantId, pkg.packageId, pkg.packageVersion, pkg.packageDigest, canonicalJson(pkg),
        pkg.packageDigest, input.actorRef, verifiedAt,
      );
      const insertTrial = this.database.prepare(`
        INSERT INTO skill_trials (
          source_tenant_id, package_id, package_version, trial_id, package_digest,
          mode, ok, trial_json, recorded_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const trial of trials) {
        insertTrial.run(
          trial.tenantId, trial.packageId, trial.packageVersion, trial.trialId,
          trial.packageDigest, trial.mode, trial.ok ? 1 : 0, canonicalJson(trial), trial.endedAt,
        );
      }
    });
    persist();
  }

  publish(input: PublishPublicListingInput): PublicCapabilityProjection {
    this.requireTenantHuman(input.requestTenantId, input.actorRef);
    const row = this.packageRow(input.requestTenantId, input.packageId, input.packageVersion);
    if (!row) throw new Error('Verified package is unavailable in the requesting tenant');
    requireSameTenant(input.requestTenantId, row.source_tenant_id);
    const pkg = parsePackage(row.package_json);
    const publishedAt = this.now().toISOString();
    const projection = publicProjection(input.listingId, pkg, row.integrity_digest, publishedAt);
    this.database.prepare(`
      INSERT INTO listings (
        listing_id, source_tenant_id, package_id, package_version, package_digest,
        status, public_projection_json, published_by_actor_ref, published_at
      ) VALUES (?, ?, ?, ?, ?, 'public', ?, ?, ?)
    `).run(
      input.listingId, row.source_tenant_id, row.package_id, row.package_version,
      row.package_digest, canonicalJson(projection), input.actorRef, publishedAt,
    );
    return projection;
  }

  browse(): PublicCapabilityProjection[] {
    return this.database.prepare(`
      SELECT public_projection_json FROM listings
      WHERE status = 'public' ORDER BY published_at, listing_id
    `).all<{ public_projection_json: string }>()
      .map((row) => JSON.parse(row.public_projection_json) as PublicCapabilityProjection);
  }

  report(input: {
    reportId: string;
    listingId: string;
    reporterTenantId: string;
    reporterActorRef: string;
    reason: string;
  }): MarketplaceReportRecord {
    this.requireTenantHuman(input.reporterTenantId, input.reporterActorRef);
    if (!input.reason.trim()) throw new Error('Marketplace report reason is required');
    const listing = this.listingRow(input.listingId);
    if (!listing || listing.status !== 'public') throw new Error('Public listing is unavailable');
    const createdAt = this.now().toISOString();
    this.database.prepare(`
      INSERT INTO marketplace_reports (
        report_id, listing_id, reporter_tenant_id, reporter_actor_ref, reason, status, created_at
      ) VALUES (?, ?, ?, ?, ?, 'open', ?)
    `).run(
      input.reportId, input.listingId, input.reporterTenantId,
      input.reporterActorRef, input.reason.trim(), createdAt,
    );
    return {
      reportId: input.reportId,
      listingId: input.listingId,
      reporterTenantId: input.reporterTenantId,
      reporterActorRef: input.reporterActorRef,
      reason: input.reason.trim(),
      status: 'open',
      createdAt,
      resolvedAt: null,
    };
  }

  listOpenReports(requestTenantId: string, actorRef: string): MarketplaceReportRecord[] {
    this.requireModerator(requestTenantId, actorRef);
    return this.database.prepare(`
      SELECT * FROM marketplace_reports WHERE status = 'open' ORDER BY created_at, report_id
    `).all<ReportRow>().map(mapReport);
  }

  takeDown(input: {
    actionId: string;
    reportId: string;
    listingId: string;
    requestTenantId: string;
    moderatorActorRef: string;
    reason: string;
  }): void {
    this.requireModerator(input.requestTenantId, input.moderatorActorRef);
    if (!input.reason.trim()) throw new Error('Human moderation reason is required');
    const report = this.database.prepare(`
      SELECT * FROM marketplace_reports WHERE report_id = ? AND listing_id = ?
    `).get<ReportRow>(input.reportId, input.listingId);
    if (!report || report.status !== 'open') throw new Error('Open report is unavailable for this listing');
    const listing = this.listingRow(input.listingId);
    if (!listing || listing.status !== 'public') throw new Error('Public listing is unavailable for takedown');
    const decidedAt = this.now().toISOString();
    const apply = this.database.transaction(() => {
      this.database.prepare(`
        INSERT INTO marketplace_moderation_actions (
          action_id, report_id, listing_id, moderation_tenant_id,
          moderator_actor_ref, action, reason, created_at
        ) VALUES (?, ?, ?, ?, ?, 'taken_down', ?, ?)
      `).run(
        input.actionId, input.reportId, input.listingId, input.requestTenantId,
        input.moderatorActorRef, input.reason.trim(), decidedAt,
      );
      this.database.prepare(`
        UPDATE listings SET status = 'taken_down', taken_down_at = ?
        WHERE listing_id = ? AND status = 'public'
      `).run(decidedAt, input.listingId);
      this.database.prepare(`
        UPDATE marketplace_reports SET status = 'resolved_actioned', resolved_at = ?
        WHERE report_id = ? AND status = 'open'
      `).run(decidedAt, input.reportId);
    });
    apply();
  }

  authorizeInstall(input: {
    attemptId: string;
    listingId: string;
    targetTenantId: string;
    gate: CapabilityInstallGateInput;
  }): CapabilityInstallGateDecision {
    this.requireTenantActor(input.targetTenantId, input.gate.requestedByActorRef);
    const listing = this.listingRow(input.listingId);
    if (!listing || listing.status !== 'public') throw new Error('Public listing is unavailable for installation');
    if (input.gate.targetTenantId !== input.targetTenantId) {
      throw new Error('Install gate target tenant does not match the request tenant');
    }
    if (input.gate.share.sourceTenantId !== listing.source_tenant_id ||
        input.gate.share.packageId !== listing.package_id ||
        input.gate.share.packageVersion !== listing.package_version ||
        input.gate.share.packageDigest !== listing.package_digest ||
        canonicalJson(input.gate.share.package) !== listing.package_json) {
      throw new Error('Install gate is not bound to the exact public package');
    }

    const decision = createCapabilityInstallGateDecision(input.gate);
    this.database.prepare(`
      INSERT INTO marketplace_install_attempts (
        attempt_id, listing_id, target_tenant_id, gate_id, decision,
        reasons_json, request_digest, decided_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.attemptId, input.listingId, input.targetTenantId, input.gate.gateId,
      decision.decision, canonicalJson(decision.reasons), decision.requestDigest, decision.evaluatedAt,
    );
    return decision;
  }

  declareAuthorClaim(input: {
    claimId: string;
    listingId: string;
    sourceTenantId: string;
    claimantActorRef: string;
    declarationEvidenceDigest: string;
  }): MarketplaceAuthorClaimRecord {
    this.requireTenantHuman(input.sourceTenantId, input.claimantActorRef);
    requireDigest(input.declarationEvidenceDigest, 'Author claim declaration evidence');
    const listing = this.listingRow(input.listingId);
    if (!listing || listing.status !== 'public' || listing.source_tenant_id !== input.sourceTenantId) {
      throw new Error('Public listing is unavailable for author claim');
    }
    const declaredAt = this.now().toISOString();
    this.database.prepare(`
      INSERT INTO marketplace_author_claims (
        claim_id, listing_id, source_tenant_id, claimant_actor_ref,
        declaration_evidence_digest, status, declared_at
      ) VALUES (?, ?, ?, ?, ?, 'pending', ?)
    `).run(
      input.claimId, input.listingId, input.sourceTenantId, input.claimantActorRef,
      input.declarationEvidenceDigest, declaredAt,
    );
    return this.authorClaim(input.claimId)!;
  }

  verifyAuthorClaim(input: {
    claimId: string;
    requestTenantId: string;
    moderatorActorRef: string;
    verificationEvidenceDigest: string;
  }): MarketplaceAuthorClaimRecord {
    this.requireModerator(input.requestTenantId, input.moderatorActorRef);
    requireDigest(input.verificationEvidenceDigest, 'Author claim verification evidence');
    const claim = this.authorClaimRow(input.claimId);
    if (!claim || claim.status !== 'pending') throw new Error('Pending author claim is unavailable');
    const verifiedAt = this.now().toISOString();
    this.database.prepare(`
      UPDATE marketplace_author_claims
      SET status = 'verified', verified_by_actor_ref = ?,
          verification_evidence_digest = ?, verified_at = ?
      WHERE claim_id = ? AND status = 'pending'
    `).run(input.moderatorActorRef, input.verificationEvidenceDigest, verifiedAt, input.claimId);
    return this.authorClaim(input.claimId)!;
  }

  revokeAuthorClaim(input: {
    claimId: string;
    sourceTenantId: string;
    claimantActorRef: string;
    reason: string;
  }): MarketplaceAuthorClaimRecord {
    this.requireTenantHuman(input.sourceTenantId, input.claimantActorRef);
    const reason = input.reason.trim();
    if (!reason) throw new Error('Author claim revocation reason is required');
    const claim = this.authorClaimRow(input.claimId);
    if (!claim || claim.source_tenant_id !== input.sourceTenantId || claim.claimant_actor_ref !== input.claimantActorRef
      || !['pending', 'verified'].includes(claim.status)) {
      throw new Error('Author claim is unavailable for revocation');
    }
    const revokedAt = this.now().toISOString();
    const revoke = this.database.transaction(() => {
      this.database.prepare(`
        UPDATE marketplace_offers SET status = 'withdrawn', withdrawn_at = ?
        WHERE claim_id = ? AND status = 'active'
      `).run(revokedAt, input.claimId);
      this.database.prepare(`
        UPDATE marketplace_author_claims
        SET status = 'revoked', revoked_at = ?, revocation_reason = ?
        WHERE claim_id = ? AND status IN ('pending', 'verified')
      `).run(revokedAt, reason, input.claimId);
    });
    revoke();
    return this.authorClaim(input.claimId)!;
  }

  createDryRunOffer(input: {
    offerId: string;
    claimId: string;
    sourceTenantId: string;
    actorRef: string;
    priceCents: number;
  }): MarketplaceDryRunOffer {
    this.requireTenantHuman(input.sourceTenantId, input.actorRef);
    requirePositiveCents(input.priceCents);
    const claim = this.authorClaimRow(input.claimId);
    if (!claim || claim.status !== 'verified' || claim.source_tenant_id !== input.sourceTenantId
      || claim.claimant_actor_ref !== input.actorRef) {
      throw new Error('Verified author claim is required for a dry-run offer');
    }
    const listing = this.listingRow(claim.listing_id);
    if (!listing || listing.status !== 'public') throw new Error('Public listing is unavailable for dry-run offer');
    const createdAt = this.now().toISOString();
    this.database.prepare(`
      INSERT INTO marketplace_offers (
        offer_id, listing_id, claim_id, source_tenant_id, price_cents,
        currency, mode, status, created_by_actor_ref, created_at
      ) VALUES (?, ?, ?, ?, ?, 'CNY', 'dry_run', 'active', ?, ?)
    `).run(
      input.offerId, claim.listing_id, input.claimId, input.sourceTenantId,
      input.priceCents, input.actorRef, createdAt,
    );
    return this.dryRunOffer(input.offerId)!;
  }

  withdrawDryRunOffer(input: {
    offerId: string;
    sourceTenantId: string;
    actorRef: string;
  }): MarketplaceDryRunOffer {
    this.requireTenantHuman(input.sourceTenantId, input.actorRef);
    const offer = this.offerRow(input.offerId);
    if (!offer || offer.status !== 'active' || offer.source_tenant_id !== input.sourceTenantId) {
      throw new Error('Active dry-run offer is unavailable');
    }
    const claim = this.authorClaimRow(offer.claim_id);
    if (!claim || claim.claimant_actor_ref !== input.actorRef) throw new Error('Marketplace authorization denied');
    this.database.prepare(`
      UPDATE marketplace_offers SET status = 'withdrawn', withdrawn_at = ?
      WHERE offer_id = ? AND status = 'active'
    `).run(this.now().toISOString(), input.offerId);
    return this.dryRunOffer(input.offerId)!;
  }

  placeDryRunOrder(input: {
    orderId: string;
    offerId: string;
    installAttemptId: string;
    buyerTenantId: string;
    buyerActorRef: string;
    termsDigest: string;
  }): MarketplaceDryRunOrder {
    this.requireTenantHuman(input.buyerTenantId, input.buyerActorRef);
    requireDigest(input.termsDigest, 'Dry-run order terms');
    const offer = this.offerRow(input.offerId);
    if (!offer || offer.status !== 'active') throw new Error('Active dry-run offer is unavailable');
    const createdAt = this.now().toISOString();
    this.database.prepare(`
      INSERT INTO marketplace_orders (
        order_id, offer_id, listing_id, install_attempt_id, source_tenant_id,
        buyer_tenant_id, buyer_actor_ref, amount_cents, currency, mode,
        status, terms_digest, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'CNY', 'dry_run', 'placed', ?, ?)
    `).run(
      input.orderId, input.offerId, offer.listing_id, input.installAttemptId,
      offer.source_tenant_id, input.buyerTenantId, input.buyerActorRef,
      offer.price_cents, input.termsDigest, createdAt,
    );
    return this.dryRunOrder(input.orderId)!;
  }

  settleDryRunOrder(input: {
    settlementId: string;
    orderId: string;
    sourceTenantId: string;
    actorRef: string;
  }): MarketplaceDryRunSettlement {
    this.requireTenantHuman(input.sourceTenantId, input.actorRef);
    const order = this.orderRow(input.orderId);
    if (!order || order.status !== 'placed' || order.source_tenant_id !== input.sourceTenantId) {
      throw new Error('Placed dry-run order is unavailable');
    }
    const offer = this.offerRow(order.offer_id);
    const claim = offer ? this.authorClaimRow(offer.claim_id) : undefined;
    if (!claim || claim.status !== 'verified' || claim.claimant_actor_ref !== input.actorRef) {
      throw new Error('Verified author claim is required for dry-run settlement');
    }
    const createdAt = this.now().toISOString();
    const settle = this.database.transaction(() => {
      this.database.prepare(`
        INSERT INTO marketplace_settlements (
          settlement_id, order_id, listing_id, source_tenant_id, buyer_tenant_id,
          amount_cents, currency, mode, initiated_by_actor_ref, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'CNY', 'dry_run', ?, ?)
      `).run(
        input.settlementId, input.orderId, order.listing_id, order.source_tenant_id,
        order.buyer_tenant_id, order.amount_cents, input.actorRef, createdAt,
      );
      const entry = this.database.prepare(`
        INSERT INTO marketplace_ledger_entries (
          entry_id, settlement_id, account_ref, direction, amount_cents, currency, mode, created_at
        ) VALUES (?, ?, ?, ?, ?, 'CNY', 'dry_run', ?)
      `);
      entry.run(`${input.settlementId}-buyer`, input.settlementId, `tenant:${order.buyer_tenant_id}`, 'debit', order.amount_cents, createdAt);
      entry.run(`${input.settlementId}-author`, input.settlementId, `tenant:${order.source_tenant_id}`, 'credit', order.amount_cents, createdAt);
      this.database.prepare(`
        UPDATE marketplace_orders SET status = 'settled', settled_at = ?
        WHERE order_id = ? AND status = 'placed'
      `).run(createdAt, input.orderId);
    });
    settle();
    return this.dryRunSettlement(input.settlementId)!;
  }

  reconcileDryRunSettlement(input: {
    settlementId: string;
    requestTenantId: string;
    actorRef: string;
  }): MarketplaceDryRunReconciliation {
    this.requireTenantHuman(input.requestTenantId, input.actorRef);
    const settlement = this.settlementRow(input.settlementId);
    if (!settlement) throw new Error('Dry-run settlement is unavailable');
    if (![settlement.source_tenant_id, settlement.buyer_tenant_id].includes(input.requestTenantId)) {
      throw new Error('Marketplace authorization denied');
    }
    const entries = this.database.prepare(`
      SELECT direction, amount_cents FROM marketplace_ledger_entries
      WHERE settlement_id = ? ORDER BY direction
    `).all<{ direction: 'debit' | 'credit'; amount_cents: number }>(input.settlementId);
    const debitCents = entries.filter((entry) => entry.direction === 'debit').reduce((sum, entry) => sum + entry.amount_cents, 0);
    const creditCents = entries.filter((entry) => entry.direction === 'credit').reduce((sum, entry) => sum + entry.amount_cents, 0);
    const signedBalanceCents = creditCents - debitCents;
    return {
      settlementId: input.settlementId,
      orderId: settlement.order_id,
      mode: 'dry_run',
      amountCents: settlement.amount_cents,
      debitCents,
      creditCents,
      signedBalanceCents,
      reconciled: entries.length === 2 && debitCents === settlement.amount_cents
        && creditCents === settlement.amount_cents && signedBalanceCents === 0,
    };
  }

  authorClaim(claimId: string): MarketplaceAuthorClaimRecord | undefined {
    const row = this.authorClaimRow(claimId);
    return row ? mapAuthorClaim(row) : undefined;
  }

  dryRunOffer(offerId: string): MarketplaceDryRunOffer | undefined {
    const row = this.offerRow(offerId);
    return row ? mapOffer(row) : undefined;
  }

  dryRunOrder(orderId: string): MarketplaceDryRunOrder | undefined {
    const row = this.orderRow(orderId);
    return row ? mapOrder(row) : undefined;
  }

  dryRunSettlement(settlementId: string): MarketplaceDryRunSettlement | undefined {
    const row = this.settlementRow(settlementId);
    return row ? mapSettlement(row) : undefined;
  }

  private packageRow(tenantId: string, packageId: string, packageVersion: number): PackageRow | undefined {
    return this.database.prepare(`
      SELECT source_tenant_id, package_id, package_version, package_digest, package_json, integrity_digest
      FROM capability_packages
      WHERE source_tenant_id = ? AND package_id = ? AND package_version = ?
    `).get<PackageRow>(tenantId, packageId, packageVersion);
  }

  private listingRow(listingId: string): ListingRow | undefined {
    return this.database.prepare(`
      SELECT l.listing_id, l.source_tenant_id, l.package_id, l.package_version,
             l.package_digest, l.status, l.public_projection_json, l.published_at,
             p.package_json, p.integrity_digest
      FROM listings l
      JOIN capability_packages p
        ON p.source_tenant_id = l.source_tenant_id
       AND p.package_id = l.package_id
       AND p.package_version = l.package_version
      WHERE l.listing_id = ?
    `).get<ListingRow>(listingId);
  }

  private authorClaimRow(claimId: string): AuthorClaimRow | undefined {
    return this.database.prepare(`
      SELECT * FROM marketplace_author_claims WHERE claim_id = ?
    `).get<AuthorClaimRow>(claimId);
  }

  private offerRow(offerId: string): OfferRow | undefined {
    return this.database.prepare(`
      SELECT * FROM marketplace_offers WHERE offer_id = ?
    `).get<OfferRow>(offerId);
  }

  private orderRow(orderId: string): OrderRow | undefined {
    return this.database.prepare(`
      SELECT * FROM marketplace_orders WHERE order_id = ?
    `).get<OrderRow>(orderId);
  }

  private settlementRow(settlementId: string): SettlementRow | undefined {
    return this.database.prepare(`
      SELECT * FROM marketplace_settlements WHERE settlement_id = ?
    `).get<SettlementRow>(settlementId);
  }

  private requireModerator(requestTenantId: string, actorRef: string): void {
    requireSameTenant(requestTenantId, this.moderationTenantId);
    this.requireTenantHuman(requestTenantId, actorRef);
  }

  private requireTenantHuman(tenantId: string, actorRef: string): void {
    if (!actorRef.startsWith('human:')) throw new Error('Marketplace authorization denied');
    this.requireTenantActor(tenantId, actorRef);
  }

  private requireTenantActor(tenantId: string, actorRef: string): void {
    const humanId = actorRef.startsWith('human:') ? actorRef.slice('human:'.length) : null;
    const accountId = actorRef.startsWith('account:') ? actorRef.slice('account:'.length) : null;
    if (!humanId && !accountId) throw new Error('Marketplace authorization denied');
    const member = this.database.prepare(`
      SELECT id FROM memberships
      WHERE tenant_id = ? AND status = 'active'
        AND ((? IS NOT NULL AND human_user_id = ?) OR (? IS NOT NULL AND account_id = ?))
      LIMIT 1
    `).get<{ id: string }>(tenantId, humanId, humanId, accountId, accountId);
    if (!member) throw new Error('Marketplace authorization denied');
  }
}

export function openPublicMarketStore(options: OpenPublicMarketOptions): PublicMarketStore {
  if (!options.databasePath) throw new TypeError('Public marketplace databasePath is required');
  if (!options.moderationTenantId) throw new TypeError('Public marketplace moderationTenantId is required');
  const require = createRequire(import.meta.url);
  const loaded = require('better-sqlite3') as SqliteConstructor | { default: SqliteConstructor };
  const Database = typeof loaded === 'function' ? loaded : loaded.default;
  const database = new Database(options.databasePath);
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  database.pragma('busy_timeout = 5000');
  return new PublicMarketStore(database, options.now ?? (() => new Date()), options.moderationTenantId);
}

function publicProjection(
  listingId: string,
  pkg: CapabilityPackageV1,
  integrityDigest: string,
  publishedAt: string,
): PublicCapabilityProjection {
  return {
    schema: 'hummer.public-capability-listing',
    version: 1,
    listingId,
    status: 'public',
    packageId: pkg.packageId,
    packageVersion: pkg.packageVersion,
    packageDigest: pkg.packageDigest,
    integrity: { kind: 'package_digest', digest: integrityDigest },
    title: pkg.title,
    goal: pkg.goal,
    publisherRef: `publisher:${sha256(pkg.tenantId).slice(0, 16)}`,
    provenance: {
      capturedAt: pkg.provenance.capturedAt,
      runtime: pkg.provenance.runtime,
      runtimeVersion: pkg.provenance.runtimeVersion,
      agentVersion: pkg.provenance.agentVersion,
      demoSessionCount: pkg.provenance.demoSessionIds.length,
    },
    sourceBoundary: {
      applicationCount: pkg.sourceBoundary.apps.length,
      windowPatternCount: pkg.sourceBoundary.windows.length,
      includePathCount: pkg.sourceBoundary.includePaths.length,
      excludePathCount: pkg.sourceBoundary.excludePaths.length,
    },
    trialRecord: {
      shadowRuns: pkg.trialRecord.shadowRuns,
      success: pkg.trialRecord.success,
      failure: pkg.trialRecord.failure,
      lastRunAt: pkg.trialRecord.lastRunAt,
      regressionPassed: pkg.trialRecord.regressionPassed,
      regressionEvidenceDigest: pkg.trialRecord.regressionEvidenceDigest,
    },
    failureNotes: pkg.failureNotes.map((note) => ({
      summary: 'Publisher-recorded failure note',
      digest: sha256(note),
    })),
    declaredPermissions: pkg.declaredPermissions.map((permission) => ({
      ...permission,
      paths: [...permission.paths],
    })),
    receiptRef: pkg.receiptRef,
    evidenceCount: pkg.evidenceRefs.length,
    publishedAt,
  };
}

function parsePackage(value: string): CapabilityPackageV1 {
  const parsed = JSON.parse(value) as unknown;
  const checked = validateCapabilityContract('CapabilityPackageV1', parsed);
  if (checked.issues) throw new Error(`Persisted public package failed validation: ${checked.issues[0]?.message}`);
  return checked.value;
}

function mapReport(row: ReportRow): MarketplaceReportRecord {
  return {
    reportId: row.report_id,
    listingId: row.listing_id,
    reporterTenantId: row.reporter_tenant_id,
    reporterActorRef: row.reporter_actor_ref,
    reason: row.reason,
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

function mapAuthorClaim(row: AuthorClaimRow): MarketplaceAuthorClaimRecord {
  return {
    claimId: row.claim_id,
    listingId: row.listing_id,
    sourceTenantId: row.source_tenant_id,
    claimantActorRef: row.claimant_actor_ref,
    status: row.status,
    declarationEvidenceDigest: row.declaration_evidence_digest,
    verificationEvidenceDigest: row.verification_evidence_digest,
    declaredAt: row.declared_at,
    verifiedAt: row.verified_at,
    revokedAt: row.revoked_at,
    revocationReason: row.revocation_reason,
  };
}

function mapOffer(row: OfferRow): MarketplaceDryRunOffer {
  return {
    offerId: row.offer_id,
    listingId: row.listing_id,
    claimId: row.claim_id,
    sourceTenantId: row.source_tenant_id,
    priceCents: row.price_cents,
    currency: row.currency,
    mode: row.mode,
    status: row.status,
    createdAt: row.created_at,
    withdrawnAt: row.withdrawn_at,
  };
}

function mapOrder(row: OrderRow): MarketplaceDryRunOrder {
  return {
    orderId: row.order_id,
    offerId: row.offer_id,
    listingId: row.listing_id,
    installAttemptId: row.install_attempt_id,
    sourceTenantId: row.source_tenant_id,
    buyerTenantId: row.buyer_tenant_id,
    buyerActorRef: row.buyer_actor_ref,
    amountCents: row.amount_cents,
    currency: row.currency,
    mode: row.mode,
    status: row.status,
    termsDigest: row.terms_digest,
    createdAt: row.created_at,
    settledAt: row.settled_at,
  };
}

function mapSettlement(row: SettlementRow): MarketplaceDryRunSettlement {
  return {
    settlementId: row.settlement_id,
    orderId: row.order_id,
    listingId: row.listing_id,
    sourceTenantId: row.source_tenant_id,
    buyerTenantId: row.buyer_tenant_id,
    amountCents: row.amount_cents,
    currency: row.currency,
    mode: row.mode,
    createdAt: row.created_at,
  };
}

function requireSameTenant(actual: string, expected: string): void {
  if (actual !== expected) throw new Error('Marketplace authorization denied');
}

function requireDigest(value: string, label: string): void {
  if (!/^[a-f0-9]{64}$/u.test(value)) throw new Error(`${label} must be a SHA-256 digest`);
}

function requirePositiveCents(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 1_000_000_000) {
    throw new Error('Dry-run offer price must be positive integer cents');
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
