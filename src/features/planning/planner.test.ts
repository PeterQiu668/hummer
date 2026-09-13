import { describe, expect, it, vi } from 'vitest';
import type { ApprovalPolicyPort, ApprovalPreviewResult } from '../approvals/approvalPolicyClient';
import type { CostLedgerRecord, OutcomeDefinitionRecord, OutcomeEventRecord, RecordCostCommand } from '../outcomes/outcomeClient';
import type { RuntimeAdapter, RuntimeEvent, RuntimeHandle } from '../sessions/runtime/adapter';
import { RuntimePlanner } from './runtimePlanner';
import { TemplatePlanner } from './templatePlanner';
import type { PlanRequest, Planner } from './planner';

const DELETE_TASK: PlanRequest = {
  input: '把客户资料全部删掉',
  assignee: '自动推荐',
  approvalMode: 'L2',
  attachmentNames: [],
  modelProfile: '标准',
  engineProfileId: 'deepseek-standard',
  workContext: '我的工作空间',
};

const runtimePayload = {
  understanding: ['确认客户资料的边界和保留要求', '列出待删除记录并生成可复核清单', '等待指定责任人批准后才允许删除'],
  assignees: ['数据治理助理'],
  tools: ['fs.read'],
  workspaceScope: '客户资料目录，先只读生成删除清单',
  humanGates: ['模型自己声称的关口不应被采信'],
  estimate: '约 6 分钟',
};

describe.each([
  ['TemplatePlanner', () => new TemplatePlanner({ policy: policyPort() })],
  ['RuntimePlanner', () => new RuntimePlanner({ runtime: new ScriptedRuntime(runtimePayload), policy: policyPort(), timeoutMs: 100 })],
] as const)('%s contract', (_name, createPlanner) => {
  it('returns a complete plan and derives critical gates from enterprise policy', async () => {
    const plan = await (createPlanner() as Planner).draft(DELETE_TASK);

    expect(plan.prompt).toBe(DELETE_TASK.input);
    expect(plan.understanding.length).toBeGreaterThan(1);
    expect(plan.assignees.length).toBeGreaterThan(0);
    expect(plan.tools.length).toBeGreaterThan(0);
    expect(plan.workspaceScope).toBeTruthy();
    expect(plan.estimate).toBeTruthy();
    expect(plan.humanGates.join(' ')).toContain('data.delete*');
    expect(plan.humanGates.join(' ')).toContain('critical');
  });
});

describe('RuntimePlanner', () => {
  it('fails closed without blocking the plan when policy lookup is unavailable', async () => {
    const unavailablePolicy = policyPort();
    unavailablePolicy.preview = vi.fn().mockRejectedValue(new Error('policy IPC unavailable'));

    const plan = await new RuntimePlanner({
      runtime: new ScriptedRuntime(runtimePayload),
      policy: unavailablePolicy,
      timeoutMs: 100,
    }).draft(DELETE_TASK);

    expect(plan.planning?.source).toBe('runtime');
    expect(plan.humanGates.join(' ')).toContain('data.delete.records');
    expect(plan.humanGates.join(' ')).toContain('默认禁止执行');
  });

  it('uses validated runtime JSON, ignores model-authored gates, and records planning usage', async () => {
    const recordCost = vi.fn(async (command: RecordCostCommand): Promise<CostLedgerRecord> => costRecord(command));
    const planner = new RuntimePlanner({
      runtime: new ScriptedRuntime(runtimePayload),
      policy: policyPort(),
      outcomes: outcomeLedger(recordCost),
      timeoutMs: 100,
    });

    const plan = await planner.draft(DELETE_TASK);

    expect(plan.understanding).toEqual(runtimePayload.understanding);
    expect(plan.understanding).not.toContain('确认目标与可验收结果');
    expect(plan.humanGates).not.toContain(runtimePayload.humanGates[0]);
    expect(plan.planning).toEqual(expect.objectContaining({ source: 'runtime', costCny: 0.0123 }));
    expect(recordCost).toHaveBeenCalledWith(expect.objectContaining({
      engineProfileId: 'deepseek-standard',
      model: 'deepseek-chat',
      pricingSource: 'planning',
      usage: { inputTokens: 120, cachedInputTokens: 20, outputTokens: 40 },
    }));
  });

  it('removes planning-only meta instructions before the execution plan is returned', async () => {
    const planner = new RuntimePlanner({
      runtime: new ScriptedRuntime({
        ...runtimePayload,
        understanding: [
          ...runtimePayload.understanding,
          '本次仅输出计划，不执行任何工具',
        ],
      }),
      policy: policyPort(),
      timeoutMs: 100,
    });

    const plan = await planner.draft(DELETE_TASK);

    expect(plan.planning?.source).toBe('runtime');
    expect(plan.understanding).toEqual(runtimePayload.understanding);
  });

  it('fails closed to a visibly marked template when runtime output violates the schema', async () => {
    const recordCost = vi.fn(async (command: RecordCostCommand): Promise<CostLedgerRecord> => costRecord(command));
    const planner = new RuntimePlanner({
      runtime: new ScriptedRuntime({ understanding: ['missing required fields'] }),
      policy: policyPort(),
      outcomes: outcomeLedger(recordCost),
      timeoutMs: 100,
    });

    const plan = await planner.draft(DELETE_TASK);

    expect(plan.planning?.source).toBe('template');
    expect(plan.planning?.label).toBe('演示计划 · 未经模型生成');
    expect(plan.planning?.fallbackReason).toMatch(/schema/i);
    expect(recordCost).not.toHaveBeenCalled();
  });

  it('fails closed when the model names an unimplemented capability', async () => {
    const planner = new RuntimePlanner({
      runtime: new ScriptedRuntime({ ...runtimePayload, tools: ['desktop.excel.open'] }),
      policy: policyPort(),
      timeoutMs: 100,
    });

    const plan = await planner.draft(DELETE_TASK);

    expect(plan.planning).toEqual(expect.objectContaining({
      source: 'template',
      fallbackReason: expect.stringMatching(/unimplemented capability desktop\.excel\.open/i),
    }));
    expect(plan.tools).toEqual(['fs.read', 'external.send.draft']);
    expect(plan.tools).not.toContain('desktop.excel.open');
  });

  it('keeps a valid real plan but replaces an unpriced-model exception with a product-safe cost message', async () => {
    const recordCost = vi.fn(async (): Promise<CostLedgerRecord> => { throw new Error('Error invoking IPC: No verified CNY price is configured for model gpt-internal'); });
    const planner = new RuntimePlanner({
      runtime: new ScriptedRuntime(runtimePayload),
      policy: policyPort(),
      outcomes: outcomeLedger(recordCost),
      timeoutMs: 100,
    });

    const plan = await planner.draft(DELETE_TASK);

    expect(plan.planning).toEqual(expect.objectContaining({
      source: 'runtime',
      receiptOutcomeEventId: 'planning_outcome',
      costUnavailableReason: '该运行时模型未配置价格，成本未记录',
    }));
    expect(plan.planning?.costUnavailableReason).not.toContain('gpt-internal');
  });

  it('does not write cost when the real runtime is unavailable', async () => {
    const recordCost = vi.fn(async (command: RecordCostCommand): Promise<CostLedgerRecord> => costRecord(command));
    const runtime = new ScriptedRuntime(runtimePayload);
    runtime.startSession = vi.fn().mockRejectedValue(new Error('DEEPSEEK_API_KEY is unavailable'));
    const planner = new RuntimePlanner({ runtime, policy: policyPort(), outcomes: outcomeLedger(recordCost), timeoutMs: 100 });

    const plan = await planner.draft(DELETE_TASK);

    expect(plan.planning).toEqual(expect.objectContaining({
      source: 'template',
      label: '演示计划 · 未经模型生成',
      fallbackReason: 'DEEPSEEK_API_KEY is unavailable',
    }));
    expect(recordCost).not.toHaveBeenCalled();
  });

  it('redacts a secret-shaped runtime failure before putting it in template provenance', async () => {
    const runtime = new ScriptedRuntime(runtimePayload);
    const fakeSecret = ['sk', 'unit', 'secret', 'never', 'store', 'this'].join('-');
    runtime.startSession = vi.fn().mockRejectedValue(new Error(`DEEPSEEK_API_KEY=${fakeSecret}`));

    const plan = await new RuntimePlanner({ runtime, policy: policyPort(), timeoutMs: 100 }).draft(DELETE_TASK);

    expect(plan.planning?.fallbackReason).toContain('DEEPSEEK_API_KEY=[REDACTED]');
    expect(plan.planning?.fallbackReason).not.toContain(fakeSecret);
  });
});

function policyPort(): ApprovalPolicyPort {
  return {
    preview: vi.fn(async ({ action }): Promise<ApprovalPreviewResult> => {
      if (action.startsWith('data.delete')) return {
        effect: 'require_approval', policyId: 'tenant_policy_data_delete', approverActorRef: 'account_owner',
        approverDisplayName: '王经理', reason: 'matched_rule', actionPattern: 'data.delete*', riskLevel: 'critical', budgetLimitCny: 0,
      };
      if (action.startsWith('file.write')) return {
        effect: 'require_approval', policyId: 'tenant_policy_file_write', approverActorRef: 'account_owner',
        approverDisplayName: '王经理', reason: 'matched_rule', actionPattern: 'file.write*', riskLevel: 'high', budgetLimitCny: 20,
      };
      return {
        effect: 'deny', policyId: null, approverActorRef: null, approverDisplayName: null,
        reason: 'default_deny', actionPattern: null, riskLevel: null, budgetLimitCny: null,
      };
    }),
    authorize: vi.fn(),
    evidence: vi.fn(),
  };
}

function outcomeLedger(recordCost: (command: RecordCostCommand) => Promise<CostLedgerRecord>) {
  return {
    define: vi.fn(async (): Promise<OutcomeDefinitionRecord> => ({
      id: 'planning_definition', tenantId: 'tenant_1', actionPattern: 'planning.session-plan', title: '规划', acceptanceCriteria: '通过 schema',
      unitPriceCny: null, riskLevel: 'low', enabled: true, createdAt: '2026-09-10T01:00:00.000Z', updatedAt: '2026-09-10T01:00:00.000Z',
    })),
    record: vi.fn(async (): Promise<OutcomeEventRecord> => ({
      id: 'planning_outcome', tenantId: 'tenant_1', outcomeDefinitionId: 'planning_definition', workOrderId: null,
      sessionId: 'planning_session_1', approvalId: null, verdict: 'accepted', acceptedBy: 'account:owner',
      evidenceRef: 'codex://turn/completed', occurredAt: '2026-09-10T01:00:01.000Z',
    })),
    recordCost,
  };
}

function costRecord(command: RecordCostCommand): CostLedgerRecord {
  return {
    id: 'planning_cost', tenantId: 'tenant_1', sessionId: command.sessionId, outcomeEventId: command.outcomeEventId ?? null,
    engineProfileId: command.engineProfileId, model: command.model, usage: command.usage, costCny: 0.0123,
    pricingSource: command.pricingSource ?? 'official', pricingVerifiedAt: '2026-09-01', computedAt: command.occurredAt,
  };
}

class ScriptedRuntime implements RuntimeAdapter {
  readonly id = 'codex-cli';
  private events: RuntimeEvent[] = [];

  constructor(private readonly payload: unknown) {}

  async startSession(): Promise<RuntimeHandle> {
    const handle: RuntimeHandle = {
      runtimeId: this.id,
      sessionId: 'planning_session_1',
      engine: { providerName: 'DeepSeek', modelName: 'deepseek-chat', dataDomain: 'api.deepseek.com', sandbox: 'read-only', tier: 'standard' },
    };
    const result = JSON.stringify(this.payload);
    this.events = [
      { sessionId: handle.sessionId, sequence: 1, occurredAt: '2026-09-10T01:00:00.000Z', actorRef: 'employee:codex', type: 'step', category: 'message', status: 'completed', title: '规划', result, evidenceRefs: [] },
      { sessionId: handle.sessionId, sequence: 2, occurredAt: '2026-09-10T01:00:01.000Z', actorRef: 'employee:codex', type: 'result', title: '规划完成', summary: result, deliverables: [], evidenceRefs: [], durationMs: 1000, costCny: null, usage: { totalTokens: 160, inputTokens: 120, cachedInputTokens: 20, outputTokens: 40 }, rollback: { supported: false } },
    ];
    return handle;
  }

  subscribe(_handle: RuntimeHandle, callback: (event: RuntimeEvent) => void): () => void { this.events.forEach(callback); return () => undefined; }
  respondToApproval(): Promise<void> { return Promise.resolve(); }
  sendHumanMessage(): Promise<void> { return Promise.resolve(); }
  pause(): Promise<void> { return Promise.resolve(); }
  resume(): Promise<void> { return Promise.resolve(); }
  stop(): Promise<void> { return Promise.resolve(); }
  forkFromCheckpoint(): Promise<RuntimeHandle> { return Promise.reject(new Error('not used')); }
}
