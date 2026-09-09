import { desktopApprovalPolicyPort } from '../approvals/approvalPolicyClient';
import { desktopOutcomePort } from '../outcomes/outcomeClient';
import type { RuntimeAdapter } from '../sessions/runtime/adapter';
import type { Planner } from './planner';
import { RuntimePlanner } from './runtimePlanner';
import { TemplatePlanner } from './templatePlanner';

export function createDefaultPlanner(runtime: RuntimeAdapter): Planner {
  const policy = desktopApprovalPolicyPort();
  if (runtime.id.startsWith('mock')) return new TemplatePlanner({ policy });
  return new RuntimePlanner({ runtime, policy, outcomes: desktopOutcomePort() });
}
