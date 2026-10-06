import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import StartWorkPage from './StartWorkPage';
import {
  decideStartWorkPlan,
  validatePendingStartWorkPlan,
  type StartWorkPlan,
} from './startWorkPlan';

function pendingPlan(overrides: Partial<StartWorkPlan> = {}): StartWorkPlan {
  return {
    id: 'plan_phase0_1',
    target: '整理两台设备上的客户资料并生成可核验摘要',
    status: 'pending',
    decidedBy: null,
    decidedAt: null,
    steps: [
      { id: 'step_1', title: '读取指定工作区', nodeLabel: '办公室电脑', targetNodeId: 'node_office', targetRuntime: 'codex', riskClass: 'none', estimatedCostCny: 0 },
      { id: 'step_2', title: '生成摘要草稿', nodeLabel: '办公室电脑', targetNodeId: 'node_office', targetRuntime: 'codex', riskClass: 'write', estimatedCostCny: 0.8 },
    ],
    ...overrides,
  };
}

describe('StartWorkPage', () => {
  it('shows the target, 2–5 step plan, node, risk and cost before recording one human confirmation', () => {
    const onDecision = vi.fn();
    render(<StartWorkPage
      plan={pendingPlan()}
      decisionActorRef="human:boss"
      now={() => '2026-10-07T08:00:00.000Z'}
      onDecision={onDecision}
    />);

    expect(screen.getByRole('heading', { name: '先看计划，再决定是否继续' })).toBeInTheDocument();
    expect(screen.getByText('整理两台设备上的客户资料并生成可核验摘要')).toBeInTheDocument();
    expect(screen.getAllByText('办公室电脑')).toHaveLength(2);
    expect(screen.getAllByText('写入或覆盖')).toHaveLength(2);
    expect(screen.getAllByText('预估 ¥0.80')).toHaveLength(2);
    expect(screen.getByText('等待你的确认')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '确认计划' }));

    expect(screen.getByText('计划已确认，尚未派发')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '确认计划' })).not.toBeInTheDocument();
    expect(onDecision).toHaveBeenCalledTimes(1);
    expect(onDecision).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'confirmed', decidedBy: 'human:boss' }),
      'confirm',
    );
    expect(screen.queryByText(/已执行|执行成功/)).not.toBeInTheDocument();
  });

  it('records a rejection without dispatching the plan', () => {
    const onDecision = vi.fn();
    render(<StartWorkPage plan={pendingPlan()} onDecision={onDecision} />);

    fireEvent.click(screen.getByRole('button', { name: '拒绝计划' }));

    expect(screen.getByText('计划已拒绝，未派发')).toBeInTheDocument();
    expect(onDecision).toHaveBeenCalledWith(expect.objectContaining({ status: 'rejected' }), 'reject');
  });

  it('fails closed when no plan is available', () => {
    const onDecision = vi.fn();
    const onPlanRequest = vi.fn();
    render(<StartWorkPage plan={null} onDecision={onDecision} onPlanRequest={onPlanRequest} />);

    expect(screen.getByText(/还没有可确认计划/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认计划' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '生成待确认计划' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '确认计划' }));
    expect(onDecision).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole('textbox', { name: '你想完成什么' }), {
      target: { value: '  形成双机任务摘要  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: '生成待确认计划' }));
    expect(onPlanRequest).toHaveBeenCalledWith('形成双机任务摘要');
    expect(onDecision).not.toHaveBeenCalled();
  });

  it('fails closed for an invalid step count or terminal inbound state', () => {
    const onDecision = vi.fn();
    const { rerender } = render(<StartWorkPage plan={pendingPlan({ steps: [pendingPlan().steps[0]] })} onDecision={onDecision} />);

    expect(screen.getByRole('alert')).toHaveTextContent('计划必须包含 2–5 个步骤');
    expect(screen.getByRole('button', { name: '确认计划' })).toBeDisabled();

    rerender(<StartWorkPage plan={pendingPlan({ status: 'confirmed', decidedBy: 'human:boss', decidedAt: '2026-10-07T08:00:00.000Z' })} onDecision={onDecision} />);
    expect(screen.getByRole('alert')).toHaveTextContent('只允许载入待确认计划');
    expect(onDecision).not.toHaveBeenCalled();
  });

  it('fails closed when a system actor attempts to decide', () => {
    const onDecision = vi.fn();
    render(<StartWorkPage plan={pendingPlan()} decisionActorRef="system:relay" onDecision={onDecision} />);

    expect(screen.getByRole('alert')).toHaveTextContent('只有具名人类操作者');
    expect(screen.getByRole('button', { name: '确认计划' })).toBeDisabled();
    expect(onDecision).not.toHaveBeenCalled();
  });

  it('shows all seven controlled risk classes and fails closed for unknown risk while allowing rejection', () => {
    const onDecision = vi.fn();
    render(<StartWorkPage
      plan={pendingPlan({ steps: [pendingPlan().steps[0], { ...pendingPlan().steps[1], riskClass: 'unknown' }] })}
      onDecision={onDecision}
    />);

    expect(screen.getByLabelText('七类受控风险')).toHaveTextContent('对外发送');
    expect(screen.getByLabelText('七类受控风险')).toHaveTextContent('写入或覆盖');
    expect(screen.getByLabelText('七类受控风险')).toHaveTextContent('产生费用');
    expect(screen.getByLabelText('七类受控风险')).toHaveTextContent('删除');
    expect(screen.getByLabelText('七类受控风险')).toHaveTextContent('权限变更');
    expect(screen.getByLabelText('七类受控风险')).toHaveTextContent('新网络端点');
    expect(screen.getByLabelText('七类受控风险')).toHaveTextContent('未知 · 最高风险');
    expect(screen.getByRole('alert')).toHaveTextContent('风险未知，必须先澄清');
    expect(screen.getByRole('button', { name: '确认计划' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '拒绝计划' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: '拒绝计划' }));
    expect(onDecision).toHaveBeenCalledWith(expect.objectContaining({ status: 'rejected' }), 'reject');
  });
});

describe('start work plan state model', () => {
  it('rejects a duplicate decision and preserves the terminal state', () => {
    const first = decideStartWorkPlan(pendingPlan(), 'confirm', 'human:boss', '2026-10-07T08:00:00.000Z');
    expect(first.accepted).toBe(true);

    const duplicate = decideStartWorkPlan(first.plan, 'confirm', 'human:boss', '2026-10-07T08:01:00.000Z');

    expect(duplicate.accepted).toBe(false);
    expect(duplicate.plan).toBe(first.plan);
    expect(duplicate.reason).toContain('只允许载入待确认计划');
  });

  it('rejects duplicate step ids and invalid cost values', () => {
    const plan = pendingPlan({
      steps: [
        pendingPlan().steps[0],
        { ...pendingPlan().steps[1], id: 'step_1', estimatedCostCny: -1 },
      ],
    });

    expect(validatePendingStartWorkPlan(plan)).toEqual({
      ok: false,
      errors: ['第 2 步标识重复', '第 2 步预估成本无效'],
    });
  });

  it('rejects a malformed runtime step instead of throwing', () => {
    const malformed = pendingPlan({ steps: [null, pendingPlan().steps[1]] as unknown as StartWorkPlan['steps'] });

    expect(validatePendingStartWorkPlan(malformed)).toEqual({
      ok: false,
      errors: ['第 1 步格式无效'],
    });
  });
});
