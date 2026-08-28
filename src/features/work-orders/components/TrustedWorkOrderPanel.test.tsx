import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { TrustedWorkOrderPanel } from './TrustedWorkOrderPanel';

describe('TrustedWorkOrderPanel', () => {
  it('makes the protected synthetic write wait for a human approval', async () => {
    const user = userEvent.setup();
    render(<TrustedWorkOrderPanel />);

    await user.click(screen.getByRole('button', { name: '生成 WorkOrder' }));
    await user.click(screen.getByRole('button', { name: '提交军令状' }));
    await user.click(screen.getByRole('button', { name: '确认分派' }));
    await user.click(screen.getByRole('button', { name: '生成执行计划' }));
    await user.click(screen.getByRole('button', { name: '开始受控执行' }));
    await user.click(screen.getByRole('button', { name: '申请合成 CRM 回写' }));

    expect(screen.getByText('待人工审批')).toBeVisible();
    expect(screen.getByText('模拟写入已阻断，等待人工决定。')).toBeVisible();
    expect(screen.getByRole('button', { name: '批准合成回写' })).toBeVisible();
  });

  it('allows a ResultPackage only after the protected write is approved', async () => {
    const user = userEvent.setup();
    render(<TrustedWorkOrderPanel />);

    await user.click(screen.getByRole('button', { name: '生成 WorkOrder' }));
    await user.click(screen.getByRole('button', { name: '提交军令状' }));
    await user.click(screen.getByRole('button', { name: '确认分派' }));
    await user.click(screen.getByRole('button', { name: '生成执行计划' }));
    await user.click(screen.getByRole('button', { name: '开始受控执行' }));

    expect(screen.queryByRole('button', { name: '生成成果包' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '申请合成 CRM 回写' }));
    await user.click(screen.getByRole('button', { name: '批准合成回写' }));
    await user.click(screen.getByRole('button', { name: '生成成果包' }));
    await user.click(screen.getByRole('button', { name: '验收通过' }));

    expect(screen.getByText('ResultPackage')).toBeVisible();
    expect(screen.getByLabelText('任务状态：已验收')).toBeVisible();
  });
});
