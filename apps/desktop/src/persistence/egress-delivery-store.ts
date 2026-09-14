import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { requireWorkspaceFile } from '../workspace-file-guard.js';
import type { ApprovalPolicyStore } from './approval-policy-store.js';
import { canonicalJson, type JsonValue } from './canonical-json.js';
import { DomainEventStore } from './domain-event-store.js';
import type { EvidenceStore } from './evidence-store.js';
import type { SqliteDatabase } from './sqlite.js';

const MAX_EGRESS_BYTES = 100 * 1024 * 1024;

export interface ApprovedArtifactExportInput {
  tenantId: string;
  sessionId: string;
  approvalId: string;
  requestedBy: string;
  sourceWorkspaceDirectory: string;
  sourceRelativePath: string;
  destinationDirectory: string;
  occurredAt: string;
  idempotencyKey: string;
}

export interface EgressDeliveryRecord {
  id: string;
  tenantId: string;
  sessionId: string;
  approvalId: string;
  capabilityId: 'external.send';
  target: string;
  fileName: string;
  contentSha256: string;
  evidenceRef: string;
  status: 'delivered' | 'failed';
  sizeBytes: number;
  occurredAt: string;
  idempotencyKey: string;
}

interface EgressRow {
  id: string; tenant_id: string; session_id: string; approval_id: string; capability_id: 'external.send';
  target: string; content_sha256: string; evidence_ref: string; status: 'delivered' | 'failed';
  result_json: string; occurred_at: string; idempotency_key: string;
}

export class EgressDeliveryStore {
  private readonly events: DomainEventStore;

  constructor(
    private readonly database: SqliteDatabase,
    private readonly approvals: ApprovalPolicyStore,
    private readonly evidence: EvidenceStore,
  ) {
    this.events = new DomainEventStore(database);
  }

  exportApprovedArtifact(input: ApprovedArtifactExportInput): EgressDeliveryRecord {
    validateInput(input);
    const existing = this.database.prepare('SELECT * FROM egress_deliveries WHERE tenant_id = ? AND idempotency_key = ?')
      .get<EgressRow>(input.tenantId, input.idempotencyKey);
    if (existing) return mapRow(existing);

    const approval = this.approvals.getEvidence(input.tenantId, input.sessionId, input.approvalId);
    if (!approval || approval.status !== 'approved') throw new Error('External delivery requires an approved approval for the current tenant and session');
    if (approval.action !== 'external.send' || approval.requestedBy !== input.requestedBy) {
      throw new Error('External delivery does not match the approved action and requester');
    }

    const source = requireWorkspaceFile({
      workspaceDirectory: input.sourceWorkspaceDirectory,
      requestedPath: input.sourceRelativePath,
      capability: 'external_send',
      maxBytes: MAX_EGRESS_BYTES,
    });
    const destinationRoot = requireDestinationDirectory(input.destinationDirectory);
    const fileName = basename(source.absolutePath);
    const target = join(destinationRoot, fileName);
    if (existsSync(target)) throw new Error('External delivery refuses to overwrite an existing file');

    const bytes = readFileSync(source.absolutePath);
    const stored = this.evidence.put(bytes, {
      tenantId: input.tenantId,
      sessionId: input.sessionId,
      mediaType: 'application/octet-stream',
      name: fileName,
      createdAt: input.occurredAt,
      metadata: { action: 'external.send', approvalId: input.approvalId, target },
    });
    const temporaryPath = `${target}.${randomUUID()}.hummer-tmp`;
    writeFileSync(temporaryPath, bytes, { flag: 'wx' });
    try {
      renameSync(temporaryPath, target);
      const id = `egress_${randomUUID()}`;
      const result = { fileName, sizeBytes: bytes.length };
      const save = this.database.transaction(() => {
        this.database.prepare(`
          INSERT INTO egress_deliveries
            (id, tenant_id, session_id, approval_id, capability_id, target, content_sha256,
             evidence_ref, status, result_json, occurred_at, idempotency_key)
          VALUES (?, ?, ?, ?, 'external.send', ?, ?, ?, 'delivered', ?, ?, ?)
        `).run(
          id, input.tenantId, input.sessionId, input.approvalId, target, stored.sha256,
          stored.ref, canonicalJson(result), input.occurredAt, input.idempotencyKey,
        );
        this.events.append({
          id: `evt_${randomUUID()}`,
          tenantId: input.tenantId,
          aggregateType: 'egress_delivery',
          aggregateId: id,
          type: 'egress.delivered',
          occurredAt: input.occurredAt,
          actorRef: input.requestedBy,
          correlationId: `corr_${input.sessionId}`,
          payload: {
            approvalId: input.approvalId,
            capabilityId: 'external.send',
            contentSha256: stored.sha256,
            evidenceRef: stored.ref,
            sessionId: input.sessionId,
            target,
          },
        });
      });
      save();
      return {
        id, tenantId: input.tenantId, sessionId: input.sessionId, approvalId: input.approvalId,
        capabilityId: 'external.send', target, fileName, contentSha256: stored.sha256,
        evidenceRef: stored.ref, status: 'delivered', sizeBytes: bytes.length,
        occurredAt: input.occurredAt, idempotencyKey: input.idempotencyKey,
      };
    } catch (error) {
      rmSync(temporaryPath, { force: true });
      rmSync(target, { force: true });
      throw error;
    }
  }

  list(tenantId: string, sessionId: string): EgressDeliveryRecord[] {
    return this.database.prepare('SELECT * FROM egress_deliveries WHERE tenant_id = ? AND session_id = ? ORDER BY occurred_at, id')
      .all<EgressRow>(tenantId, sessionId).map(mapRow);
  }
}

function requireDestinationDirectory(directory: string): string {
  if (!directory) throw new TypeError('External delivery destination directory is required');
  if (!existsSync(directory)) throw new Error('External delivery destination directory does not exist');
  if (lstatSync(directory).isSymbolicLink()) throw new Error('External delivery refuses a symbolic-link destination');
  const resolved = realpathSync(directory);
  if (!lstatSync(resolved).isDirectory()) throw new Error('External delivery target must be a directory');
  return resolved;
}

function validateInput(input: ApprovedArtifactExportInput): void {
  for (const [key, value] of Object.entries(input)) {
    if (typeof value !== 'string' || !value.trim()) throw new TypeError(`External delivery ${key} is required`);
  }
}

function mapRow(row: EgressRow): EgressDeliveryRecord {
  const result = JSON.parse(row.result_json) as JsonValue;
  const record = typeof result === 'object' && result !== null && !Array.isArray(result) ? result : {};
  return {
    id: row.id, tenantId: row.tenant_id, sessionId: row.session_id, approvalId: row.approval_id,
    capabilityId: row.capability_id, target: row.target, fileName: String(record.fileName ?? basename(row.target)),
    contentSha256: row.content_sha256, evidenceRef: row.evidence_ref, status: row.status,
    sizeBytes: typeof record.sizeBytes === 'number' ? record.sizeBytes : 0,
    occurredAt: row.occurred_at, idempotencyKey: row.idempotency_key,
  };
}
