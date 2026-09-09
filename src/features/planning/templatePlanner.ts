import { draftPlanFromPrompt } from '../sessions/model/session';
import type { ApprovalPolicyPort } from '../approvals/approvalPolicyClient';
import type { PlanRequest, Planner } from './planner';
import { TEMPLATE_PLAN_LABEL } from './planner';
import { policyDerivedHumanGates } from './policyGates';

export class TemplatePlanner implements Planner {
  constructor(private readonly options: { policy?: ApprovalPolicyPort; fallbackReason?: string } = {}) {}

  async draft(request: PlanRequest) {
    const plan = draftPlanFromPrompt(request.input, {
      assignee: request.assignee,
      approvalMode: request.approvalMode,
      attachmentNames: request.attachmentNames,
      modelProfile: request.modelProfile,
      workContext: request.workContext,
    });
    return {
      ...plan,
      humanGates: await policyDerivedHumanGates(request.input, plan.tools, this.options.policy),
      planning: {
        source: 'template' as const,
        label: TEMPLATE_PLAN_LABEL,
        fallbackReason: this.options.fallbackReason ?? '当前环境没有可用的真实规划运行时',
      },
    };
  }
}
