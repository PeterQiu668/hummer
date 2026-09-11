import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, dialog, ipcMain, safeStorage } from 'electron';
import { CredentialVault } from './credential-vault.js';
import { customerEngineProfiles, engineProfileById, listEngineProfiles } from './engine-profiles.js';
import { enrichRuntimeEventEvidence } from './persistence-runtime.js';
import {
  openPersistence,
  type CreateCompanyInput,
  type DesktopPersistence,
  type HireDigitalEmployeeInput,
  type DefineOutcomeInput,
  type RecordCostInput,
  type RecordOutcomeInput,
  type WorkOrderIntakePayload,
} from './persistence/index.js';
import type { AuthorizeApprovalInput } from './persistence/approval-policy-store.js';
import { canonicalJson, type JsonValue } from './persistence/canonical-json.js';
import type { PersistableRuntimeEvent } from './persistence/runtime-event-store.js';
import type { RuntimeConnectorRecord } from './mcp-connector-registry.js';
import { probeLocalMcp } from './mcp-connection-probe.js';
import { WorkOrderInboxWatcher } from './work-order-inbox-watcher.js';
import { requireWorkspaceDirectory, requireWorkspaceFile } from './workspace-file-guard.js';

interface SessionRecordRequest {
  token: string;
  plan: Record<string, unknown>;
  handle: Record<string, unknown>;
}
interface AppendEventRequest extends SessionRecordRequest { event: Record<string, unknown> }
interface Authenticated<T> { token: string; input: T }
interface InvitationRequest {
  token: string;
  input: { contactType: 'email' | 'phone'; contactValue: string; role: 'admin' | 'member' };
}
interface AcceptInvitationRequest { token: string; displayName: string; email?: string; phone?: string }

export interface PersistenceHostRegistration {
  databasePath: string;
  resolveEngineCredential(token: string, engineProfileId: string, envKey: string): string | undefined;
  recordMcpConnectorStatus(token: string, record: RuntimeConnectorRecord): void;
  authorizeMcpTool(token: string, request: { serverName: string; toolName: string }): boolean;
  close(): void;
}
export interface PersistenceHostOptions {
  stopAll?: () => Promise<number>;
}


const CHANNELS = [
  'hummer:identity:create-company',
  'hummer:identity:accept-invitation',
  'hummer:identity:resume',
  'hummer:identity:list-tenants',
  'hummer:identity:switch-tenant',
  'hummer:identity:list-members',
  'hummer:identity:create-invitation',
  'hummer:persistence:list-sessions',
  'hummer:persistence:save-session',
  'hummer:persistence:append-event',
  'hummer:persistence:verify-integrity',
  'hummer:organization:list-employees',
  'hummer:organization:hire-employee',
  'hummer:projects:list',
  'hummer:projects:create',
  'hummer:projects:growth-chain',
  'hummer:projects:record-growth-review',
  'hummer:approval-policy:preview',
  'hummer:approval-policy:authorize',
  'hummer:approval-policy:evidence',
  'hummer:controlled-write:write',
  'hummer:execution-nodes:list',
  'hummer:execution-nodes:kill-all',
  'hummer:outcomes:define',
  'hummer:outcomes:record',
  'hummer:outcomes:record-cost',
  'hummer:outcomes:receipt',
  'hummer:outcomes:session-cost',
  'hummer:outcomes:list',
  'hummer:outcomes:export-receipt',
  'hummer:engine-profiles:list',
  'hummer:engine-credentials:configure',
  'hummer:engine-credentials:remove',
  'hummer:tools:list',
  'hummer:tools:verify-local-mcp',
  'hummer:tools:create-external-draft',
  'hummer:intake:list',
  'hummer:intake:list-all',
  'hummer:intake:submit-form',
  'hummer:intake:confirm',
  'hummer:intake:inbox',
  'hummer:intake:choose-inbox',
  'hummer:intake:configure-inbox',
] as const;

export function registerPersistenceHost(options: PersistenceHostOptions = {}): PersistenceHostRegistration {
  const dataDirectory = resolve(process.env.HUMMER_DATA_DIR ?? join(app.getPath('userData'), 'facts'));
  const workspaceDirectory = resolve(process.env.HUMMER_CODEX_CWD ?? process.cwd());
  const persistence = openPersistence({ dataDirectory });
  const inboxWatcher = new WorkOrderInboxWatcher();
  const credentialVault = new CredentialVault(persistence.engineCredentials, {
    available: () => safeStorage.isEncryptionAvailable(),
    protect: (value) => safeStorage.encryptString(value),
    unprotect: (value) => safeStorage.decryptString(value),
  });
  persistence.runtimeEvents.interruptStaleRealSessions(new Date().toISOString());
  const runtimeId = process.env.HUMMER_RUNTIME_SHELL === 'claude' ? 'claude-code' : 'codex-cli';
  const nodeIds = new Set<string>();

  ipcMain.handle('hummer:engine-profiles:list', (_event, token: string | null) => {
    const configured = new Set<string>();
    for (const profile of listEngineProfiles()) {
      if (process.env[profile.envKey]) configured.add(profile.envKey);
    }
    if (token) {
      const tenantId = persistence.identity.currentTenantId(token);
      credentialVault.statuses(tenantId).forEach((status) => configured.add(status.envKey));
    }
    return customerEngineProfiles(configured);
  });
  ipcMain.handle('hummer:engine-credentials:configure', (_event, request: { token: string; engineProfileId: string; credential: string }) => {
    const tenantId = persistence.identity.currentTenantId(request.token);
    const profile = requireCustomerEngineProfile(request.engineProfileId);
    return credentialVault.configure(tenantId, profile.id, profile.envKey, request.credential);
  });
  ipcMain.handle('hummer:engine-credentials:remove', (_event, request: { token: string; engineProfileId: string }) => {
    const tenantId = persistence.identity.currentTenantId(request.token);
    const profile = requireCustomerEngineProfile(request.engineProfileId);
    credentialVault.remove(tenantId, profile.id);
    return { engineProfileId: profile.id, envKey: profile.envKey, configured: false };
  });
  ipcMain.handle('hummer:tools:list', (_event, token: string) => {
    const context = persistence.identity.resumeSession(token);
    persistence.tools.ensureDefaults(context.tenant.id, `account:${context.account.id}`);
    return persistence.tools.listDefinitions(context.tenant.id);
  });
  ipcMain.handle('hummer:tools:verify-local-mcp', async (_event, token: string) => {
    const context = persistence.identity.resumeSession(token);
    const actorRef = `account:${context.account.id}`;
    persistence.tools.ensureDefaults(context.tenant.id, actorRef);
    const occurredAt = new Date().toISOString();
    try {
      await probeLocalMcp({
        executable: process.execPath,
        serverScript: fileURLToPath(new URL('./hummer-mcp-server.js', import.meta.url)),
        workspace: workspaceDirectory,
      });
      const connected = ['fs.read', 'doc.extract'].map((capabilityId) => persistence.tools.recordConnectionStatus({
        tenantId: context.tenant.id, capabilityId, connected: true, actorRef, occurredAt, error: null,
      }));
      return connected.find((definition) => definition.capabilityId === 'fs.read')!;
    } catch (error) {
      for (const capabilityId of ['fs.read', 'doc.extract']) persistence.tools.recordConnectionStatus({
        tenantId: context.tenant.id, capabilityId, connected: false, actorRef, occurredAt,
        error: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
      });
      throw error;
    }
  });
  ipcMain.handle('hummer:tools:create-external-draft', (_event, request: Authenticated<{
    sessionId: string;
    approvalId: string;
    requestedBy: string;
    relativePath: string;
    content: string;
    occurredAt: string;
    idempotencyKey: string;
  }>) => {
    const context = persistence.identity.resumeSession(request.token);
    persistence.tools.ensureDefaults(context.tenant.id, `account:${context.account.id}`);
    return persistence.builtinTools.createExternalSendDraft({
      ...request.input,
      tenantId: context.tenant.id,
      workspaceDirectory,
    });
  });
  const watchInbox = (tenantId: string, directory: string) => inboxWatcher.watch({
    tenantId,
    workspaceDirectory,
    inboxDirectory: directory,
    onFile: ({ relativePath }) => ingestInboxFile(persistence, tenantId, workspaceDirectory, relativePath),
  });
  for (const inbox of persistence.workOrderIntakes.listInboxes()) {
    try { watchInbox(inbox.tenantId, inbox.directory); } catch { /* The UI will surface an invalid saved path when the tenant opens the inbox settings. */ }
  }
  ipcMain.handle('hummer:intake:list', (_event, token: string) => {
    const tenantId = persistence.identity.currentTenantId(token);
    return persistence.workOrderIntakes.list(tenantId, 'pending');
  });
  ipcMain.handle('hummer:intake:list-all', (_event, token: string) => {
    const tenantId = persistence.identity.currentTenantId(token);
    return persistence.workOrderIntakes.list(tenantId);
  });
  ipcMain.handle('hummer:intake:submit-form', (_event, request: Authenticated<WorkOrderIntakePayload>) => {
    const context = persistence.identity.resumeSession(request.token);
    const receivedAt = new Date().toISOString();
    const payload = normalizeIntakePayload(request.input);
    return persistence.workOrderIntakes.intake({
      tenantId: context.tenant.id, source: 'form', externalRef: `form:${randomUUID()}`, payload,
      payloadBytes: Buffer.from(canonicalIntakePayload(payload)), payloadMediaType: 'application/json', payloadName: 'work-order.json',
      actorRef: `account:${context.account.id}`, receivedAt,
    });
  });
  ipcMain.handle('hummer:intake:confirm', (_event, request: Authenticated<{ id: string }>) => {
    const context = persistence.identity.resumeSession(request.token);
    return persistence.workOrderIntakes.confirm(context.tenant.id, request.input.id, `account:${context.account.id}`, new Date().toISOString());
  });
  ipcMain.handle('hummer:intake:inbox', (_event, token: string) => {
    const tenantId = persistence.identity.currentTenantId(token);
    return persistence.workOrderIntakes.inbox(tenantId);
  });
  ipcMain.handle('hummer:intake:choose-inbox', async (_event, token: string) => {
    const context = persistence.identity.resumeSession(token);
    const selected = await dialog.showOpenDialog({ title: '选择订单收件目录', defaultPath: workspaceDirectory, properties: ['openDirectory', 'createDirectory'] });
    if (selected.canceled || !selected.filePaths[0]) return persistence.workOrderIntakes.inbox(context.tenant.id);
    const directory = requireWorkspaceDirectory(workspaceDirectory, selected.filePaths[0]);
    const inbox = persistence.workOrderIntakes.configureInbox(context.tenant.id, directory, new Date().toISOString());
    watchInbox(context.tenant.id, directory);
    return inbox;
  });
  ipcMain.handle('hummer:intake:configure-inbox', (_event, request: { token: string; directory: string }) => {
    const context = persistence.identity.resumeSession(request.token);
    const directory = requireWorkspaceDirectory(workspaceDirectory, request.directory);
    const inbox = persistence.workOrderIntakes.configureInbox(context.tenant.id, directory, new Date().toISOString());
    watchInbox(context.tenant.id, directory);
    return inbox;
  });

  ipcMain.handle('hummer:identity:create-company', (_event, input: CreateCompanyInput) => persistence.identity.createCompany(input));
  ipcMain.handle('hummer:identity:accept-invitation', (_event, input: AcceptInvitationRequest) => persistence.identity.acceptInvitation(input));
  ipcMain.handle('hummer:identity:resume', (_event, token: string) => persistence.identity.resumeSession(token));
  ipcMain.handle('hummer:identity:list-tenants', (_event, token: string) => persistence.identity.listTenants(token));
  ipcMain.handle('hummer:identity:switch-tenant', (_event, request: { token: string; tenantId: string }) => persistence.identity.switchTenant(request.token, request.tenantId));
  ipcMain.handle('hummer:identity:list-members', (_event, token: string) => persistence.identity.listMembers(token));
  ipcMain.handle('hummer:identity:create-invitation', (_event, request: InvitationRequest) => persistence.identity.createInvitation(request.token, request.input));

  ipcMain.handle('hummer:persistence:list-sessions', (_event, token: string) => listSessions(persistence, token));
  ipcMain.handle('hummer:persistence:save-session', (_event, request: SessionRecordRequest) => saveSession(persistence, request));
  ipcMain.handle('hummer:persistence:append-event', (_event, request: AppendEventRequest) => {
    const descriptor = descriptorFromRequest(persistence, request);
    const event = asRuntimeEvent(request.event);
    const persisted = enrichRuntimeEventEvidence(persistence, event, workspaceDirectory, descriptor.tenantId);
    persistence.runtimeEvents.save(persisted, {
      tenantId: descriptor.tenantId,
      runtimeId: descriptor.runtimeId,
      correlationId: `corr_${descriptor.sessionId}`,
      workOrderId: descriptor.workOrderId,
    });
    persistence.tools.ensureDefaults(descriptor.tenantId, 'system:desktop-host');
    if (persisted.type === 'tool' && typeof persisted.tool === 'string') {
      const registered = persistence.tools.listDefinitions(descriptor.tenantId).some((tool) => tool.capabilityId === persisted.tool);
      if (registered) persistence.tools.recordInvocation({
        tenantId: descriptor.tenantId,
        sessionId: persisted.sessionId,
        capabilityId: persisted.tool,
        actorRef: persisted.actorRef,
        status: persisted.status === 'completed' ? 'completed' : persisted.status === 'blocked' ? 'failed' : 'declined',
        args: (persisted.args ?? {}) as JsonValue,
        result: (persisted.result ?? '') as JsonValue,
        durationMs: typeof persisted.durationMs === 'number' ? persisted.durationMs : null,
        evidenceRefs: persisted.evidenceRefs,
        occurredAt: persisted.occurredAt,
        idempotencyKey: `${persisted.sessionId}:${persisted.sequence}:${persisted.tool}`,
      });
    }
    return persisted;
  });
  ipcMain.handle('hummer:persistence:verify-integrity', (_event, token: string) => {
    persistence.identity.currentTenantId(token);
    return persistence.verifyDomainEventIntegrity();
  });
  ipcMain.handle('hummer:organization:list-employees', (_event, token: string) => {
    return persistence.organization.listDigitalEmployees(persistence.identity.currentTenantId(token));
  });
  ipcMain.handle('hummer:organization:hire-employee', (_event, request: Authenticated<Omit<HireDigitalEmployeeInput, 'tenantId' | 'sponsorActorRef'>>) => {
    const context = persistence.identity.resumeSession(request.token);
    const tenantSuffix = context.tenant.id.replace(/^tenant_/, '').slice(0, 12);
    return persistence.organization.hireDigitalEmployee({
      ...request.input,
      id: `${request.input.id}_${tenantSuffix}`,
      departmentId: `${request.input.departmentId}_${tenantSuffix}`,
      tenantId: context.tenant.id,
      sponsorActorRef: `human:${context.membership.humanUserId}`,
    });
  });
  ipcMain.handle('hummer:projects:list', (_event, token: string) => {
    const tenantId = persistence.identity.currentTenantId(token);
    persistence.projects.releaseExpiredAssignments(tenantId);
    return persistence.projects.list(tenantId);
  });
  ipcMain.handle('hummer:projects:create', (_event, request: Authenticated<{
    title: string; goal: string; coordinatorTwinId: string;
    collaborators: Array<{ humanUserId: string; twinId: string }>;
    assignments: Array<{ employeeId: string; sponsorHumanId: string; permissionScope: string; expiresAt: string; workOrderId?: string }>;
    idempotencyKey: string;
  }>) => {
    const context = persistence.identity.resumeSession(request.token);
    return persistence.projects.create({ ...request.input, tenantId: context.tenant.id, actorRef: `account:${context.account.id}`, accountableHumanId: context.membership.humanUserId });
  });
  ipcMain.handle('hummer:projects:growth-chain', (_event, request: Authenticated<{ projectId: string }>) => {
    const tenantId = persistence.identity.currentTenantId(request.token);
    return persistence.projects.getGrowthChain(tenantId, request.input.projectId);
  });
  ipcMain.handle('hummer:projects:record-growth-review', (_event, request: Authenticated<{
    projectId: string; workOrderId?: string; trajectoryRef: string; failedCriteria: string; targetActorRef: string;
    baseVersion: string; candidateVersion: string; diff: string; sourceRunId: string; candidateRunId: string;
    criteria: string; metrics: JsonValue; verdict: 'passed' | 'failed' | 'inconclusive'; promotionScope: 'private' | 'project' | 'department' | 'organization'; idempotencyKey: string;
  }>) => {
    const context = persistence.identity.resumeSession(request.token);
    const actorRef = `account:${context.account.id}`;
    const badCase = persistence.projects.recordBadCase({ tenantId: context.tenant.id, projectId: request.input.projectId, workOrderId: request.input.workOrderId, trajectoryRef: request.input.trajectoryRef, reportedBy: actorRef, failedCriteria: request.input.failedCriteria, idempotencyKey: `${request.input.idempotencyKey}:badcase` });
    const revision = persistence.projects.createSopRevision({ tenantId: context.tenant.id, projectId: request.input.projectId, badCaseId: badCase.id, targetActorRef: request.input.targetActorRef, baseVersion: request.input.baseVersion, candidateVersion: request.input.candidateVersion, diff: request.input.diff, scope: 'project', actorRef, idempotencyKey: `${request.input.idempotencyKey}:revision` });
    const evaluation = persistence.projects.recordEvaluation({ tenantId: context.tenant.id, projectId: request.input.projectId, sopRevisionId: revision.id, sourceRunId: request.input.sourceRunId, candidateRunId: request.input.candidateRunId, criteria: request.input.criteria, metrics: request.input.metrics, verdict: request.input.verdict, actorRef, idempotencyKey: `${request.input.idempotencyKey}:evaluation` });
    const promoted = request.input.verdict === 'passed' ? persistence.projects.promoteSopRevision({ tenantId: context.tenant.id, projectId: request.input.projectId, sopRevisionId: revision.id, promotionScope: request.input.promotionScope, actorRef, idempotencyKey: `${request.input.idempotencyKey}:promotion` }) : revision;
    return { badCase, revision: promoted, evaluation };
  });  ipcMain.handle('hummer:approval-policy:preview', (_event, request: Authenticated<{ action: string; requestedBy: string; estimatedCostCny: number | null }>) => {
    const context = persistence.identity.resumeSession(request.token);
    const decision = persistence.approvalPolicies.preview(context.tenant.id, request.input);
    const rule = decision.policyId ? persistence.approvalPolicies.list(context.tenant.id).find((candidate) => candidate.id === decision.policyId) : undefined;
    const approver = decision.approverActorRef ? persistence.identity.resolveActor(request.token, decision.approverActorRef) : undefined;
    return {
      ...decision,
      approverDisplayName: approver?.displayName ?? null,
      actionPattern: rule?.actionPattern ?? null,
      riskLevel: rule?.riskLevel ?? null,
      budgetLimitCny: rule?.budgetLimitCny ?? null,
    };
  });  ipcMain.handle('hummer:approval-policy:authorize', (_event, request: Authenticated<Omit<AuthorizeApprovalInput, 'tenantId' | 'approverActorRef'>>) => {
    const context = persistence.identity.resumeSession(request.token);
    return persistence.approvalPolicies.authorize({
      ...request.input,
      tenantId: context.tenant.id,
      approverActorRef: `account:${context.account.id}`,
    });
  });
  ipcMain.handle('hummer:approval-policy:evidence', (_event, request: Authenticated<{ sessionId: string; approvalId: string }>) => {
    const context = persistence.identity.resumeSession(request.token);
    const evidence = persistence.approvalPolicies.getEvidence(context.tenant.id, request.input.sessionId, request.input.approvalId);
    if (!evidence) throw new Error('Approval evidence is unavailable in the current tenant');
    const approver = evidence.approverActorRef ? persistence.identity.resolveActor(request.token, evidence.approverActorRef) : undefined;
    const decisionActor = evidence.decisionActorRef ? persistence.identity.resolveActor(request.token, evidence.decisionActorRef) : undefined;
    return { ...evidence, approverDisplayName: approver?.displayName ?? null, decisionActorDisplayName: decisionActor?.displayName ?? null };
  });
  ipcMain.handle('hummer:controlled-write:write', (_event, request: Authenticated<{
    sessionId: string; approvalId: string; action: string; requestedBy: string; relativePath: string; content: string; occurredAt: string;
  }>) => {
    const tenantId = persistence.identity.currentTenantId(request.token);
    return persistence.controlledWrites.write({ ...request.input, tenantId, workspaceDirectory });
  });
  ipcMain.handle('hummer:execution-nodes:list', (_event, token: string) => {
    const tenantId = persistence.identity.currentTenantId(token);
    const nodeId = `node_local_${tenantId.replace(/^tenant_/, '').slice(0, 12)}`;
    persistence.executionNodes.registerLocal({
      id: nodeId, tenantId, displayName: process.env.COMPUTERNAME ?? '本地执行节点', runtimeId,
      cwd: workspaceDirectory,
      permissionScope: 'read-only runtime; controlled-write approval-required',
      lastSeenAt: new Date().toISOString(),
    });
    nodeIds.add(nodeId);
    return persistence.executionNodes.list(tenantId);
  });
  ipcMain.handle('hummer:execution-nodes:kill-all', async (_event, token: string) => {
    persistence.identity.currentTenantId(token);
    return { killed: await options.stopAll?.() ?? 0 };
  });
  ipcMain.handle('hummer:outcomes:define', (_event, request: Authenticated<Omit<DefineOutcomeInput, 'tenantId' | 'actorRef'>>) => {
    const context = persistence.identity.resumeSession(request.token);
    return persistence.outcomes.defineOutcome({
      ...request.input,
      tenantId: context.tenant.id,
      actorRef: `account:${context.account.id}`,
    });
  });
  ipcMain.handle('hummer:outcomes:record', (_event, request: Authenticated<Omit<RecordOutcomeInput, 'tenantId' | 'acceptedBy'>>) => {
    const context = persistence.identity.resumeSession(request.token);
    return persistence.outcomes.recordOutcome({
      ...request.input,
      tenantId: context.tenant.id,
      acceptedBy: `account:${context.account.id}`,
    });
  });
  ipcMain.handle('hummer:outcomes:record-cost', (_event, request: Authenticated<Omit<RecordCostInput, 'tenantId' | 'actorRef'>>) => {
    const context = persistence.identity.resumeSession(request.token);
    return persistence.outcomes.recordCost({
      ...request.input,
      tenantId: context.tenant.id,
      actorRef: `account:${context.account.id}`,
    });
  });
  ipcMain.handle('hummer:outcomes:receipt', (_event, request: Authenticated<{ outcomeEventId: string }>) => {
    const tenantId = persistence.identity.currentTenantId(request.token);
    return persistence.buildOutcomeReceipt(tenantId, request.input.outcomeEventId);
  });
  ipcMain.handle('hummer:outcomes:session-cost', (_event, request: Authenticated<{ sessionId: string }>) => {
    const tenantId = persistence.identity.currentTenantId(request.token);
    return persistence.outcomes.sessionCostSummary(tenantId, request.input.sessionId);
  });
  ipcMain.handle('hummer:outcomes:list', (_event, token: string) => {
    const tenantId = persistence.identity.currentTenantId(token);
    return persistence.outcomes.listEvents(tenantId).map((outcome) => {
      const definition = persistence.outcomes.getDefinition(tenantId, outcome.outcomeDefinitionId);
      if (!definition) throw new Error('Outcome definition is unavailable in the current tenant');
      const costs = persistence.outcomes.listCosts(tenantId, outcome.id);
      return { outcome, definition, totalCostCny: costs.reduce((total, cost) => total + cost.costCny, 0), costCount: costs.length };
    });
  });
  ipcMain.handle('hummer:outcomes:export-receipt', (_event, request: Authenticated<{ outcomeEventId: string }>) => {
    const tenantId = persistence.identity.currentTenantId(request.token);
    return JSON.stringify(persistence.buildVerifiableOutcomeReceipt(tenantId, request.input.outcomeEventId), null, 2);
  });

  return {
    databasePath: persistence.databasePath,
    resolveEngineCredential: (token, engineProfileId, envKey) => {
      const tenantId = persistence.identity.currentTenantId(token);
      return credentialVault.resolve(tenantId, engineProfileId, envKey) ?? process.env[envKey];
    },
    recordMcpConnectorStatus: (token, record) => {
      const context = persistence.identity.resumeSession(token);
      persistence.tools.ensureDefaults(context.tenant.id, `account:${context.account.id}`);
      if (record.technicalName !== 'hummer_local') return;
      for (const capabilityId of ['fs.read', 'doc.extract']) persistence.tools.recordConnectionStatus({
        tenantId: context.tenant.id, capabilityId, connected: record.status === 'connected',
        actorRef: 'system:codex-host', occurredAt: record.checkedAt, error: record.error,
      });
    },
    authorizeMcpTool: (token, request) => {
      const context = persistence.identity.resumeSession(token);
      persistence.tools.ensureDefaults(context.tenant.id, `account:${context.account.id}`);
      const definition = persistence.tools.listDefinitions(context.tenant.id).find((candidate) => (
        candidate.endpoint.serverName === request.serverName && candidate.endpoint.toolName === request.toolName
      ));
      return definition?.status === 'verified' && definition.riskLevel === 'low';
    },
    close: () => {
      inboxWatcher.close();
      CHANNELS.forEach((channel) => ipcMain.removeHandler(channel));
      nodeIds.forEach((nodeId) => persistence.executionNodes.markOffline(nodeId, new Date().toISOString()));
      persistence.close();
    },
  };
}

function ingestInboxFile(persistence: DesktopPersistence, tenantId: string, workspaceDirectory: string, requestedPath: string): void {
  const file = requireWorkspaceFile({ workspaceDirectory, requestedPath, capability: 'work_order_intake', maxBytes: 25 * 1024 * 1024 });
  const bytes = readFileSync(file.absolutePath);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const office = ['.xlsx', '.docx', '.pdf'].includes(file.extension);
  const text = ['.txt', '.md', '.json', '.csv'].includes(file.extension);
  const executable = office || text;
  const tool = office ? 'doc.extract' : text ? 'fs.read' : null;
  const prompt = tool
    ? `使用 ${tool} 读取 ${requestedPath}，提取订单目标与交付要求，生成一份可验收的订单处理结果。`
    : `收到文件 ${requestedPath}；当前没有实现该文件类型的读取能力，请先转换为 XLSX、DOCX、PDF、TXT、MD、JSON 或 CSV。`;
  persistence.workOrderIntakes.intake({
    tenantId, source: 'folder', externalRef: `folder:${requestedPath}:${digest}`, actorRef: 'system:inbox-watcher',
    receivedAt: new Date().toISOString(), payloadBytes: bytes, payloadMediaType: intakeMediaType(file.extension), payloadName: requestedPath,
    payload: {
      title: `处理新订单：${requestedPath}`, target: '读取订单资料并完成明确交付', expectedDeliverable: '订单处理结果与可验证回执',
      assignee: '自动推荐', dueAt: null, attachmentNames: [requestedPath], prompt, executable, suggestedCapabilities: tool ? [tool] : [],
    },
  });
}

function normalizeIntakePayload(payload: WorkOrderIntakePayload): WorkOrderIntakePayload {
  const attachmentNames = Array.isArray(payload.attachmentNames) ? payload.attachmentNames.map((name) => String(name).trim()).filter(Boolean) : [];
  const title = String(payload.title ?? '').trim();
  const target = String(payload.target ?? '').trim();
  const expectedDeliverable = String(payload.expectedDeliverable ?? '').trim();
  const assignee = String(payload.assignee ?? '自动推荐').trim() || '自动推荐';
  const dueAt = payload.dueAt ? String(payload.dueAt) : null;
  return {
    title, target, expectedDeliverable, assignee, dueAt, attachmentNames,
    prompt: String(payload.prompt ?? `${title}。目标：${target}。期望交付：${expectedDeliverable}。附件：${attachmentNames.join('、') || '无'}。`).trim(),
    executable: true,
  };
}

function canonicalIntakePayload(payload: WorkOrderIntakePayload): string {
  return canonicalJson(payload);
}

function intakeMediaType(extension: string): string {
  return ({
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.pdf': 'application/pdf',
    '.txt': 'text/plain', '.md': 'text/markdown', '.json': 'application/json', '.csv': 'text/csv',
  } as Record<string, string>)[extension] ?? 'application/octet-stream';
}

function requireCustomerEngineProfile(engineProfileId: string) {
  const profile = engineProfileById(engineProfileId);
  if (profile.customerVisible === false) throw new Error('Internal engine profiles cannot be configured from the customer UI');
  return profile;
}

function listSessions(persistence: DesktopPersistence, token: string): Array<Record<string, JsonValue>> {
  const tenantId = persistence.identity.currentTenantId(token);
  return persistence.runtimeEvents.listSessions().filter((descriptor) => descriptor.tenantId === tenantId).map((descriptor) => ({
    plan: descriptor.plan,
    handle: descriptor.handle,
    events: persistence.runtimeEvents.listBySession(descriptor.sessionId) as JsonValue,
  }));
}

function saveSession(persistence: DesktopPersistence, request: SessionRecordRequest): void {
  const descriptor = descriptorFromRequest(persistence, request);
  persistence.runtimeEvents.saveSession({
    ...descriptor,
    startedAt: new Date().toISOString(),
    plan: asJsonValue(request.plan),
    handle: asJsonValue(request.handle),
  });
}

function descriptorFromRequest(persistence: DesktopPersistence, request: SessionRecordRequest) {
  const sessionId = requiredString(request.handle, 'sessionId');
  const runtimeId = requiredString(request.handle, 'runtimeId');
  const planId = requiredString(request.plan, 'id');
  return {
    sessionId,
    runtimeId,
    tenantId: persistence.identity.currentTenantId(request.token),
    workOrderId: typeof request.plan.workOrderId === 'string' && request.plan.workOrderId
      ? request.plan.workOrderId
      : `wo_${planId.replace(/^plan_/, '')}`,
  };
}

function asRuntimeEvent(value: Record<string, unknown>): PersistableRuntimeEvent {
  const normalized = JSON.parse(JSON.stringify(value)) as PersistableRuntimeEvent;
  if (!Array.isArray(normalized.evidenceRefs)) normalized.evidenceRefs = [];
  return normalized;
}

function asJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function requiredString(value: Record<string, unknown>, key: string): string {
  const result = value[key];
  if (typeof result !== 'string' || !result) throw new TypeError(`Persistence request requires ${key}`);
  return result;
}
