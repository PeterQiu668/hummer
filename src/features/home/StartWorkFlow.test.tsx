import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { validateFleetContract } from '@hummer/contracts';
import { describe, expect, it, vi } from 'vitest';
import { draftPlanFromPrompt, type SessionPlan } from '../sessions/model/session';
import StartWorkFlow from './StartWorkFlow';
import { deterministicTaskGrantRef, type StartWorkDispatchIntentPort } from './startWorkDispatch';

const onlineNode = {
  id: 'node_office',
  tenantId: 'tenant_demo',
  displayName: '办公室电脑',
  runtimeId: 'codex-cli',
  status: 'online' as const,
  cwd: 'C:\\workspace',
  permissionScope: 'workspace-write; approval-required',
  currentSessionId: null,
  lastSeenAt: '2026-10-07T08:00:00.000Z',
};

function setup(sourcePlan?: SessionPlan) {
  const record = vi.fn<StartWorkDispatchIntentPort['record']>();
  render(<StartWorkFlow
    planner={{ draft: vi.fn().mockResolvedValue(sourcePlan ?? draftPlanFromPrompt('整理客户资料并生成摘要')) }}
    nodePort={{ list: vi.fn().mockResolvedValue([onlineNode]) }}
    decisionActorRef="human:boss"
    now={() => '2026-10-07T08:00:00.000Z'}
    dispatchIntentPort={{ record }}
  />);
  return { record };
}

async function requestPlan() {
  fireEvent.change(screen.getByRole('textbox', { name: '你想完成什么' }), { target: { value: '整理客户资料并生成摘要' } });
  fireEvent.click(screen.getByRole('button', { name: '生成待确认计划' }));
  expect(await screen.findByLabelText('第 1 步审批上下文')).toHaveTextContent('执行目标：办公室电脑 · codex');
}

describe('StartWorkFlow relay seam', () => {
  it('is explicitly read-only and cannot confirm when no Relay dispatch port is configured', async () => {
    render(<StartWorkFlow
      planner={{ draft: vi.fn().mockResolvedValue(draftPlanFromPrompt('整理客户资料并生成摘要')) }}
      nodePort={{ list: vi.fn().mockResolvedValue([onlineNode]) }}
      decisionActorRef="human:boss"
    />);
    await requestPlan();

    expect(screen.getByRole('status')).toHaveTextContent('Relay 未配置，当前只读，不能发送任务');
    expect(screen.getByRole('button', { name: '确认计划' })).toBeDisabled();
  });

  it('keeps the generated plan pending and produces no dispatch intent before confirmation', async () => {
    const { record } = setup();
    await requestPlan();

    expect(screen.getByText('等待你的确认')).toBeInTheDocument();
    expect(record).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('派发回执')).not.toBeInTheDocument();
  });

  it('records exactly one Relay-shaped pending dispatch intent after explicit human confirmation', async () => {
    const { record } = setup();
    await requestPlan();
    fireEvent.click(screen.getByRole('button', { name: '确认计划' }));

    await waitFor(() => expect(record).toHaveBeenCalledTimes(1));
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      schema: 'hummer.start-work-dispatch-intent',
      status: 'pending',
      confirmedBy: 'human:boss',
      envelope: expect.objectContaining({
        schema: 'hummer.task-envelope',
        targetNodeId: 'node_office',
        targetRuntime: 'codex',
        approvalPolicyRef: 'phase0-default-deny',
        workOrderTask: expect.objectContaining({ schema: 'hummer.work-order-task', target: '整理客户资料并生成摘要' }),
      }),
    }));
    const intent = record.mock.calls[0][0];
    expect(validateFleetContract('TaskEnvelope', intent.envelope).issues).toBeUndefined();
    expect(screen.getByText('计划已确认，等待派发回执')).toBeInTheDocument();
    expect(screen.getByLabelText('派发回执')).toHaveTextContent('start-work:');
  });

  it('records no dispatch intent after rejection', async () => {
    const { record } = setup();
    await requestPlan();
    fireEvent.click(screen.getByRole('button', { name: '拒绝计划' }));

    expect(screen.getByText('计划已拒绝，未派发')).toBeInTheDocument();
    expect(record).not.toHaveBeenCalled();
  });

  it('returns to pending and allows retry when the dispatch intent port rejects', async () => {
    const { record } = setup();
    record.mockRejectedValueOnce(new Error('Relay 暂不可用'));
    await requestPlan();
    fireEvent.click(screen.getByRole('button', { name: '确认计划' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Relay 暂不可用');
    expect(screen.getByText('等待你的确认')).toBeInTheDocument();
    expect(screen.queryByLabelText('派发回执')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '确认计划' }));
    await waitFor(() => expect(record).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText('派发回执')).toHaveTextContent('start-work:');
  });

  it('fails closed for an unknown risk and records no dispatch intent', async () => {
    const source = draftPlanFromPrompt('执行未知动作');
    source.understanding = ['读取已授权资料', '执行 unknown capability'];
    source.tools = ['unknown.execute'];
    const { record } = setup(source);
    await requestPlan();

    expect(screen.getByRole('alert')).toHaveTextContent('风险未知，必须先澄清');
    expect(screen.getByRole('button', { name: '确认计划' })).toBeDisabled();
    expect(record).not.toHaveBeenCalled();
  });

  it('freezes an explicit read-attestation plan and deterministic grant reference into the confirmed envelope', async () => {
    const record = vi.fn<StartWorkDispatchIntentPort['record']>();
    render(<StartWorkFlow
      planner={{ draft: vi.fn().mockResolvedValue(draftPlanFromPrompt('证明周报文件摘要')) }}
      nodePort={{ list: vi.fn().mockResolvedValue([{ ...onlineNode, permissionScope: 'fs.read' }]) }}
      decisionActorRef="human:boss"
      now={() => '2026-10-07T08:00:00.000Z'}
      dispatchIntentPort={{ record }}
    />);

    fireEvent.change(screen.getByRole('textbox', { name: '你想完成什么' }), { target: { value: '证明周报文件摘要' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /只读文件证明/ }));
    fireEvent.change(screen.getByRole('textbox', { name: '工作区相对路径' }), { target: { value: 'reports/weekly.txt' } });
    fireEvent.change(screen.getByRole('textbox', { name: '最大读取字节' }), { target: { value: '4096' } });
    fireEvent.click(screen.getByRole('button', { name: '生成待确认计划' }));

    const scope = await screen.findByLabelText('只读证明批准范围');
    expect(scope).toHaveTextContent('reports/weekly.txt');
    expect(record).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认计划' }));

    await waitFor(() => expect(record).toHaveBeenCalledTimes(1));
    const intent = record.mock.calls[0][0];
    expect(intent.envelope).toMatchObject({
      targetNodeId: 'node_office',
      grantRef: deterministicTaskGrantRef(intent.planId),
      executionPlan: { kind: 'fs.read.attest.v1', path: 'reports/weekly.txt', maxBytes: 4096 },
    });
    expect(validateFleetContract('TaskEnvelope', intent.envelope).issues).toBeUndefined();
  });

  it('does not allow a read attestation to target a node that does not advertise fs.read', async () => {
    const record = vi.fn<StartWorkDispatchIntentPort['record']>();
    render(<StartWorkFlow
      planner={{ draft: vi.fn().mockResolvedValue(draftPlanFromPrompt('证明周报文件摘要')) }}
      nodePort={{ list: vi.fn().mockResolvedValue([onlineNode]) }}
      decisionActorRef="human:boss"
      dispatchIntentPort={{ record }}
    />);

    fireEvent.change(screen.getByRole('textbox', { name: '你想完成什么' }), { target: { value: '证明周报文件摘要' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /只读文件证明/ }));
    fireEvent.change(screen.getByRole('textbox', { name: '工作区相对路径' }), { target: { value: 'reports/weekly.txt' } });
    fireEvent.click(screen.getByRole('button', { name: '生成待确认计划' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('没有可用执行节点');
    expect(screen.getByRole('button', { name: '确认计划' })).toBeDisabled();
    expect(record).not.toHaveBeenCalled();
  });
});
