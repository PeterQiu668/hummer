import type { ApprovalPolicyPort } from '../approvals/approvalPolicyClient';
import type { OutcomePort, RecordCostCommand } from '../outcomes/outcomeClient';
import type { SessionPlan } from '../sessions/model/session';
import type { RuntimeAdapter, RuntimeEvent, RuntimeHandle, RuntimeResultEvent } from '../sessions/runtime/adapter';
import { planIdForInput, RUNTIME_PLAN_LABEL, type PlanRequest, type Planner } from './planner';
import { policyDerivedHumanGates } from './policyGates';
import { TemplatePlanner } from './templatePlanner';

interface RuntimePlanPayload {
  understanding: string[];
  assignees: string[];
  tools: string[];
  workspaceScope: string;
  humanGates: string[];
  estimate: string;
}

const RUNTIME_PLAN_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['understanding', 'assignees', 'tools', 'workspaceScope', 'humanGates', 'estimate'],
  properties: {
    understanding: { type: 'array', minItems: 2, maxItems: 6, items: { type: 'string', minLength: 1, maxLength: 500 } },
    assignees: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'string', minLength: 1, maxLength: 500 } },
    tools: { type: 'array', minItems: 1, maxItems: 16, items: { type: 'string', minLength: 1, maxLength: 500 } },
    workspaceScope: { type: 'string', minLength: 1, maxLength: 1000 },
    humanGates: { type: 'array', maxItems: 16, items: { type: 'string', minLength: 1, maxLength: 500 } },
    estimate: { type: 'string', minLength: 1, maxLength: 1000 },
  },
};

type PlanningLedger = Pick<OutcomePort, 'define' | 'record' | 'recordCost'>;

export class RuntimePlanner implements Planner {
  constructor(private readonly options: {
    runtime: RuntimeAdapter;
    policy?: ApprovalPolicyPort;
    outcomes?: PlanningLedger;
    timeoutMs?: number;
  }) {}

  async draft(request: PlanRequest): Promise<SessionPlan> {
    const fallback = (reason: unknown) => new TemplatePlanner({
      policy: this.options.policy,
      fallbackReason: safeError(reason),
    }).draft(request);
    let handle: RuntimeHandle | undefined;
    try {
      const planningPlan = makePlanningTurn(request);
      handle = await this.options.runtime.startSession(planningPlan);
      if (handle.runtimeId.startsWith('mock')) throw new Error('真实规划运行时不可用，已回落演示运行时');
      const result = await waitForPlanningResult(this.options.runtime, handle, this.options.timeoutMs ?? 120_000);
      const payload = parseRuntimePlan(result.summary);
      const tools = [...payload.tools];
      const planId = planIdForInput(request.input);
      const humanGates = await policyDerivedHumanGates(request.input, tools, this.options.policy);
      const assignees = request.assignee && request.assignee !== '自动推荐' ? [request.assignee] : payload.assignees;
      const planning = {
        source: 'runtime' as const,
        label: RUNTIME_PLAN_LABEL,
        runtimeId: handle.runtimeId,
        planningSessionId: handle.sessionId,
        ...(await this.recordPlanningOutcome(request, handle, result, planId)),
      };
      return {
        id: planId,
        prompt: request.input.trim(),
        understanding: payload.understanding,
        assignees,
        tools,
        workspaceScope: `${request.workContext ?? '我的工作空间'} · ${payload.workspaceScope}`,
        humanGates,
        estimate: payload.estimate,
        approvalMode: request.approvalMode ?? 'L2',
        attachmentNames: [...(request.attachmentNames ?? [])],
        modelProfile: request.modelProfile ?? '标准',
        workContext: request.workContext ?? '我的工作空间',
        planning,
      };
    } catch (error) {
      return fallback(error);
    } finally {
      if (handle) void this.options.runtime.stop(handle).catch(() => undefined);
    }
  }

  private async recordPlanningOutcome(
    request: PlanRequest,
    handle: RuntimeHandle,
    result: RuntimeResultEvent,
    planId: string,
  ): Promise<{ receiptOutcomeEventId?: string; costCny?: number; costUnavailableReason?: string }> {
    if (!result.usage) return { costUnavailableReason: '该运行时未提供规划用量' };
    if (!this.options.outcomes) return { costUnavailableReason: '未连接结果与成本账本' };
    if (!handle.engine?.modelName) return { costUnavailableReason: '运行时未披露真实模型名' };
    let outcomeEventId: string;
    try {
      const definition = await this.options.outcomes.define({
        actionPattern: 'planning.session-plan',
        title: '生成可执行任务计划',
        acceptanceCriteria: '结构化计划通过 schema 校验，且审批关口由企业策略推导',
        riskLevel: 'low',
        idempotencyKey: `planning-definition:${planId}`,
      });
      const outcome = await this.options.outcomes.record({
        outcomeDefinitionId: definition.id,
        sessionId: handle.sessionId,
        verdict: 'accepted',
        evidenceRef: result.evidenceRefs[0],
        occurredAt: result.occurredAt,
        idempotencyKey: `planning-outcome:${handle.sessionId}`,
      });
      outcomeEventId = outcome.id;
    } catch (error) {
      return { costUnavailableReason: safeError(error) };
    }
    try {
      const usage: RecordCostCommand['usage'] = {
        inputTokens: result.usage.inputTokens,
        cachedInputTokens: result.usage.cachedInputTokens,
        outputTokens: result.usage.outputTokens,
      };
      const cost = await this.options.outcomes.recordCost({
        sessionId: handle.sessionId,
        outcomeEventId,
        engineProfileId: request.engineProfileId ?? 'deepseek-standard',
        model: handle.engine.modelName,
        usage,
        pricingSource: 'planning',
        occurredAt: result.occurredAt,
        idempotencyKey: `planning-cost:${handle.sessionId}`,
      });
      return { receiptOutcomeEventId: outcomeEventId, costCny: cost.costCny };
    } catch (error) {
      return { receiptOutcomeEventId: outcomeEventId, costUnavailableReason: safeCostError(error) };
    }
  }
}

function makePlanningTurn(request: PlanRequest): SessionPlan {
  const input = request.input.trim();
  const schema = '{"understanding":["..."],"assignees":["..."],"tools":["canonical.action"],"workspaceScope":"...","humanGates":[],"estimate":"..."}';
  return {
    id: `planning_${planIdForInput(input)}`,
    prompt: [
      'You are HUMMER planning only. Do not call tools, read files, run commands, or change external state.',
      'Return exactly one JSON object with no Markdown or commentary.',
      `Required schema: ${schema}`,
      'Use 2-6 concrete, task-specific understanding steps. Use canonical dot-separated action ids in tools.',
      'humanGates is required for schema compatibility but HUMMER will ignore it and derive gates from enterprise policy.',
      `User task: ${input}`,
      `Requested assignee: ${request.assignee ?? '自动推荐'}`,
      `Workspace context: ${request.workContext ?? '我的工作空间'}`,
      `Attachments by name only: ${(request.attachmentNames ?? []).join(', ') || 'none'}`,
    ].join('\n'),
    understanding: ['仅理解用户任务与可验收结果', '输出结构化计划，不执行任何工具'],
    assignees: ['planner:runtime'],
    tools: [],
    workspaceScope: `${request.workContext ?? '我的工作空间'}（规划阶段只读）`,
    humanGates: ['规划阶段禁止执行外部动作'],
    estimate: '仅生成计划',
    approvalMode: 'L1',
    attachmentNames: [...(request.attachmentNames ?? [])],
    modelProfile: request.modelProfile ?? '标准',
    workContext: request.workContext ?? '我的工作空间',
    responseSchema: RUNTIME_PLAN_SCHEMA,
  };
}

function waitForPlanningResult(runtime: RuntimeAdapter, handle: RuntimeHandle, timeoutMs: number): Promise<RuntimeResultEvent> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let unsubscribe: () => void = () => undefined;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      callback();
    };
    const timer = setTimeout(() => finish(() => reject(new Error(`Planning runtime timed out after ${timeoutMs}ms`))), timeoutMs);
    unsubscribe = runtime.subscribe(handle, (event: RuntimeEvent) => {
      if (event.type === 'result') finish(() => resolve(event));
      else if (event.type === 'approval_required' || event.type === 'tool') finish(() => reject(new Error('Planning runtime attempted an execution action')));
      else if (event.type === 'status' && ['blocked', 'cancelled', 'interrupted'].includes(event.status)) finish(() => reject(new Error(event.reason ?? `Planning runtime ended with ${event.status}`)));
    });
    if (settled) unsubscribe();
  });
}

export function parseRuntimePlan(text: string): RuntimePlanPayload {
  const candidate = extractJson(text);
  let parsed: unknown;
  try { parsed = JSON.parse(candidate); } catch { throw new Error('Planning schema validation failed: response is not valid JSON'); }
  if (!isRecord(parsed)) throw new Error('Planning schema validation failed: root must be an object');
  const understanding = stringArray(parsed.understanding, 'understanding', 2, 6);
  const assignees = stringArray(parsed.assignees, 'assignees', 1, 8);
  const tools = stringArray(parsed.tools, 'tools', 1, 16);
  const humanGates = stringArray(parsed.humanGates, 'humanGates', 0, 16);
  const workspaceScope = stringField(parsed.workspaceScope, 'workspaceScope');
  const estimate = stringField(parsed.estimate, 'estimate');
  return { understanding, assignees, tools, workspaceScope, humanGates, estimate };
}

function extractJson(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  if (fenced) return fenced;
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  return start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
}

function stringArray(value: unknown, field: string, min: number, max: number): string[] {
  if (!Array.isArray(value) || value.length < min || value.length > max || value.some((item) => typeof item !== 'string' || !item.trim() || item.length > 500)) {
    throw new Error(`Planning schema validation failed: ${field} must contain ${min}-${max} non-empty strings`);
  }
  return value.map((item) => (item as string).trim());
}

function stringField(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 1000) throw new Error(`Planning schema validation failed: ${field} must be a non-empty string`);
  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
    .replace(/\b(?:DEEPSEEK|OPENAI|ANTHROPIC)_API_KEY\s*[=:]\s*\S+/gi, (match) => `${match.split(/[=:]/)[0]}=[REDACTED]`)
    .slice(0, 300);
}

function safeCostError(error: unknown): string {
  const message = safeError(error);
  if (/No verified CNY price is configured/i.test(message)) return '该运行时模型未配置价格，成本未记录';
  return `规划成本未记录：${message}`;
}
