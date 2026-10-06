import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
}));

vi.mock('electron', () => ({
  app: { getPath: () => process.cwd(), getVersion: () => 'test' },
  dialog: { showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })) },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => electron.handlers.set(channel, handler),
    removeHandler: (channel: string) => electron.handlers.delete(channel),
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
}));

import { registerPersistenceHost, type PersistenceHostRegistration } from './persistence-host.js';
import type { IdentityContext, MembershipRole } from './persistence/index.js';

interface RoleSessions {
  owner: IdentityContext;
  admin: IdentityContext;
  member: IdentityContext;
  auditor: IdentityContext;
  operator: IdentityContext;
}

let directory = '';
let registration: PersistenceHostRegistration;
let identities: RoleSessions;
let originalDataDirectory: string | undefined;

beforeEach(async () => {
  originalDataDirectory = process.env.HUMMER_DATA_DIR;
  directory = mkdtempSync(join(tmpdir(), 'hummer-role-host-'));
  process.env.HUMMER_DATA_DIR = directory;
  registration = registerPersistenceHost();
  identities = await createRoleSessions();
});

afterEach(() => {
  registration.close();
  electron.handlers.clear();
  if (originalDataDirectory === undefined) delete process.env.HUMMER_DATA_DIR;
  else process.env.HUMMER_DATA_DIR = originalDataDirectory;
  rmSync(directory, { recursive: true, force: true });
});

describe('[TEN-ROLE-DESKTOP-IPC] authenticated Desktop role boundary', () => {
  it('enforces invitation management and task creation from the authenticated role', async () => {
    for (const role of ['member', 'auditor', 'operator'] as const) {
      await expect(invoke('hummer:identity:create-invitation', {
        token: identities[role].session.token,
        input: { contactType: 'email', contactValue: `${role}-forbidden@example.test`, role: 'member' },
      })).rejects.toThrow(/role policy denied manage_members/);
    }
    await expect(invoke('hummer:identity:create-invitation', {
      token: identities.admin.session.token,
      input: { contactType: 'email', contactValue: 'admin-allowed@example.test', role: 'member' },
    })).resolves.toMatchObject({ tenantId: identities.owner.tenant.id, role: 'member' });

    await expect(invoke('hummer:intake:submit-form', {
      token: identities.auditor.session.token,
      input: intakePayload('auditor denied'),
    })).rejects.toThrow(/role policy denied create_task/);

    for (const role of ['owner', 'admin', 'member', 'operator'] as const) {
      const intake = await invoke<{ tenantId: string; payload: Record<string, unknown> }>('hummer:intake:submit-form', {
        token: identities[role].session.token,
        input: { ...intakePayload(`${role} task`), tenantId: 'tenant-renderer-cannot-select' },
      });
      expect(intake.tenantId).toBe(identities.owner.tenant.id);
      expect(intake.payload).not.toHaveProperty('tenantId');
    }
  });

  it('enforces participant and node context for final acceptance and receipt/audit reads', async () => {
    const participantIntake = await invoke<{ id: string }>('hummer:intake:submit-form', {
      token: identities.member.session.token,
      input: intakePayload('member-owned task'),
    });
    const confirmed = await invoke<{ workOrderId: string }>('hummer:intake:confirm', {
      token: identities.member.session.token,
      input: { id: participantIntake.id },
    });
    await expect(invoke('hummer:intake:confirm', {
      token: identities.auditor.session.token,
      input: { id: participantIntake.id },
    })).rejects.toThrow(/role policy denied create_task/);

    const sessionId = 'session_role_acceptance';
    await saveSession(identities.member.session.token, sessionId, confirmed.workOrderId);
    const definition = await invoke<{ id: string }>('hummer:outcomes:define', {
      token: identities.owner.session.token,
      input: {
        actionPattern: 'task.complete', title: 'Task completion', acceptanceCriteria: 'Evidence is complete',
        unitPriceCny: null, riskLevel: 'low', idempotencyKey: 'role-definition-1',
      },
    });
    const outcomeInput = {
      outcomeDefinitionId: definition.id,
      workOrderId: confirmed.workOrderId,
      sessionId,
      verdict: 'accepted',
      occurredAt: '2026-10-07T01:00:00.000Z',
      idempotencyKey: 'role-outcome-1',
      tenantId: 'tenant-renderer-cannot-select',
    };

    for (const role of ['auditor', 'operator'] as const) {
      await expect(invoke('hummer:outcomes:record', {
        token: identities[role].session.token,
        input: outcomeInput,
      })).rejects.toThrow(/final_acceptance_role_forbidden/);
    }
    const outcome = await invoke<{ id: string; tenantId: string }>('hummer:outcomes:record', {
      token: identities.member.session.token,
      input: outcomeInput,
    });
    expect(outcome.tenantId).toBe(identities.owner.tenant.id);

    const outsider = await inviteAndAccept('member', 'outsider@example.test', 'Outsider');
    await expect(receipt(outsider.session.token, outcome.id)).rejects.toThrow(/member_requires_participation/);
    await expect(receipt(identities.member.session.token, outcome.id)).resolves.toMatchObject({ tenantId: identities.owner.tenant.id });
    await expect(receipt(identities.auditor.session.token, outcome.id)).resolves.toMatchObject({ tenantId: identities.owner.tenant.id });
    await expect(receipt(identities.operator.session.token, outcome.id)).rejects.toThrow(/operator_requires_node_related_read/);

    await invoke('hummer:execution-nodes:list', identities.operator.session.token);
    await expect(receipt(identities.operator.session.token, outcome.id)).resolves.toMatchObject({ tenantId: identities.owner.tenant.id });
    await expect(invoke<string>('hummer:outcomes:export-receipt', {
      token: identities.auditor.session.token,
      input: { outcomeEventId: outcome.id },
    })).resolves.toContain(outcome.id);

    expect(await invoke<unknown[]>('hummer:outcomes:list', outsider.session.token)).toEqual([]);
    expect(await invoke<unknown[]>('hummer:outcomes:list', identities.auditor.session.token)).toHaveLength(1);
    expect(await invoke<unknown[]>('hummer:persistence:list-sessions', outsider.session.token)).toEqual([]);
    expect(await invoke<unknown[]>('hummer:persistence:list-sessions', identities.auditor.session.token)).toHaveLength(1);
  });

  it('enforces high-risk approval roles in persistence and runtime authorization ports', async () => {
    const sessionId = 'session_role_approval';
    await saveSession(identities.owner.session.token, sessionId, 'wo_role_approval');
    await invoke('hummer:persistence:append-event', {
      token: identities.owner.session.token,
      plan: { id: 'plan_role_approval', workOrderId: 'wo_role_approval' },
      handle: { sessionId, runtimeId: 'codex-cli' },
      event: {
        sessionId, sequence: 1, occurredAt: '2026-10-07T02:00:00.000Z', actorRef: 'employee:codex',
        type: 'approval_required', approvalId: 'approval_role_1', evidenceRefs: [],
      },
    });
    const authorizationInput = {
      sessionId,
      approvalId: 'approval_role_1',
      action: 'file.write.report',
      requestedBy: `account:${identities.owner.account.id}`,
      estimatedCostCny: 1,
      approved: true,
      occurredAt: '2026-10-07T02:01:00.000Z',
      tenantId: 'tenant-renderer-cannot-select',
      approverActorRef: 'account:renderer-cannot-select',
    };
    for (const role of ['member', 'auditor'] as const) {
      await expect(invoke('hummer:approval-policy:authorize', {
        token: identities[role].session.token,
        input: authorizationInput,
      })).rejects.toThrow(/role policy denied approve_high_risk/);
    }
    await expect(invoke('hummer:approval-policy:authorize', {
      token: identities.owner.session.token,
      input: authorizationInput,
    })).resolves.toMatchObject({ approved: true });

    await expect(invoke('hummer:approval-policy:evidence', {
      token: identities.member.session.token,
      input: { sessionId, approvalId: 'approval_role_1' },
    })).rejects.toThrow(/member_requires_participation/);
    await expect(invoke('hummer:approval-policy:evidence', {
      token: identities.auditor.session.token,
      input: { sessionId, approvalId: 'approval_role_1' },
    })).resolves.toMatchObject({ decisionActorRef: `account:${identities.owner.account.id}` });

    expect(() => registration.authorizeRuntimeApproval(identities.auditor.session.token, {
      riskLevel: 'high', initiatedByActorId: '', approvalScope: 'write',
    })).toThrow(/role policy denied approve_high_risk/);
    expect(() => registration.authorizeRuntimeApproval(identities.operator.session.token, {
      riskLevel: 'high', initiatedByActorId: '', approvalScope: 'other',
    })).toThrow(/operator_requires_egress_or_write/);
    expect(() => registration.authorizeRuntimeApproval(identities.operator.session.token, {
      riskLevel: 'high', initiatedByActorId: '', approvalScope: 'write',
    })).not.toThrow();
  });
});

async function createRoleSessions(): Promise<RoleSessions> {
  const owner = await invoke<IdentityContext>('hummer:identity:create-company', {
    companyName: 'Role policy tenant', displayName: 'Owner', email: 'owner@example.test',
  });
  const admin = await inviteAndAccept('admin', 'admin@example.test', 'Admin', owner);
  const member = await inviteAndAccept('member', 'member@example.test', 'Member', owner);
  const auditor = await inviteAndAccept('auditor', 'auditor@example.test', 'Auditor', owner);
  const operator = await inviteAndAccept('operator', 'operator@example.test', 'Operator', owner);
  return { owner, admin, member, auditor, operator };
}

async function inviteAndAccept(
  role: Exclude<MembershipRole, 'owner'>,
  email: string,
  displayName: string,
  owner: IdentityContext = identities.owner,
): Promise<IdentityContext> {
  const invitation = await invoke<{ token: string }>('hummer:identity:create-invitation', {
    token: owner.session.token,
    input: { contactType: 'email', contactValue: email, role },
  });
  return invoke('hummer:identity:accept-invitation', { token: invitation.token, displayName, email });
}

function intakePayload(title: string) {
  return {
    title,
    target: 'Role enforcement',
    expectedDeliverable: 'Verified result',
    assignee: 'auto',
    dueAt: null,
    attachmentNames: [],
    prompt: 'Enforce the authenticated role policy.',
  };
}

function saveSession(token: string, sessionId: string, workOrderId: string): Promise<unknown> {
  return invoke('hummer:persistence:save-session', {
    token,
    plan: { id: `plan_${sessionId}`, workOrderId, prompt: 'Role policy test' },
    handle: { sessionId, runtimeId: 'codex-cli' },
  });
}

function receipt(token: string, outcomeEventId: string): Promise<{ tenantId: string }> {
  return invoke('hummer:outcomes:receipt', { token, input: { outcomeEventId } });
}

function invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = electron.handlers.get(channel);
  if (!handler) throw new Error(`Missing IPC handler ${channel}`);
  return Promise.resolve().then(() => handler({}, ...args) as T);
}
