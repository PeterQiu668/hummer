import type { ApprovalPolicyPort, ApprovalPreviewResult } from '../approvals/approvalPolicyClient';

const inferredActions: Array<{ match: RegExp; action: string }> = [
  { match: /删除|删掉|清空|销毁|永久移除/i, action: 'data.delete.records' },
  { match: /发到|发送|外发|回复客户|通知客户|销售群/i, action: 'external.send.message' },
  { match: /写回\s*CRM|更新\s*CRM|CRM\s*写入/i, action: 'crm.write.records' },
  { match: /付款|支付|转账|打款/i, action: 'payment.execute' },
  { match: /授权|开通权限|修改权限|提权/i, action: 'permission.change' },
  { match: /执行命令|运行脚本|命令行/i, action: 'shell.command.execute' },
  { match: /写入文件|保存文件|导出报告|生成报告/i, action: 'file.write.output' },
];

export function candidateActions(input: string, tools: readonly string[]): string[] {
  const fromModel = tools.map((tool) => tool.trim()).filter((tool) => /^[a-z][a-z0-9_-]*(?:\.[a-z0-9_*-]+)+$/i.test(tool));
  const inferred = inferredActions.filter(({ match }) => match.test(input)).map(({ action }) => action);
  return [...new Set([...fromModel, ...inferred])];
}

export async function policyDerivedHumanGates(
  input: string,
  tools: readonly string[],
  policy?: ApprovalPolicyPort,
): Promise<string[]> {
  const actions = candidateActions(input, tools);
  if (!policy) {
    return unavailablePolicyGates(actions);
  }

  let previews: Array<{ action: string; preview: ApprovalPreviewResult }>;
  try {
    previews = await Promise.all(actions.map(async (action) => ({ action, preview: await policy.preview({
      action,
      requestedBy: 'planner:runtime',
      estimatedCostCny: null,
    }) })));
  } catch {
    return unavailablePolicyGates(actions);
  }
  const matched = previews.filter(({ preview }) => preview.policyId && (preview.riskLevel === 'high' || preview.riskLevel === 'critical'));
  const seen = new Set<string>();
  return matched.flatMap(({ action, preview }) => {
    if (!preview.policyId || seen.has(preview.policyId)) return [];
    seen.add(preview.policyId);
    return [formatGate(action, preview)];
  });
}

function formatGate(action: string, preview: ApprovalPreviewResult): string {
  const pattern = preview.actionPattern ?? action;
  const approver = preview.approverDisplayName ?? preview.approverActorRef ?? '指定责任人';
  const budget = preview.budgetLimitCny === null ? '' : ` · 预算上限 ¥${preview.budgetLimitCny}`;
  return `${preview.riskLevel ?? 'high'} · ${pattern} · 需 ${approver} 批准${budget}`;
}

function isProtectedAction(action: string): boolean {
  return /^(file\.write|shell\.command|external\.send|payment\.|permission\.|data\.delete|crm\.write)/.test(action);
}

function unavailablePolicyGates(actions: readonly string[]): string[] {
  return actions.filter(isProtectedAction).map((action) => `企业审批策略不可用 · ${action} · 默认禁止执行`);
}
