import { randomUUID } from 'node:crypto';
import { canonicalJson, sha256Hex, type JsonValue } from './canonical-json.js';
import { DomainEventStore } from './domain-event-store.js';
import type { SqliteDatabase } from './sqlite.js';

export type TenantLifecycleStatus = 'active' | 'suspended' | 'export_required' | 'destroyed';
export type QuotaMetric = 'tasks' | 'tokens' | 'cost_cny';

export interface L3Authorization {
  level: 'L3';
  reference: string;
  approvedBy: string;
  approvedAt: string;
}

export interface TenantChainHead {
  tenantId: string;
  position: number;
  hash: string;
  updatedAt: string;
}

export interface ChainHeadExport {
  device_id: string;
  tenant_id: string;
  position: number;
  hash: string;
  at: string;
}

export interface AuditExportFile {
  path: string;
  sha256: string;
  sizeBytes: number;
}

export interface AuditExportManifest {
  schema: 'hummer.audit-export';
  version: 1;
  exportId: string;
  tenantId: string;
  range: { from: number; to: number };
  chainHead: { position: number; hash: string };
  eventRefs: Array<{ eventId: string; position: number; hash: string }>;
  files: AuditExportFile[];
  createdAt: string;
}

export interface AuditExportRecord {
  exportId: string;
  tenantId: string;
  rangeFrom: number;
  rangeTo: number;
  sha256: string;
  manifest: AuditExportManifest;
  createdAt: string;
}

export interface QuotaCounter {
  tenantId: string;
  nodeId: string;
  windowDay: string;
  metric: QuotaMetric;
  used: number;
  limit: number;
  warningEmitted: boolean;
  updatedAt: string;
}

export interface QuotaAdmissionResult {
  accepted: boolean;
  reason: 'accepted' | 'quota_exceeded' | 'quota_unconfigured' | 'tenant_unavailable';
  warnings: QuotaMetric[];
  counters: QuotaCounter[];
}

interface TenantRow { id: string; status: TenantLifecycleStatus }
interface TenantHeadRow { tenant_id: string; position: number; hash: string; updated_at: string }
interface TenantEventRefRow { event_id: string; tenant_position: number; hash: string }
interface AuditExportRow {
  export_id: string; tenant_id: string; range_from: number; range_to: number;
  sha256: string; manifest_json: string; created_at: string;
}
interface QuotaCounterRow {
  tenant_id: string; node_id: string; window_day: string; metric: QuotaMetric;
  used: number; limit_value: number; warning_emitted: number; updated_at: string;
}
interface QuotaAdmissionRow { request_sha256: string; result_json: string }

const AUDIT_EXPORT_UNAVAILABLE = 'Audit export is unavailable in the current tenant';
const QUOTA_SCOPE_UNAVAILABLE = 'Quota scope is unavailable in the current tenant';

export class TenantGovernanceStore {
  private readonly events: DomainEventStore;

  constructor(private readonly database: SqliteDatabase, private readonly now: () => Date = () => new Date()) {
    this.events = new DomainEventStore(database);
  }

  getSetting(tenantId: string, key: string): JsonValue | undefined {
    this.requireTenant(tenantId);
    const row = this.database.prepare('SELECT value_json FROM tenant_settings WHERE tenant_id = ? AND key = ?')
      .get<{ value_json: string }>(tenantId, required(key, 'Tenant setting key'));
    return row ? JSON.parse(row.value_json) as JsonValue : undefined;
  }

  listSettings(tenantId: string): Array<{ key: string; value: JsonValue; updatedAt: string }> {
    this.requireTenant(tenantId);
    return this.database.prepare(`
      SELECT key, value_json, updated_at FROM tenant_settings WHERE tenant_id = ? ORDER BY key
    `).all<{ key: string; value_json: string; updated_at: string }>(tenantId).map((row) => ({
      key: row.key,
      value: JSON.parse(row.value_json) as JsonValue,
      updatedAt: row.updated_at,
    }));
  }

  setSetting(tenantId: string, key: string, value: JsonValue): void {
    const tenant = this.requireTenant(tenantId);
    if (tenant.status === 'destroyed') throw new Error('Tenant is unavailable');
    const normalizedKey = required(key, 'Tenant setting key');
    const updatedAt = this.now().toISOString();
    this.database.prepare(`
      INSERT INTO tenant_settings (tenant_id, key, value_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (tenant_id, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
    `).run(tenantId, normalizedKey, canonicalJson(value), updatedAt);
  }

  getTenantStatus(tenantId: string): TenantLifecycleStatus {
    return this.requireTenant(tenantId).status;
  }

  getChainHead(tenantId: string): TenantChainHead | undefined {
    const row = this.database.prepare(`
      SELECT tenant_id, position, hash, updated_at FROM tenant_chain_heads WHERE tenant_id = ?
    `).get<TenantHeadRow>(tenantId);
    return row ? mapHead(row) : undefined;
  }

  exportChainHead(tenantId: string, deviceId: string): ChainHeadExport {
    this.requireTenant(tenantId);
    const head = this.getChainHead(tenantId);
    if (!head) throw new Error('Tenant chain head is unavailable');
    return {
      device_id: required(deviceId, 'Device id'),
      tenant_id: tenantId,
      position: head.position,
      hash: head.hash,
      at: this.now().toISOString(),
    };
  }

  createAuditExport(input: {
    exportId: string;
    tenantId: string;
    rangeFrom: number;
    rangeTo: number;
    eventIds?: string[];
    files: AuditExportFile[];
    createdAt?: string;
  }): AuditExportRecord {
    this.requireTenant(input.tenantId);
    required(input.exportId, 'Audit export id');
    assertPositiveInteger(input.rangeFrom, 'Audit range start');
    assertPositiveInteger(input.rangeTo, 'Audit range end');
    if (input.rangeTo < input.rangeFrom) throw new TypeError('Audit range is invalid');
    const integrity = this.events.verifyTenantIntegrity(input.tenantId);
    if (!integrity.valid) throw new Error('Tenant chain is not exportable');
    const head = this.getChainHead(input.tenantId);
    if (!head || input.rangeTo > head.position) throw new Error(AUDIT_EXPORT_UNAVAILABLE);
    const refs = this.database.prepare(`
      SELECT event_id, tenant_position, hash FROM tenant_event_chain
      WHERE tenant_id = ? AND tenant_position BETWEEN ? AND ? ORDER BY tenant_position
    `).all<TenantEventRefRow>(input.tenantId, input.rangeFrom, input.rangeTo);
    if (refs.length !== input.rangeTo - input.rangeFrom + 1) throw new Error(AUDIT_EXPORT_UNAVAILABLE);
    if (input.eventIds && (input.eventIds.length !== refs.length
      || input.eventIds.some((eventId, index) => eventId !== refs[index]?.event_id))) {
      throw new Error(AUDIT_EXPORT_UNAVAILABLE);
    }
    const files = input.files.map(validateAuditFile).sort((left, right) => left.path.localeCompare(right.path));
    if (new Set(files.map((file) => file.path)).size !== files.length) throw new TypeError('Audit export file paths must be unique');
    const existing = this.database.prepare('SELECT tenant_id FROM audit_exports WHERE export_id = ?')
      .get<{ tenant_id: string }>(input.exportId);
    if (existing) throw new Error(AUDIT_EXPORT_UNAVAILABLE);
    const createdAt = input.createdAt ?? this.now().toISOString();
    const manifest: AuditExportManifest = {
      schema: 'hummer.audit-export',
      version: 1,
      exportId: input.exportId,
      tenantId: input.tenantId,
      range: { from: input.rangeFrom, to: input.rangeTo },
      chainHead: { position: refs.at(-1)?.tenant_position ?? 0, hash: refs.at(-1)?.hash ?? '' },
      eventRefs: refs.map((ref) => ({ eventId: ref.event_id, position: ref.tenant_position, hash: ref.hash })),
      files,
      createdAt,
    };
    const manifestJson = canonicalJson(manifest);
    const sha256 = sha256Hex(manifestJson);
    this.database.prepare(`
      INSERT INTO audit_exports (export_id, tenant_id, range_from, range_to, sha256, manifest_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(input.exportId, input.tenantId, input.rangeFrom, input.rangeTo, sha256, manifestJson, createdAt);
    return { exportId: input.exportId, tenantId: input.tenantId, rangeFrom: input.rangeFrom, rangeTo: input.rangeTo, sha256, manifest, createdAt };
  }

  getAuditExport(tenantId: string, exportId: string): AuditExportRecord | undefined {
    const row = this.database.prepare(`
      SELECT * FROM audit_exports WHERE tenant_id = ? AND export_id = ?
    `).get<AuditExportRow>(tenantId, exportId);
    return row ? mapAuditExport(row) : undefined;
  }

  verifyAuditExport(tenantId: string, exportId: string): boolean {
    const row = this.database.prepare(`
      SELECT * FROM audit_exports WHERE tenant_id = ? AND export_id = ?
    `).get<AuditExportRow>(tenantId, exportId);
    if (!row) return false;
    try {
      const manifest = JSON.parse(row.manifest_json) as AuditExportManifest;
      if (manifest.schema !== 'hummer.audit-export' || manifest.version !== 1
        || manifest.exportId !== row.export_id || manifest.tenantId !== row.tenant_id
        || manifest.range.from !== row.range_from || manifest.range.to !== row.range_to
        || manifest.createdAt !== row.created_at || sha256Hex(canonicalJson(manifest)) !== row.sha256) {
        return false;
      }
      const files = manifest.files.map(validateAuditFile);
      if (new Set(files.map((file) => file.path)).size !== files.length) return false;
      const refs = this.database.prepare(`
        SELECT event_id, tenant_position, hash FROM tenant_event_chain
        WHERE tenant_id = ? AND tenant_position BETWEEN ? AND ? ORDER BY tenant_position
      `).all<TenantEventRefRow>(tenantId, row.range_from, row.range_to);
      return canonicalJson(manifest.eventRefs) === canonicalJson(refs.map((ref) => ({
        eventId: ref.event_id, position: ref.tenant_position, hash: ref.hash,
      })));
    } catch {
      return false;
    }
  }

  suspendTenant(tenantId: string, actorRef: string): TenantLifecycleStatus {
    return this.transitionTenant(tenantId, ['active'], 'suspended', 'tenant.suspended', actorRef, {});
  }

  activateTenant(tenantId: string, actorRef: string): TenantLifecycleStatus {
    return this.transitionTenant(tenantId, ['suspended'], 'active', 'tenant.reactivated', actorRef, {});
  }

  requireExportBeforeDestruction(tenantId: string, actorRef: string): TenantLifecycleStatus {
    return this.transitionTenant(
      tenantId, ['active', 'suspended'], 'export_required', 'tenant.export_required', actorRef, {},
    );
  }

  authorizeTenantDestruction(tenantId: string, actorRef: string, authorization: L3Authorization): TenantLifecycleStatus {
    if (authorization.level !== 'L3') throw new Error('Tenant destruction requires L3 authorization');
    const authorizationRef = required(authorization.reference, 'L3 authorization reference');
    const approvedBy = required(authorization.approvedBy, 'L3 approver');
    if (!Number.isFinite(Date.parse(authorization.approvedAt))) throw new TypeError('L3 approval time is invalid');
    return this.database.transaction(() => {
      const tenant = this.requireTenant(tenantId);
      if (tenant.status !== 'export_required') throw new Error('Tenant destruction is not authorized');
      const head = this.getChainHead(tenantId);
      const completeExport = head && this.database.prepare(`
        SELECT export_id FROM audit_exports
        WHERE tenant_id = ? AND range_from = 1 AND range_to = ?
        ORDER BY created_at DESC LIMIT 1
      `).get<{ export_id: string }>(tenantId, head.position);
      if (!completeExport || !this.verifyAuditExport(tenantId, completeExport.export_id)) {
        throw new Error('Tenant destruction requires a complete audit export');
      }
      this.database.prepare('UPDATE tenants SET status = ?, updated_at = ? WHERE id = ? AND status = ?')
        .run('destroyed', this.now().toISOString(), tenantId, 'export_required');
      this.appendEvent(tenantId, 'tenant.destroy_authorized', actorRef, {
        authorizationRef,
        approvedBy,
        approvedAt: authorization.approvedAt,
        exportId: completeExport.export_id,
        destructiveDeleteExecuted: false,
      });
      return 'destroyed' as const;
    })();
  }

  configureQuota(input: {
    tenantId: string;
    nodeId: string;
    windowDay: string;
    metric: QuotaMetric;
    limit: number;
  }): QuotaCounter {
    if (this.requireTenant(input.tenantId).status === 'destroyed') throw new Error('Tenant is unavailable');
    this.requireNode(input.tenantId, input.nodeId);
    assertWindowDay(input.windowDay);
    assertQuotaMetric(input.metric);
    assertPositiveNumber(input.limit, 'Quota limit');
    const updatedAt = this.now().toISOString();
    this.database.prepare(`
      INSERT INTO quota_counters
        (tenant_id, node_id, window_day, metric, used, limit_value, warning_emitted, updated_at)
      VALUES (?, ?, ?, ?, 0, ?, 0, ?)
      ON CONFLICT (tenant_id, node_id, window_day, metric) DO UPDATE SET
        limit_value = excluded.limit_value,
        updated_at = excluded.updated_at
    `).run(input.tenantId, input.nodeId, input.windowDay, input.metric, input.limit, updatedAt);
    return this.requireQuotaCounter(input.tenantId, input.nodeId, input.windowDay, input.metric);
  }

  listQuotaCounters(tenantId: string, nodeId: string, windowDay: string): QuotaCounter[] {
    this.requireTenant(tenantId);
    this.requireNode(tenantId, nodeId);
    assertWindowDay(windowDay);
    return this.database.prepare(`
      SELECT * FROM quota_counters WHERE tenant_id = ? AND node_id = ? AND window_day = ? ORDER BY metric
    `).all<QuotaCounterRow>(tenantId, nodeId, windowDay).map(mapQuotaCounter);
  }

  admitQuotaUsage(input: {
    tenantId: string;
    nodeId: string;
    windowDay: string;
    idempotencyKey: string;
    actorRef: string;
    tasks: number;
    tokens: number;
    costCny: number;
  }): QuotaAdmissionResult {
    const increments: Record<QuotaMetric, number> = {
      tasks: input.tasks,
      tokens: input.tokens,
      cost_cny: input.costCny,
    };
    if (!Number.isSafeInteger(increments.tasks) || increments.tasks <= 0) {
      throw new TypeError('Quota tasks must be a positive integer');
    }
    if (!Number.isSafeInteger(increments.tokens) || increments.tokens < 0) {
      throw new TypeError('Quota tokens must be a non-negative integer');
    }
    assertNonNegativeNumber(increments.cost_cny, 'Quota cost_cny');
    assertWindowDay(input.windowDay);
    const idempotencyKey = required(input.idempotencyKey, 'Quota idempotency key');
    const requestSha256 = sha256Hex(canonicalJson({
      tenantId: input.tenantId,
      nodeId: input.nodeId,
      windowDay: input.windowDay,
      tasks: increments.tasks,
      tokens: increments.tokens,
      costCny: increments.cost_cny,
    }));
    return this.database.transaction(() => {
      const tenant = this.requireTenant(input.tenantId);
      this.requireNode(input.tenantId, input.nodeId);
      const existing = this.database.prepare(`
        SELECT request_sha256, result_json FROM quota_admissions
        WHERE tenant_id = ? AND node_id = ? AND window_day = ? AND idempotency_key = ?
      `).get<QuotaAdmissionRow>(input.tenantId, input.nodeId, input.windowDay, idempotencyKey);
      if (existing) {
        if (existing.request_sha256 !== requestSha256) throw new Error('Quota admission idempotency conflict');
        return JSON.parse(existing.result_json) as QuotaAdmissionResult;
      }
      const counters = (['tasks', 'tokens', 'cost_cny'] as const).map((metric) => this.getQuotaCounter(
        input.tenantId, input.nodeId, input.windowDay, metric,
      ));
      if (tenant.status !== 'active') {
        return this.rejectQuotaAdmission(input, idempotencyKey, requestSha256, 'tenant_unavailable', counters, increments);
      }
      if (counters.some((counter) => !counter)) {
        return this.rejectQuotaAdmission(input, idempotencyKey, requestSha256, 'quota_unconfigured', counters, increments);
      }
      const configured = counters as QuotaCounter[];
      if (configured.some((counter) => counter.used + increments[counter.metric] > counter.limit)) {
        return this.rejectQuotaAdmission(input, idempotencyKey, requestSha256, 'quota_exceeded', configured, increments);
      }
      const warnings: QuotaMetric[] = [];
      const updatedAt = this.now().toISOString();
      for (const counter of configured) {
        const used = counter.used + increments[counter.metric];
        const warning = !counter.warningEmitted && used / counter.limit >= 0.8;
        this.database.prepare(`
          UPDATE quota_counters SET used = ?, warning_emitted = ?, updated_at = ?
          WHERE tenant_id = ? AND node_id = ? AND window_day = ? AND metric = ?
        `).run(
          used, warning || counter.warningEmitted ? 1 : 0, updatedAt,
          input.tenantId, input.nodeId, input.windowDay, counter.metric,
        );
        if (warning) {
          warnings.push(counter.metric);
          this.appendEvent(input.tenantId, 'quota.warning', input.actorRef, {
            nodeId: input.nodeId, windowDay: input.windowDay, metric: counter.metric, used, limit: counter.limit,
          });
        }
      }
      const result: QuotaAdmissionResult = {
        accepted: true,
        reason: 'accepted',
        warnings,
        counters: this.listQuotaCounters(input.tenantId, input.nodeId, input.windowDay),
      };
      this.recordQuotaAdmission(input, idempotencyKey, requestSha256, result);
      return result;
    })();
  }

  private rejectQuotaAdmission(
    input: { tenantId: string; nodeId: string; windowDay: string; actorRef: string },
    idempotencyKey: string,
    requestSha256: string,
    reason: Exclude<QuotaAdmissionResult['reason'], 'accepted'>,
    counters: Array<QuotaCounter | undefined>,
    increments: Record<QuotaMetric, number>,
  ): QuotaAdmissionResult {
    const result: QuotaAdmissionResult = {
      accepted: false,
      reason,
      warnings: [],
      counters: counters.filter((counter): counter is QuotaCounter => Boolean(counter)),
    };
    this.appendEvent(input.tenantId, 'quota.rejected', input.actorRef, {
      nodeId: input.nodeId,
      windowDay: input.windowDay,
      reason,
      requested: increments,
    });
    this.recordQuotaAdmission(input, idempotencyKey, requestSha256, result);
    return result;
  }

  private recordQuotaAdmission(
    input: { tenantId: string; nodeId: string; windowDay: string },
    idempotencyKey: string,
    requestSha256: string,
    result: QuotaAdmissionResult,
  ): void {
    this.database.prepare(`
      INSERT INTO quota_admissions
        (tenant_id, node_id, window_day, idempotency_key, request_sha256, result_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.tenantId, input.nodeId, input.windowDay, idempotencyKey,
      requestSha256, canonicalJson(result), this.now().toISOString(),
    );
  }

  private transitionTenant(
    tenantId: string,
    from: TenantLifecycleStatus[],
    to: TenantLifecycleStatus,
    eventType: string,
    actorRef: string,
    payload: JsonValue,
  ): TenantLifecycleStatus {
    return this.database.transaction(() => {
      const tenant = this.requireTenant(tenantId);
      if (!from.includes(tenant.status)) throw new Error('Tenant lifecycle transition is unavailable');
      const result = this.database.prepare('UPDATE tenants SET status = ?, updated_at = ? WHERE id = ? AND status = ?')
        .run(to, this.now().toISOString(), tenantId, tenant.status);
      if (result.changes !== 1) throw new Error('Tenant lifecycle transition is unavailable');
      this.appendEvent(tenantId, eventType, required(actorRef, 'Lifecycle actor'), payload);
      return to;
    })();
  }

  private appendEvent(tenantId: string, type: string, actorRef: string, payload: JsonValue): void {
    this.events.append({
      id: `evt_${randomUUID().replaceAll('-', '')}`,
      tenantId,
      aggregateType: 'tenant_governance',
      aggregateId: tenantId,
      type,
      occurredAt: this.now().toISOString(),
      actorRef: required(actorRef, 'Governance actor'),
      correlationId: `corr_${randomUUID().replaceAll('-', '')}`,
      payload,
    });
  }

  private requireTenant(tenantId: string): TenantRow {
    const row = this.database.prepare('SELECT id, status FROM tenants WHERE id = ?').get<TenantRow>(tenantId);
    if (!row) throw new Error('Tenant is unavailable');
    return row;
  }

  private requireNode(tenantId: string, nodeId: string): void {
    const row = this.database.prepare('SELECT node_id FROM fleet_nodes WHERE tenant_id = ? AND node_id = ?')
      .get<{ node_id: string }>(tenantId, nodeId);
    if (!row) throw new Error(QUOTA_SCOPE_UNAVAILABLE);
  }

  private getQuotaCounter(tenantId: string, nodeId: string, windowDay: string, metric: QuotaMetric): QuotaCounter | undefined {
    const row = this.database.prepare(`
      SELECT * FROM quota_counters WHERE tenant_id = ? AND node_id = ? AND window_day = ? AND metric = ?
    `).get<QuotaCounterRow>(tenantId, nodeId, windowDay, metric);
    return row ? mapQuotaCounter(row) : undefined;
  }

  private requireQuotaCounter(tenantId: string, nodeId: string, windowDay: string, metric: QuotaMetric): QuotaCounter {
    const counter = this.getQuotaCounter(tenantId, nodeId, windowDay, metric);
    if (!counter) throw new Error(QUOTA_SCOPE_UNAVAILABLE);
    return counter;
  }
}

function mapHead(row: TenantHeadRow): TenantChainHead {
  return { tenantId: row.tenant_id, position: row.position, hash: row.hash, updatedAt: row.updated_at };
}

function mapAuditExport(row: AuditExportRow): AuditExportRecord {
  return {
    exportId: row.export_id,
    tenantId: row.tenant_id,
    rangeFrom: row.range_from,
    rangeTo: row.range_to,
    sha256: row.sha256,
    manifest: JSON.parse(row.manifest_json) as AuditExportManifest,
    createdAt: row.created_at,
  };
}

function mapQuotaCounter(row: QuotaCounterRow): QuotaCounter {
  return {
    tenantId: row.tenant_id,
    nodeId: row.node_id,
    windowDay: row.window_day,
    metric: row.metric,
    used: row.used,
    limit: row.limit_value,
    warningEmitted: row.warning_emitted === 1,
    updatedAt: row.updated_at,
  };
}

function validateAuditFile(file: AuditExportFile): AuditExportFile {
  const path = required(file.path, 'Audit export file path').replaceAll('\\', '/');
  if (path.startsWith('/') || /^[a-z]:/i.test(path) || path.split('/').some((part) => part === '..' || part === '')) {
    throw new TypeError('Audit export file path must be relative and normalized');
  }
  if (!/^[a-f0-9]{64}$/.test(file.sha256)) throw new TypeError('Audit export file sha256 is invalid');
  if (!Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 0) throw new TypeError('Audit export file size is invalid');
  return { path, sha256: file.sha256, sizeBytes: file.sizeBytes };
}

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} is required`);
  return normalized;
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${label} must be a positive integer`);
}

function assertPositiveNumber(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new TypeError(`${label} must be positive`);
}

function assertNonNegativeNumber(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) throw new TypeError(`${label} must be non-negative`);
}

function assertWindowDay(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new TypeError('Quota window must be YYYY-MM-DD');
}

function assertQuotaMetric(value: string): asserts value is QuotaMetric {
  if (value !== 'tasks' && value !== 'tokens' && value !== 'cost_cny') throw new TypeError('Quota metric is invalid');
}
