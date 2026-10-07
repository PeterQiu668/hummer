import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { RiskClass } from '@hummer/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionPlan } from '../sessions/model/session';
import StartWorkFlow from './StartWorkFlow';
import StartWorkPage from './StartWorkPage';
import {
  configureRemoteRelayDeployment,
  remoteStartWorkDispatchPort,
} from './remoteRelayDispatch';
import {
  START_WORK_CONTROLLED_RISK_CLASSES,
  START_WORK_RISK_PRESENTATION,
  type StartWorkPlan,
} from './startWorkPlan';

const node = {
  id: 'node-risk-gate',
  tenantId: 'tenant-risk-gate',
  displayName: '受控 Windows 节点',
  runtimeId: 'codex-cli',
  status: 'online' as const,
  cwd: 'C:\\synthetic-risk-gate',
  permissionScope: 'workspace-write; approval-required',
  currentSessionId: null,
  lastSeenAt: '2026-10-07T08:00:00.000Z',
};

const cases: ReadonlyArray<{ risk: RiskClass; phrase: string }> = [
  { risk: 'egress', phrase: '发送 external.send 草稿' },
  { risk: 'write', phrase: '写入 update 合成文件' },
  { risk: 'spend', phrase: '付款 purchase 合成订单' },
  { risk: 'delete', phrase: '删除 remove 合成文件' },
  { risk: 'privilege', phrase: '变更权限 grant 合成角色' },
  { risk: 'network', phrase: '连接网络 endpoint 合成服务' },
  { risk: 'unknown', phrase: '执行 unknown capability' },
];

let disposeRelay: (() => void) | undefined;

afterEach(() => {
  cleanup();
  disposeRelay?.();
  disposeRelay = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('strict seven-risk UI and Relay approval matrix', () => {
  it('stays exactly aligned with the canonical seven-class contract taxonomy', () => {
    expect(START_WORK_CONTROLLED_RISK_CLASSES).toEqual(cases.map(({ risk }) => risk));
    expect(Object.keys(START_WORK_RISK_PRESENTATION)).toEqual(cases.map(({ risk }) => risk));
  });

  it.each(cases)('[risk=$risk] shows target, risk and cost with zero enqueue before approval', async ({ risk, phrase }) => {
    const relayRequests: string[] = [];
    const runtimeExecutionRequests: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      relayRequests.push(url);
      if (url.endsWith('/v1/tasks/enqueue')) {
        return new Response(JSON.stringify({ task: { taskId: `task-${risk}` }, inserted: true }), { status: 200 });
      }
      if (/\/claim|\/events|\/complete|\/fail/.test(url)) runtimeExecutionRequests.push(url);
      return new Response(JSON.stringify({ error: { code: 'not_found', message: 'not found' } }), { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    disposeRelay = configureRemoteRelayDeployment({
      baseUrl: 'https://relay.risk-gate.test',
      getBadge: () => 'risk-gate-in-memory-badge',
    });

    render(<StartWorkFlow
      planner={{ draft: vi.fn().mockResolvedValue(sourcePlan(risk, phrase)) }}
      nodePort={{ list: vi.fn().mockResolvedValue([node]) }}
      decisionActorRef="human:risk-gate-reviewer"
      tenantId="tenant-risk-gate"
      now={() => '2026-10-07T08:00:00.000Z'}
      dispatchIntentPort={remoteStartWorkDispatchPort()}
    />);

    fireEvent.change(screen.getByRole('textbox', { name: '你想完成什么' }), {
      target: { value: `验证 ${risk} 风险` },
    });
    fireEvent.click(screen.getByRole('button', { name: '生成待确认计划' }));

    const context = await screen.findByLabelText('第 2 步审批上下文');
    expect(context).toHaveTextContent('执行目标：受控 Windows 节点 · codex');
    expect(context).toHaveTextContent(`风险：${START_WORK_RISK_PRESENTATION[risk].label}`);
    expect(context).toHaveTextContent('成本：预估 ¥1.00');
    expect(context).toHaveTextContent(START_WORK_RISK_PRESENTATION[risk].approvalLabel);
    expect(screen.getByLabelText(`风险策略 ${risk}`)).toHaveTextContent('执行目标 · 风险 · 成本');
    expect(relayRequests.filter((url) => url.endsWith('/v1/tasks/enqueue'))).toHaveLength(0);
    expect(runtimeExecutionRequests).toHaveLength(0);
    expect(screen.queryByLabelText('派发回执')).not.toBeInTheDocument();

    const confirm = screen.getByRole('button', { name: '确认计划' });
    if (risk === 'unknown') {
      expect(confirm).toBeDisabled();
      expect(screen.getByRole('alert')).toHaveTextContent('风险未知，必须先澄清');
      expect(relayRequests.filter((url) => url.endsWith('/v1/tasks/enqueue'))).toHaveLength(0);
      return;
    }

    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => {
      expect(relayRequests.filter((url) => url.endsWith('/v1/tasks/enqueue'))).toHaveLength(1);
    });
    expect(runtimeExecutionRequests).toHaveLength(0);
    expect(screen.getByLabelText('派发回执')).toHaveTextContent('任务已提交到 Relay');
  });

  it('[risk=new-or-unrecognized] fails closed before any decision or Relay call', () => {
    const onDecision = vi.fn();
    const invalidPlan = pendingPlan('write', '写入合成文件');
    invalidPlan.steps[1] = {
      ...invalidPlan.steps[1],
      riskClass: 'financial-transfer' as StartWorkPlan['steps'][number]['riskClass'],
    };

    render(<StartWorkPage plan={invalidPlan} onDecision={onDecision} />);

    expect(screen.getByRole('alert')).toHaveTextContent('风险类型无效');
    expect(screen.getByRole('button', { name: '确认计划' })).toBeDisabled();
    expect(onDecision).not.toHaveBeenCalled();
  });
});

function sourcePlan(risk: RiskClass, phrase: string): SessionPlan {
  return {
    id: `plan-risk-${risk}`,
    prompt: `验证 ${risk} 风险`,
    understanding: ['读取合成输入', phrase],
    assignees: ['合成门禁代理'],
    tools: [],
    workspaceScope: '合成门禁工作区',
    humanGates: ['受控动作前'],
    estimate: '约 1 分钟 · ¥2 以内',
    approvalMode: 'L2',
    attachmentNames: [],
    modelProfile: '合成测试',
    workContext: '合成门禁工作区',
  };
}

function pendingPlan(risk: RiskClass, phrase: string): StartWorkPlan {
  return {
    id: `plan-risk-${risk}`,
    target: `验证 ${risk} 风险`,
    status: 'pending',
    decidedBy: null,
    decidedAt: null,
    steps: [
      {
        id: 'step-1', title: '读取合成输入', nodeLabel: node.displayName,
        targetNodeId: node.id, targetRuntime: 'codex', riskClass: 'none', estimatedCostCny: 1,
      },
      {
        id: 'step-2', title: phrase, nodeLabel: node.displayName,
        targetNodeId: node.id, targetRuntime: 'codex', riskClass: risk, estimatedCostCny: 1,
      },
    ],
  };
}
