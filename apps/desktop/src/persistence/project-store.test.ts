import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openPersistence } from './database.js';

const directories: string[] = [];

afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

describe('ProjectStore', () => {
  it('persists a human-twin project, expires temporary assistants, and keeps an auditable growth chain', () => {
    const directory = mkdtempSync(join(tmpdir(), 'hummer-project-'));
    directories.push(directory);
    let now = new Date('2026-09-01T08:00:00.000Z');
    const persistence = openPersistence({ dataDirectory: directory, now: () => now });
    const owner = persistence.identity.createCompany({ companyName: '北辰智能', displayName: '昆仑', email: 'kunlun@example.com' });
    const collaborator = persistence.identity.acceptInvitation({
      token: persistence.identity.createInvitation(owner.session.token, { contactType: 'email', contactValue: 'wufan@example.com', role: 'member' }).token,
      displayName: '吴帆', email: 'wufan@example.com',
    });
    const employee = persistence.organization.hireDigitalEmployee({
      id: 'employee_project_researcher', tenantId: owner.tenant.id, sponsorActorRef: `human:${owner.membership.humanUserId}`,
      departmentId: 'department_sales', name: '客户研究助手', jobTitle: '客户研究员', runtimeProfile: 'standard', autonomyLevel: 'L2', idempotencyKey: 'project-hire-001',
    });

    const project = persistence.projects.create({
      tenantId: owner.tenant.id, actorRef: `account:${owner.account.id}`, title: '华东重点客户项目', goal: '建立可验收的重点客户跟进清单',
      accountableHumanId: owner.membership.humanUserId, coordinatorTwinId: persistence.identity.listActiveTwins(owner.session.token, owner.membership.humanUserId)[0].id,
      collaborators: [{ humanUserId: collaborator.membership.humanUserId, twinId: persistence.identity.listActiveTwins(collaborator.session.token, collaborator.membership.humanUserId)[0].id }],
      assignments: [{ employeeId: employee.id, sponsorHumanId: owner.membership.humanUserId, permissionScope: 'project.read; project.draft', expiresAt: '2026-09-01T09:00:00.000Z' }],
      idempotencyKey: 'project-create-001',
    });
    const badCase = persistence.projects.recordBadCase({ tenantId: owner.tenant.id, projectId: project.id, workOrderId: 'wo_project_001', trajectoryRef: 'session:ses_source#3', reportedBy: `account:${owner.account.id}`, failedCriteria: '高潜客户排序遗漏行业优先级', idempotencyKey: 'project-badcase-001' });
    const revision = persistence.projects.createSopRevision({ tenantId: owner.tenant.id, projectId: project.id, badCaseId: badCase.id, targetActorRef: `employee:${employee.id}`, baseVersion: 'v1', candidateVersion: 'v2-rc1', diff: '先判断行业优先级，再检查资料完整度', scope: 'project', actorRef: `account:${owner.account.id}`, idempotencyKey: 'project-revision-001' });
    const evaluation = persistence.projects.recordEvaluation({ tenantId: owner.tenant.id, projectId: project.id, sopRevisionId: revision.id, sourceRunId: 'ses_source', candidateRunId: 'ses_candidate', criteria: '排序准确率与审批触发', metrics: { accuracy: 0.94, approvalStops: 1 }, verdict: 'passed', actorRef: `account:${owner.account.id}`, idempotencyKey: 'project-evaluation-001' });
    persistence.projects.promoteSopRevision({ tenantId: owner.tenant.id, projectId: project.id, sopRevisionId: revision.id, promotionScope: 'project', actorRef: `account:${owner.account.id}`, idempotencyKey: 'project-promote-001' });

    expect(persistence.projects.list(owner.tenant.id)).toEqual([expect.objectContaining({ id: project.id, memberCount: 5, activeAssignmentCount: 1 })]);
    expect(persistence.projects.getGrowthChain(owner.tenant.id, project.id)).toEqual(expect.objectContaining({ badCases: [expect.objectContaining({ id: badCase.id })], revisions: [expect.objectContaining({ id: revision.id, status: 'promoted' })], evaluations: [expect.objectContaining({ id: evaluation.id, verdict: 'passed' })] }));
    now = new Date('2026-09-01T09:00:01.000Z');
    expect(persistence.projects.releaseExpiredAssignments(owner.tenant.id, now.toISOString())).toBe(1);
    expect(persistence.projects.get(owner.tenant.id, project.id)).toEqual(expect.objectContaining({ activeAssignmentCount: 0 }));
    expect(persistence.verifyDomainEventIntegrity()).toEqual(expect.objectContaining({ valid: true }));
    persistence.close();

    const reopened = openPersistence({ dataDirectory: directory, now: () => now });
    expect(reopened.projects.get(owner.tenant.id, project.id)).toEqual(expect.objectContaining({ id: project.id, activeAssignmentCount: 0 }));
    expect(reopened.verifyDomainEventIntegrity()).toEqual(expect.objectContaining({ valid: true }));
    reopened.close();
  });

  it('does not return another tenant project', () => {
    const directory = mkdtempSync(join(tmpdir(), 'hummer-project-'));
    directories.push(directory);
    const persistence = openPersistence({ dataDirectory: directory });
    const first = persistence.identity.createCompany({ companyName: '甲公司', displayName: '甲', email: 'a@example.com' });
    const second = persistence.identity.createCompany({ companyName: '乙公司', displayName: '乙', email: 'b@example.com' });
    const project = persistence.projects.create({ tenantId: first.tenant.id, actorRef: `account:${first.account.id}`, title: '甲项目', goal: '仅甲可见', accountableHumanId: first.membership.humanUserId, coordinatorTwinId: persistence.identity.listActiveTwins(first.session.token, first.membership.humanUserId)[0].id, collaborators: [], assignments: [], idempotencyKey: 'tenant-project-001' });
    expect(persistence.projects.get(second.tenant.id, project.id)).toBeUndefined();
    expect(persistence.projects.list(second.tenant.id)).toEqual([]);
    persistence.close();
  });
});
