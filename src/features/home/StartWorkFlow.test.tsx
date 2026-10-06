import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { validateFleetContract } from '@hummer/contracts';
import { describe, expect, it, vi } from 'vitest';
import { draftPlanFromPrompt, type SessionPlan } from '../sessions/model/session';
import StartWorkFlow from './StartWorkFlow';
import type { StartWorkDispatchIntentPort } from './startWorkDispatch';

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
  expect((await screen.findAllByText('办公室电脑')).length).toBeGreaterThanOrEqual(2);
}

describe('StartWorkFlow relay seam', () => {
  it('keeps the generated plan pending and produces no dispatch intent before confirmation', async () => {
    const { record } = setup();
    await requestPlan();

    expect(screen.getByText('等待你的确认')).toBeInTheDocument();
    expect(record).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('待派发意图')).not.toBeInTheDocument();
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
    expect(screen.getByText('计划已确认，尚未派发')).toBeInTheDocument();
    expect(screen.getByLabelText('待派发意图')).toHaveTextContent('start-work:');
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
    expect(screen.queryByLabelText('待派发意图')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '确认计划' }));
    await waitFor(() => expect(record).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText('待派发意图')).toHaveTextContent('start-work:');
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
});
