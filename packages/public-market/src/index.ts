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

function requireSameTenant(actual: string, expected: string): void {
  if (actual !== expected) throw new Error('Marketplace authorization denied');
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
