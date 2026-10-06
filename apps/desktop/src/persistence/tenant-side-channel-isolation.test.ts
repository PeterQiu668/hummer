import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDiagnosticPack } from '../diagnostic-pack.js';
import { requireTenantWorkspace } from '../tenant-workspace-path.js';
import { WorkspaceExecService, type ContainerRunRequest } from '../workspace-exec-service.js';
import { openPersistence } from './database.js';
import { assembleOutcomeReceipt } from './outcome-receipt.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

describe('[TEN-P0C-DESKTOP-SIDE-CHANNELS] tenant receipt, export, and workspace boundaries', () => {
  it('[TEN-W4-READ-RECEIPT-OUTCOME] rejects foreign session, approval, evidence, outcome, and workspace-job references as unavailable', () => {
    const persistence = openPersistence({ dataDirectory: temporaryDirectory() });
    const companyA = createCompany(persistence, '侧信道甲', 'side-a@example.test');
    const companyB = createCompany(persistence, '侧信道乙', 'side-b@example.test');
    const tenantA = companyA.tenant.id;
    const tenantB = companyB.tenant.id;
    saveSession(persistence, tenantA, 'session_side_a', 'work_side_a');
    saveSession(persistence, tenantB, 'session_side_b', 'work_side_b');
    saveSession(persistence, tenantB, 'session_side_b_other', 'work_side_b_other');
    const approvalA = approve(persistence, companyA, 'session_side_a', 'approval_side_a', 'file.write.report');
    const evidenceA = persistence.evidence.put(Buffer.from('tenant-a-private'), {
      tenantId: tenantA, sessionId: 'session_side_a', mediaType: 'text/plain',
      createdAt: '2026-10-07T06:00:02.000Z',
    });
    const definitionA = definition(persistence, tenantA, `account:${companyA.account.id}`, 'a');
    const definitionB = definition(persistence, tenantB, `account:${companyB.account.id}`, 'b');
    const outcomeA = persistence.outcomes.recordOutcome({
      tenantId: tenantA, outcomeDefinitionId: definitionA.id, sessionId: 'session_side_a', workOrderId: 'work_side_a',
      approvalId: approvalA, evidenceRef: evidenceA.ref, verdict: 'accepted', acceptedBy: `account:${companyA.account.id}`,
      occurredAt: '2026-10-07T06:00:03.000Z', idempotencyKey: 'valid-outcome-a',
    });

    expect(errorMessage(() => persistence.outcomes.recordOutcome({
      tenantId: tenantB, outcomeDefinitionId: definitionB.id, sessionId: 'session_side_a',
      verdict: 'accepted', acceptedBy: `account:${companyB.account.id}`, occurredAt: '2026-10-07T06:01:00.000Z',
      idempotencyKey: 'foreign-session-outcome',
    }))).toBe(errorMessage(() => persistence.outcomes.recordOutcome({
      tenantId: tenantB, outcomeDefinitionId: definitionB.id, sessionId: 'session_unknown',
      verdict: 'accepted', acceptedBy: `account:${companyB.account.id}`, occurredAt: '2026-10-07T06:01:00.000Z',
      idempotencyKey: 'unknown-session-outcome',
    })));
    expect(() => persistence.outcomes.recordOutcome({
      tenantId: tenantB, outcomeDefinitionId: definitionB.id, sessionId: 'session_side_b', approvalId: approvalA,
      verdict: 'accepted', acceptedBy: `account:${companyB.account.id}`, occurredAt: '2026-10-07T06:01:01.000Z',
      idempotencyKey: 'foreign-approval-outcome',
    })).toThrow('Outcome reference is unavailable in the current tenant session');
    expect(() => persistence.outcomes.recordOutcome({
      tenantId: tenantB, outcomeDefinitionId: definitionB.id, sessionId: 'session_side_b', evidenceRef: evidenceA.ref,
      verdict: 'accepted', acceptedBy: `account:${companyB.account.id}`, occurredAt: '2026-10-07T06:01:02.000Z',
      idempotencyKey: 'foreign-evidence-outcome',
    })).toThrow('Outcome reference is unavailable in the current tenant session');

    const outcomeB = persistence.outcomes.recordOutcome({
      tenantId: tenantB, outcomeDefinitionId: definitionB.id, sessionId: 'session_side_b', workOrderId: 'work_side_b',
      verdict: 'accepted', acceptedBy: `account:${companyB.account.id}`, occurredAt: '2026-10-07T06:01:03.000Z',
      idempotencyKey: 'valid-outcome-b',
    });
    const receiptB = persistence.buildOutcomeReceipt(tenantB, outcomeB.id);
    expect(() => assembleOutcomeReceipt({
      tenantId: tenantB,
      outcome: outcomeA,
      definition: definitionB,
      costs: receiptB.costs,
      tools: receiptB.tools,
      approval: receiptB.approval,
      chainIntegrity: receiptB.chainIntegrity,
      generatedAt: receiptB.generatedAt,
      environment: {},
    })).toThrow('Outcome receipt data is unavailable in the current tenant session');
    expect(() => persistence.outcomes.recordCost({
      tenantId: tenantB, sessionId: 'session_side_b_other', outcomeEventId: outcomeB.id,
      engineProfileId: 'deepseek-standard', model: 'deepseek-v4-flash',
      usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 1 }, occurredAt: '2026-10-07T06:01:04.000Z',
      actorRef: `account:${companyB.account.id}`, idempotencyKey: 'mismatched-outcome-session-cost',
    })).toThrow('Outcome reference is unavailable in the current tenant session');
    expect(() => persistence.outcomes.recordCost({
      tenantId: tenantB, sessionId: 'session_side_b', outcomeEventId: outcomeA.id,
      engineProfileId: 'deepseek-standard', model: 'deepseek-v4-flash',
      usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 1 }, occurredAt: '2026-10-07T06:01:04.000Z',
      actorRef: `account:${companyB.account.id}`, idempotencyKey: 'foreign-outcome-cost',
    })).toThrow('Outcome event is unavailable in the current tenant');

    expect(errorMessage(() => persistence.workspaceExec.recordJob({
      tenantId: tenantB, sessionId: 'session_side_a', workOrderId: 'work_side_a', actorRef: 'employee:codex',
      argv: ['python', 'job.py'], exitCode: 0, durationMs: 1, artifacts: [], occurredAt: '2026-10-07T06:01:05.000Z',
    }))).toBe(errorMessage(() => persistence.workspaceExec.recordJob({
      tenantId: tenantB, sessionId: 'session_unknown', workOrderId: 'work_unknown', actorRef: 'employee:codex',
      argv: ['python', 'job.py'], exitCode: 0, durationMs: 1, artifacts: [], occurredAt: '2026-10-07T06:01:05.000Z',
    })));
    persistence.workspaceExec.recordJob({
      tenantId: tenantB, sessionId: 'session_side_b', workOrderId: 'work_side_b', actorRef: 'employee:codex',
      argv: ['python', 'job.py'], exitCode: 0, durationMs: 1, artifacts: [], occurredAt: '2026-10-07T06:01:06.000Z',
    });
    expect(persistence.listDomainEvents(companyA.session.token).some((event) => event.aggregateType === 'workspace_exec_job')).toBe(false);
    expect(persistence.listDomainEvents(companyB.session.token).some((event) => event.aggregateType === 'workspace_exec_job')).toBe(true);
    persistence.close();
  });

  it('[TEN-W4-WRITE-CONTROLLED-ARTIFACT] binds controlled writes to tenant directories and egress bytes to owned session evidence', () => {
    const root = temporaryDirectory();
    const workspace = join(root, 'shared-workspace');
    const destination = join(root, 'destination');
    mkdirSync(destination);
    const persistence = openPersistence({ dataDirectory: join(root, 'facts') });
    const companyA = createCompany(persistence, '路径甲', 'path-a@example.test');
    const companyB = createCompany(persistence, '路径乙', 'path-b@example.test');
    saveSession(persistence, companyA.tenant.id, 'session_path_a', 'work_path_a');
    saveSession(persistence, companyB.tenant.id, 'session_path_b', 'work_path_b');
    const approvalA = approve(persistence, companyA, 'session_path_a', 'approval_path_a', 'file.write.report');
    const approvalB = approve(persistence, companyB, 'session_path_b', 'approval_path_b', 'file.write.report');

    persistence.controlledWrites.write({
      tenantId: companyA.tenant.id, sessionId: 'session_path_a', approvalId: approvalA,
      action: 'file.write.report', requestedBy: 'employee:writer', relativePath: 'same/report.md', content: 'tenant-a',
      workspaceDirectory: workspace, occurredAt: '2026-10-07T07:00:03.000Z',
    });
    persistence.controlledWrites.write({
      tenantId: companyB.tenant.id, sessionId: 'session_path_b', approvalId: approvalB,
      action: 'file.write.report', requestedBy: 'employee:writer', relativePath: 'same/report.md', content: 'tenant-b',
      workspaceDirectory: workspace, occurredAt: '2026-10-07T07:00:03.000Z',
    });
    expect(readFileSync(join(requireTenantWorkspace(workspace, companyA.tenant.id), 'same/report.md'), 'utf8')).toBe('tenant-a');
    expect(readFileSync(join(requireTenantWorkspace(workspace, companyB.tenant.id), 'same/report.md'), 'utf8')).toBe('tenant-b');

    const egressApprovalB = approve(persistence, companyB, 'session_path_b', 'approval_egress_b', 'external.send');
    const sourceB = join(root, 'work_path_b');
    mkdirSync(sourceB);
    writeFileSync(join(sourceB, 'private.txt'), 'unowned-or-foreign', 'utf8');
    const exportInput = {
      tenantId: companyB.tenant.id, sessionId: 'session_path_b', approvalId: egressApprovalB,
      requestedBy: 'employee:writer', sourceWorkspaceDirectory: sourceB, sourceRelativePath: 'private.txt',
      destinationDirectory: destination, occurredAt: '2026-10-07T07:00:04.000Z', idempotencyKey: 'egress-b',
    };
    expect(() => persistence.egressDeliveries.exportApprovedArtifact(exportInput))
      .toThrow('Approved artifact is unavailable in the current tenant session');
    expect(existsSync(join(destination, 'private.txt'))).toBe(false);

    persistence.evidence.put(Buffer.from('unowned-or-foreign'), {
      tenantId: companyB.tenant.id, sessionId: 'session_path_b', mediaType: 'text/plain',
      createdAt: '2026-10-07T07:00:04.500Z',
    });
    expect(persistence.egressDeliveries.exportApprovedArtifact(exportInput)).toMatchObject({ status: 'delivered' });
    expect(readFileSync(join(destination, 'private.txt'), 'utf8')).toBe('unowned-or-foreign');
    persistence.close();
  });

  it('[TEN-W4-SIDE-DIAGNOSTIC-PATHS] redacts tenant, node, and absolute path material from diagnostics and isolates work-order directories', async () => {
    const tenantRef = 'tenant-private-customer';
    const nodeRef = 'node-private-laptop';
    const diagnostic = createDiagnosticPack({
      generatedAt: '2026-10-07T08:00:00Z', appVersion: '0.2.0', platform: 'win32', nodeVersion: '22.22.2',
      tenantRef, nodeRef,
      runtimeStatus: [{ runtime: 'codex', status: `failed in C:\\Users\\Alice\\${tenantRef}\\cache`, diagnostic: `/home/alice/${nodeRef}/trace.log` }],
      recentEvents: [{ occurredAt: '2026-10-07T07:59:00Z', component: 'workspace', code: 'failed', message: `${tenantRef} C:\\private\\result.txt` }],
      files: [{ path: `logs/${tenantRef}/runtime.jsonl`, bytes: 1, sha256: 'a'.repeat(64), category: 'log' }],
    });
    const serialized = JSON.stringify(diagnostic);
    expect(serialized).not.toContain(tenantRef);
    expect(serialized).not.toContain(nodeRef);
    expect(serialized).not.toContain('C:\\Users\\Alice');
    expect(serialized).not.toContain('/home/alice');

    const workspaceRoot = temporaryDirectory();
    const runContainer = vi.fn(async (request: ContainerRunRequest) => {
      if (request.purpose === 'self-check') return passingProbeResult();
      writeFileSync(join(request.workspaceDirectory, 'same.txt'), request.workspaceDirectory, 'utf8');
      return { exitCode: 0, stdout: '', stderr: '', durationMs: 1 };
    });
    const service = new WorkspaceExecService({ workspaceRoot, runContainer });
    await service.selfCheck();
    await service.execute({ orderId: 'work_a', argv: ['python', 'job.py'], files: [] });
    await service.execute({ orderId: 'work_b', argv: ['python', 'job.py'], files: [] });
    expect(readFileSync(join(workspaceRoot, 'work_a', 'same.txt'), 'utf8')).toContain('work_a');
    expect(readFileSync(join(workspaceRoot, 'work_b', 'same.txt'), 'utf8')).toContain('work_b');
  });
});

function createCompany(persistence: ReturnType<typeof openPersistence>, companyName: string, email: string) {
  return persistence.identity.createCompany({ companyName, displayName: `${companyName}负责人`, email });
}

function saveSession(persistence: ReturnType<typeof openPersistence>, tenantId: string, sessionId: string, workOrderId: string): void {
  persistence.runtimeEvents.saveSession({
    sessionId, tenantId, runtimeId: 'test', workOrderId,
    startedAt: '2026-10-07T06:00:00.000Z', plan: {}, handle: {},
  });
}

function approve(
  persistence: ReturnType<typeof openPersistence>,
  company: ReturnType<typeof createCompany>,
  sessionId: string,
  approvalId: string,
  action: string,
): string {
  const tenantId = company.tenant.id;
  persistence.runtimeEvents.save({
    sessionId, sequence: nextSequence(persistence, tenantId, sessionId), occurredAt: '2026-10-07T06:00:01.000Z',
    actorRef: 'employee:writer', type: 'approval_required', approvalId, tool: action, evidenceRefs: [],
  }, { tenantId, runtimeId: 'test', correlationId: `corr_${approvalId}` });
  persistence.approvalPolicies.authorize({
    tenantId, sessionId, approvalId, action, requestedBy: 'employee:writer', estimatedCostCny: null,
    approverActorRef: `account:${company.account.id}`, approved: true, occurredAt: '2026-10-07T06:00:01.500Z',
  });
  return approvalId;
}

function nextSequence(persistence: ReturnType<typeof openPersistence>, tenantId: string, sessionId: string): number {
  return persistence.runtimeEvents.listBySession(tenantId, sessionId).length + 1;
}

function definition(persistence: ReturnType<typeof openPersistence>, tenantId: string, actorRef: string, suffix: string) {
  return persistence.outcomes.defineOutcome({
    tenantId, actionPattern: `file.write.${suffix}`, title: `Outcome ${suffix}`, acceptanceCriteria: 'accepted',
    riskLevel: 'high', actorRef, idempotencyKey: `definition-${suffix}`,
  });
}

function errorMessage(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('Expected operation to fail');
}

function passingProbeResult() {
  return {
    exitCode: 0,
    stdout: JSON.stringify({ probes: [
      { name: 'inside-write', succeeded: true }, { name: 'path-escape', succeeded: false },
      { name: 'network-egress', succeeded: false }, { name: 'dns-resolution', succeeded: false },
      { name: 'raw-socket', succeeded: false },
    ] }),
    stderr: '', durationMs: 1,
  };
}

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'hummer-tenant-side-channel-'));
  temporaryDirectories.push(directory);
  return directory;
}
