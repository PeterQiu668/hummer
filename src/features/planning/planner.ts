import type { ApprovalMode, SessionPlan } from '../sessions/model/session';

export interface PlanRequest {
  input: string;
  assignee?: string;
  approvalMode?: ApprovalMode;
  attachmentNames?: string[];
  modelProfile?: string;
  engineProfileId?: string;
  workContext?: string;
}

export interface Planner {
  draft(input: PlanRequest): Promise<SessionPlan>;
}

export const TEMPLATE_PLAN_LABEL = '演示计划 · 未经模型生成' as const;
export const RUNTIME_PLAN_LABEL = '模型生成计划' as const;

export function planIdForInput(input: string): string {
  let hash = 2166136261;
  for (const character of input.trim()) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `plan_${(hash >>> 0).toString(36)}`;
}
