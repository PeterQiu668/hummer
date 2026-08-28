import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MockRuntimeAdapter } from '../../features/sessions/runtime/mockRuntimeAdapter';
import { MemorySessionStore } from '../../features/sessions/persistence/sessionStore';
import WorkbenchPage from './WorkbenchPage';

function renderWorkbench(store = new MemorySessionStore()) {
  return render(<WorkbenchPage runtime={new MockRuntimeAdapter({ stepDelayMs: 1 })} sessionStore={store} />);
}

describe('WorkbenchPage V5', () => {
  it('opens with company context, delegated work and twin guidance without execution-only details', () => {
    renderWorkbench();

    expect(screen.getByLabelText('执行节点状态')).toHaveTextContent('节点在线');
    expect(screen.getByLabelText('执行节点状态')).toHaveTextContent('演示运行时');
    expect(screen.getByLabelText('执行节点状态')).toHaveTextContent('演示工作区');
    expect(screen.getByRole('button', { name: '停止执行节点' })).toBeDisabled();
    expect(screen.getByPlaceholderText('比如：把这周的线索整理成跟进清单，写回 CRM 前先给我看')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /填入示例/ })).toHaveLength(4);
    expect(screen.getByText('公司本季重点')).toBeInTheDocument();
    expect(screen.getByText('交给我的工作')).toBeInTheDocument();
    expect(screen.getByText('分身建议')).toBeInTheDocument();
    expect(screen.getByLabelText('选择模型')).toHaveValue('智能选择');
    expect(screen.getByLabelText('选择工作空间')).toHaveValue('我的工作空间');
    expect(screen.getByLabelText('任务权限')).toHaveValue('L2');
    expect(screen.queryByText('预算')).not.toBeInTheDocument();
    expect(screen.queryByText('沙箱')).not.toBeInTheDocument();
    expect(screen.queryByText('桌面操作预览')).not.toBeInTheDocument();
    expect(screen.queryByText('ResultPackage')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('任务 SOP')).not.toBeInTheDocument();
  });

  it('can hand delegated work to the digital twin with one click', () => {
    renderWorkbench();

    fireEvent.click(screen.getByRole('button', { name: '交给分身：整理华东重点客户跟进清单' }));

    expect(screen.getByRole('textbox', { name: '任务描述' })).toHaveValue(
      '整理华东重点客户跟进清单，补齐负责人、下一步动作和本周截止时间，更新前先给我确认',
    );
    expect(screen.getByLabelText('派给谁')).toHaveValue('我的分身 · 昆仑助理');
  });

  it('fills an example, confirms a plan, and streams the full adapter flow', async () => {
    renderWorkbench();
    fireEvent.click(screen.getByRole('button', { name: /填入示例：整理本周线索/ }));
    const composer = screen.getByRole('textbox', { name: '任务描述' });
    expect((composer as HTMLTextAreaElement).value).toContain('线索');
    fireEvent.keyDown(composer, { key: 'Enter', code: 'Enter' });

    expect(await screen.findByText('我理解你要做的是：')).toBeInTheDocument();
    expect(screen.getAllByText(/线索/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: '开始干' }));

    expect(await screen.findByText(/目标下达：/)).toBeInTheDocument();
    expect((await screen.findAllByText('客户管理系统更新等待确认')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: '确认更新' }));
    expect((await screen.findAllByText(/已交付：任务结果/)).length).toBeGreaterThan(0);
  });

  it('keeps a bottom composer and records an operator interruption in the trajectory', async () => {
    renderWorkbench();
    const composer = screen.getByRole('textbox', { name: '任务描述' });
    fireEvent.change(composer, { target: { value: '整理本周线索' } });
    fireEvent.keyDown(composer, { key: 'Enter', code: 'Enter' });
    fireEvent.click(await screen.findByRole('button', { name: '开始干' }));
    await screen.findByText(/目标下达：/);

    const followUp = screen.getByRole('textbox', { name: '在当前会话补充要求' });
    fireEvent.change(followUp, { target: { value: '等一下，先只做华东的' } });
    fireEvent.keyDown(followUp, { key: 'Enter', code: 'Enter' });

    expect(await screen.findByText('等一下，先只做华东的')).toBeInTheDocument();
  });

  it('returns control from a human desktop takeover to the same trajectory', async () => {
    renderWorkbench();
    const composer = screen.getByRole('textbox', { name: '任务描述' });
    fireEvent.change(composer, { target: { value: '整理本周线索并核验客户' } });
    fireEvent.keyDown(composer, { key: 'Enter', code: 'Enter' });
    fireEvent.click(await screen.findByRole('button', { name: '开始干' }));
    await screen.findByText('桌面操作预览');

    fireEvent.click(screen.getByRole('button', { name: '我来接管' }));
    expect(await screen.findByText('真人操作中')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: '接管结果说明' }), {
      target: { value: '我把 3 家排除了，因为已经在谈' },
    });
    fireEvent.click(screen.getByRole('button', { name: '我做完了，你继续' }));

    await waitFor(() => expect(screen.getByText('我把 3 家排除了，因为已经在谈')).toBeInTheDocument());
  });

  it('restores a completed session by replaying persisted RuntimeEvents after remount', async () => {
    const store = new MemorySessionStore();
    const first = renderWorkbench(store);
    const composer = screen.getByRole('textbox', { name: '任务描述' });
    fireEvent.change(composer, { target: { value: '整理本周线索' } });
    fireEvent.keyDown(composer, { key: 'Enter', code: 'Enter' });
    fireEvent.click(await screen.findByRole('button', { name: '开始干' }));
    await screen.findByRole('button', { name: '确认更新' });
    fireEvent.click(screen.getByRole('button', { name: '确认更新' }));
    expect((await screen.findAllByText(/已交付：任务结果/)).length).toBeGreaterThan(0);
    first.unmount();

    renderWorkbench(store);

    expect((await screen.findAllByText(/整理本周线索/)).length).toBeGreaterThan(0);
    expect((await screen.findAllByText(/已交付：任务结果/)).length).toBeGreaterThan(0);
  });
});
