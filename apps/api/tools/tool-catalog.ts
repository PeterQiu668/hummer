import type { RiskLevel } from '../work-orders/index.ts';

export type ToolClass = 'read' | 'write';
export type ToolRisk = 'low' | 'medium' | 'high' | 'denied';

export interface ToolDefinition {
  readonly name: string;
  readonly class: ToolClass;
  readonly risk: ToolRisk;
  readonly costCny: number;
}

export interface ToolTrace {
  readonly tool: string;
  readonly class: ToolClass;
  readonly traceRef: string;
  readonly status: 'completed' | 'awaiting_approval' | 'executed' | 'blocked';
  readonly riskLevel?: RiskLevel;
}

const TOOLS: readonly ToolDefinition[] = [
  { name: 'synthetic_gtm_search', class: 'read', risk: 'low', costCny: 0.05 },
  { name: 'synthetic_csv_parse', class: 'read', risk: 'low', costCny: 0.05 },
  { name: 'synthetic_crm_csv_write', class: 'write', risk: 'high', costCny: 0 },
];

export function getToolDefinition(name: string): ToolDefinition | undefined {
  return TOOLS.find((tool) => tool.name === name);
}

export function classifyToolAction(action: string): ToolRisk {
  if (action === 'synthetic_crm_write' || action === 'synthetic_csv_write' || action === 'synthetic CRM/CSV write-back') return 'high';
  if (action === 'customer_message' || action === 'external_browser_write' || action === 'credential_use' || action === 'finance_action') return 'denied';
  return 'low';
}

export function requiresApproval(action: string): boolean {
  return classifyToolAction(action) === 'high';
}

export function riskLevelForTool(name: string): RiskLevel {
  const tool = getToolDefinition(name);
  if (!tool || tool.risk === 'denied') return 'high';
  return tool.risk;
}
