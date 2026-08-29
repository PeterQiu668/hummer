import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockRuntimeAdapter } from '../../features/sessions/runtime/mockRuntimeAdapter';
import { MemorySessionStore } from '../../features/sessions/persistence/sessionStore';
import { draftPlanFromPrompt } from '../../features/sessions/model/session';
import WorkbenchPage from './WorkbenchPage';

function renderWorkbench(store = new MemorySessionStore()) {
  return render(<WorkbenchPage runtime={new MockRuntimeAdapter({ stepDelayMs: 1 })} sessionStore={store} />);
}
afterEach(() => {
  delete window.hummerOrganization;
});
  delete window.hummerApprovalPolicy;


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
    expect(screen.getByLabelText('选择模型')).toHaveValue('标准');
    expect(screen.getByText('数据流向：')).toBeInTheDocument();
    expect(screen.getByText('api.deepseek.com')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '增强 · 暂不可用' })).toBeDisabled();
    expect(screen.getByText(/增强暂不可用/)).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /openai-codex-validation/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText('选择工作空间')).toHaveValue('我的工作空间');
    expect(screen.getByLabelText('任务权限')).toHaveValue('L2');
    expect(screen.queryByText('预算')).not.toBeInTheDocument();
    expect(screen.queryByText('沙箱')).not.toBeInTheDocument();
    expect(screen.queryByText('桌面操作预览')).not.toBeInTheDocument();
    expect(screen.queryByText('ResultPackage')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('任务 SOP')).not.toBeInTheDocument();
  });
  it('offers a persisted digital employee as the same durable assignee id', async () => {
    window.hummerOrganization = {
      listDigitalEmployees: vi.fn().mockResolvedValue([{
        id: 'employee_m-1',
        tenantId: 'tenant_demo',
        sponsorActorRef: 'human:owner',
        departmentId: 'department_sales',
        name: '高客单 BD 顾问',
        jobTitle: '销售增长',
        runtimeProfile: 'standard',
        autonomyLevel: 'L2',
        status: 'probation',
        createdAt: '2026-08-28T14:30:00.000Z',
        updatedAt: '2026-08-28T14:30:00.000Z',
      }]),
      hireDigitalEmployee: vi.fn(),
    };

    renderWorkbench();
    const option = await screen.findByRole('option', { name: '高客单 BD 顾问 · employee_m-1' });
    expect(option).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('派给谁'), { target: { value: '高客单 BD 顾问 · employee_m-1' } });
    fireEvent.change(screen.getByRole('textbox', { name: '任务描述' }), { target: { value: '整理客户资料' } });
    fireEvent.keyDown(screen.getByRole('textbox', { name: '任务描述' }), { key: 'Enter', code: 'Enter' });
    expect((await screen.findAllByText('高客单 BD 顾问 · employee_m-1')).length).toBeGreaterThan(1);
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
    const firstStep = screen.getByText('读取本次授权的工作资料').closest('button');
    expect(firstStep).not.toBeNull();
    fireEvent.click(firstStep!);
    expect(await screen.findByText(/^\d+\.\d+s \/ 演示数据$/)).toBeInTheDocument();
  });

  it('checks the enterprise approval policy before replying to the runtime', async () => {
    const authorize = vi.fn().mockResolvedValue({ approved: true, effect: 'require_approval', policyId: 'tenant_demo_policy_shell_command', approverActorRef: 'human:owner', reason: 'matched_rule' });
    window.hummerApprovalPolicy = { authorize };
    const runtime = new MockRuntimeAdapter({ stepDelayMs: 1 });
    const respond = vi.spyOn(runtime, 'respondToApproval');
    render(<WorkbenchPage runtime={runtime} sessionStore={new MemorySessionStore()} />);
    const composer = screen.getByRole('textbox', { name: '任务描述' });
    fireEvent.change(composer, { target: { value: '整理本周线索' } });
    fireEvent.keyDown(composer, { key: 'Enter', code: 'Enter' });
    fireEvent.click(await screen.findByRole('button', { name: '开始干' }));
    await screen.findAllByText('客户管理系统更新等待确认');
    fireEvent.click(screen.getByRole('button', { name: '确认更新' }));

    await waitFor(() => expect(authorize).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant_demo',
      approverActorRef: 'human:owner',
      approved: true,
    })));
    expect(respond).toHaveBeenCalledWith(expect.objectContaining({ runtimeId: runtime.id }), expect.any(String), true);
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

  it('restores a real runtime trajectory as interrupted without exposing a dead approval handle', async () => {
    const store = new MemorySessionStore();
    const plan = draftPlanFromPrompt('读取真实目录并生成摘要');
    const handle = { runtimeId: 'codex-cli', sessionId: 'ses_real_restart', nativeSessionId: 'thread_dead' };
    await store.saveSession(plan, handle);
    await store.appendEvent(handle, plan, {
      sessionId: handle.sessionId,
      sequence: 1,
      occurredAt: '2026-08-28T10:00:01.000Z',
      actorRef: 'employee:codex',
      type: 'tool',
      status: 'completed',
      title: '读取真实文件',
      tool: 'shell.command',
      args: { command: 'Get-Content input.txt' },
      result: '已读取',
      durationMs: 150,
      costCny: null,
      evidenceRefs: ['evidence://sha256/kept'],
    });
    await store.appendEvent(handle, plan, { sessionId: handle.sessionId, sequence: 2, occurredAt: '2026-08-28T10:00:02.000Z', actorRef: 'employee:codex', type: 'approval_required', approvalId: 'apr_dead', title: '写文件', message: '等待确认', tool: 'shell.command', args: {}, result: '待审', durationMs: null, costCny: null, evidenceRefs: [] });
    await store.appendEvent(handle, plan, { sessionId: handle.sessionId, sequence: 3, occurredAt: '2026-08-28T10:05:00.000Z', actorRef: 'system:desktop-host', type: 'status', status: 'interrupted', reason: '桌面宿主已重启，原执行进程已失效。', evidenceRefs: [] });

    render(<WorkbenchPage runtime={new MockRuntimeAdapter({ stepDelayMs: 1 })} sessionStore={store} />);

    expect(await screen.findByText('已中断')).toBeInTheDocument();
    expect(await screen.findByText('读取真实文件')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '确认更新' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '停止当前会话' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: '在当前会话补充要求' })).toBeDisabled();
  });
});
