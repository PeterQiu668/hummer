import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { ApprovalPolicyStore } from './approval-policy-store.js';
import { DomainEventStore } from './domain-event-store.js';
import type { EvidenceStore } from './evidence-store.js';
import type { SqliteDatabase } from './sqlite.js';

export interface ControlledWriteInput {
  tenantId: string;
  sessionId: string;
  approvalId: string;
  action: string;
  requestedBy: string;
  relativePath: string;
  content: string;
  workspaceDirectory: string;
  occurredAt: string;
}

export interface ControlledWriteResult {
  id: string;
  action: string;
  relativePath: string;
  evidenceRef: string;
  sha256: string;
  sizeBytes: number;
}

export class ControlledWriteStore {
  private readonly events: DomainEventStore;

  constructor(
    database: SqliteDatabase,
    private readonly approvals: ApprovalPolicyStore,
    private readonly evidence: EvidenceStore,
  ) {
    this.events = new DomainEventStore(database);
  }

  write(input: ControlledWriteInput): ControlledWriteResult {
    validateInput(input);
    const approval = this.approvals.getEvidence(input.tenantId, input.sessionId, input.approvalId);
    if (!approval || approval.status !== 'approved') {
      throw new Error('Controlled write requires an approved approval for the current tenant and session');
    }
    if (approval.action !== input.action || approval.requestedBy !== input.requestedBy) {
      throw new Error('Controlled write does not match the approved action and requester');
    }

    const destination = safeDestination(input.workspaceDirectory, input.relativePath);
    if (existsSync(destination)) throw new Error('Controlled write refuses to overwrite an existing file');

    const bytes = Buffer.from(input.content, 'utf8');
    const stored = this.evidence.put(bytes, {
      tenantId: input.tenantId,
      sessionId: input.sessionId,
      mediaType: 'text/plain; charset=utf-8',
      name: basename(destination),
      createdAt: input.occurredAt,
      metadata: { action: input.action, approvalId: input.approvalId, relativePath: input.relativePath },
    });
    const temporaryPath = `${destination}.${randomUUID()}.tmp`;
    writeFileSync(temporaryPath, bytes, { flag: 'wx' });
    try {
      renameSync(temporaryPath, destination);
      const id = `write_${randomUUID()}`;
      this.events.append({
        id: `evt_${randomUUID()}`,
        tenantId: input.tenantId,
        aggregateType: 'controlled_write',
        aggregateId: id,
        type: 'controlled_write.executed',
        occurredAt: input.occurredAt,
        actorRef: input.requestedBy,
        correlationId: `corr_${input.sessionId}`,
        payload: {
          action: input.action,
          approvalId: input.approvalId,
          evidenceRef: stored.ref,
          relativePath: input.relativePath,
          sessionId: input.sessionId,
          sha256: stored.sha256,
          sizeBytes: stored.sizeBytes,
        },
      });
      return {
        id,
        action: input.action,
        relativePath: input.relativePath,
        evidenceRef: stored.ref,
        sha256: stored.sha256,
        sizeBytes: stored.sizeBytes,
      };
    } catch (error) {
      rmSync(temporaryPath, { force: true });
      rmSync(destination, { force: true });
      throw error;
    }
  }
}

function safeDestination(workspaceDirectory: string, relativePath: string): string {
  mkdirSync(workspaceDirectory, { recursive: true });
  const workspace = realpathSync(workspaceDirectory);
  const candidate = resolve(workspace, relativePath);
  assertWithinWorkspace(workspace, candidate);
  createSafeParentDirectories(workspace, dirname(candidate));
  const parent = realpathSync(dirname(candidate));
  assertWithinWorkspace(workspace, parent);
  if (existsSync(candidate) && lstatSync(candidate).isSymbolicLink()) {
    throw new Error('Controlled write refuses symbolic-link destinations');
  }
  return candidate;
}

function createSafeParentDirectories(workspace: string, parent: string): void {
  const parentRelative = relative(workspace, parent);
  assertWithinWorkspace(workspace, parent);
  let cursor = workspace;
  for (const segment of parentRelative.split(/[\\/]/).filter(Boolean)) {
    cursor = join(cursor, segment);
    if (existsSync(cursor)) {
      if (lstatSync(cursor).isSymbolicLink()) throw new Error('Controlled write refuses symbolic-link paths');
      continue;
    }
    mkdirSync(cursor);
  }
}

function assertWithinWorkspace(workspace: string, candidate: string): void {
  const pathFromWorkspace = relative(workspace, candidate);
  if (pathFromWorkspace === '..' || pathFromWorkspace.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(pathFromWorkspace)) {
    throw new Error('Controlled write destination is outside the workspace');
  }
}

function validateInput(input: ControlledWriteInput): void {
  for (const [key, value] of Object.entries({
    tenantId: input.tenantId,
    sessionId: input.sessionId,
    approvalId: input.approvalId,
    action: input.action,
    requestedBy: input.requestedBy,
    relativePath: input.relativePath,
    workspaceDirectory: input.workspaceDirectory,
    occurredAt: input.occurredAt,
  })) {
    if (typeof value !== 'string' || value.length === 0) throw new TypeError(`Controlled write ${key} is required`);
  }
  if (!input.action.startsWith('file.write') && input.action !== 'external.send.draft') {
    throw new TypeError('Controlled write only accepts file.write or external.send.draft capabilities');
  }
  if (typeof input.content !== 'string') throw new TypeError('Controlled write content must be text');
}
