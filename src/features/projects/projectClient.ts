import { currentSessionToken } from '../identity/identityClient';

export interface ProjectRecord { id: string; tenantId: string; title: string; goal: string; accountableHumanId: string; coordinatorTwinId: string; status: string; memberCount: number; activeAssignmentCount: number; createdAt: string; updatedAt: string }
export interface ProjectGrowthChain { badCases: Array<{ id: string; failedCriteria: string; trajectoryRef: string }>; revisions: Array<{ id: string; candidateVersion: string; diff: string; status: string; promotedScope: string | null }>; evaluations: Array<{ id: string; sourceRunId: string; candidateRunId: string; verdict: string }> }
export interface CreateProjectCommand { title: string; goal: string; coordinatorTwinId: string; collaborators: Array<{ humanUserId: string; twinId: string }>; assignments: Array<{ employeeId: string; sponsorHumanId: string; permissionScope: string; expiresAt: string; workOrderId?: string }>; idempotencyKey: string }
export interface GrowthReviewCommand { projectId: string; workOrderId?: string; trajectoryRef: string; failedCriteria: string; targetActorRef: string; baseVersion: string; candidateVersion: string; diff: string; sourceRunId: string; candidateRunId: string; criteria: string; metrics: Record<string, number>; verdict: 'passed' | 'failed' | 'inconclusive'; promotionScope: 'private' | 'project' | 'department' | 'organization'; idempotencyKey: string }
interface DesktopProjectsHost { list(token: string): Promise<ProjectRecord[]>; create(request: { token: string; input: CreateProjectCommand }): Promise<ProjectRecord>; growthChain(request: { token: string; input: { projectId: string } }): Promise<ProjectGrowthChain>; recordGrowthReview(request: { token: string; input: GrowthReviewCommand }): Promise<{ revision: { status: string } }> }
export interface ProjectsPort { list(): Promise<ProjectRecord[]>; create(command: CreateProjectCommand): Promise<ProjectRecord>; growthChain(projectId: string): Promise<ProjectGrowthChain>; recordGrowthReview(command: GrowthReviewCommand): Promise<{ revision: { status: string } }> }
declare global { interface Window { hummerProjects?: DesktopProjectsHost } }

export function desktopProjectsPort(): ProjectsPort | undefined {
  const host = typeof window === 'undefined' ? undefined : window.hummerProjects;
  if (!host) return undefined;
  return {
    list: () => host.list(token()),
    create: (input) => host.create({ token: token(), input }),
    growthChain: (projectId) => host.growthChain({ token: token(), input: { projectId } }),
    recordGrowthReview: (input) => host.recordGrowthReview({ token: token(), input }),
  };
}
function token(): string { const value = currentSessionToken(); if (!value) throw new Error('项目协作需要已认证的身份会话。'); return value; }