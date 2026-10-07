import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FleetControlPanel, { type FleetControlPort } from './FleetControlPanel';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('FleetControlPanel explicit human controls', () => {
  it('polls read-only and records approval only after the explicit approve click', async () => {
    const port = fixturePort();
    render(<FleetControlPanel port={port} refreshMs={60_000} />);

    expect(await screen.findByLabelText('审批请求 request-1')).toHaveTextContent('写入合成报告');
    expect(port.decideApproval).not.toHaveBeenCalled();
    expect(port.stopTask).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '批准并继续：workspace.write → outputs/report.md' }));
    await waitFor(() => expect(port.decideApproval).toHaveBeenCalledTimes(1));
    expect(port.decideApproval).toHaveBeenCalledWith({ requestId: 'request-1', decision: 'approved' });
    expect(screen.getByRole('status')).toHaveTextContent('已批准');
  });

  it('records an explicit denial without supplying a renderer-controlled grant', async () => {
    const port = fixturePort();
    render(<FleetControlPanel port={port} refreshMs={60_000} />);

    const deny = await screen.findByRole('button', { name: '拒绝并停止本次任务：workspace.write → outputs/report.md' });
    expect(port.decideApproval).not.toHaveBeenCalled();
    fireEvent.click(deny);

    await waitFor(() => expect(port.decideApproval).toHaveBeenCalledTimes(1));
    expect(port.decideApproval).toHaveBeenCalledWith({
      requestId: 'request-1',
      decision: 'denied',
      rationale: '操作者在 HUMMER 工作台明确拒绝',
    });
    expect(JSON.stringify(port.decideApproval.mock.calls)).not.toContain('grantedScope');
  });

  it('stops only non-terminal tasks and renders the Relay receipt honestly', async () => {
    const port = fixturePort({
      tasks: [task('task-queued', 'queued', '待停止任务'), task('task-completed', 'completed', '已完成任务')],
      approvals: [],
    });
    render(<FleetControlPanel port={port} refreshMs={60_000} />);

    const stopQueued = await screen.findByRole('button', { name: '停止远程任务：待停止任务' });
    const stopCompleted = screen.getByRole('button', { name: '停止远程任务：已完成任务' });
    expect(stopCompleted).toBeDisabled();
    fireEvent.click(stopQueued);

    await waitFor(() => expect(port.stopTask).toHaveBeenCalledWith('task-queued'));
    expect(screen.getByRole('status')).toHaveTextContent('停止命令已由 Relay 记录：task-queued');
  });

  it('revokes an approved authorization only after an explicit click and keeps scope copy contract-derived', async () => {
    const port = fixturePort({ approvals: [approvedApproval()] });
    render(<FleetControlPanel port={port} refreshMs={60_000} />);

    const card = await screen.findByLabelText('生效中的授权 request-1');
    expect(card).toHaveTextContent('允许节点 node-a 执行 workspace.write outputs/report.md，直到 2099-01-01T00:00:00.000Z，最多 1 次');
    expect(port.revokeApproval).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '撤销本次授权：workspace.write → outputs/report.md' }));

    await waitFor(() => expect(port.revokeApproval).toHaveBeenCalledWith('request-1'));
    expect(screen.getByRole('status')).toHaveTextContent('下一个授权检查点停止');
  });
});

function fixturePort(overrides: {
  tasks?: ReturnType<typeof task>[];
  approvals?: ReturnType<typeof approval>[];
} = {}) {
  const port = {
    listTasks: vi.fn(async () => overrides.tasks ?? [task('task-1', 'leased', '写入合成报告')]),
    listApprovalRequests: vi.fn(async () => overrides.approvals ?? [approval()]),
    decideApproval: vi.fn(async () => ({ decision: { decision: 'approved' } })),
    revokeApproval: vi.fn(async () => ({ revocation: { requestId: 'request-1' } })),
    stopTask: vi.fn(async () => ({ task: { status: 'blocked' } })),
  } satisfies FleetControlPort;
  return port;
}

function task(taskId: string, status: 'queued' | 'leased' | 'blocked' | 'completed' | 'failed', title: string) {
  return {
    taskId,
    tenantId: 'tenant-a',
    status,
    targetNodeId: 'node-a',
    targetRuntime: 'codex',
    envelope: { workOrderTask: { title } },
  };
}

function approval() {
  return {
    requestId: 'request-1',
    tenantId: 'tenant-a',
    taskId: 'task-1',
    nodeId: 'node-a',
    action: 'workspace.write',
    target: 'outputs/report.md',
    riskClass: 'write',
    expiresAt: '2099-01-01T00:00:00.000Z',
    request: {
      action: 'workspace.write',
      target: 'outputs/report.md',
      riskClass: 'write',
      redactedPreview: '写入合成报告',
      expiresAt: '2099-01-01T00:00:00.000Z',
    },
  };
}

function approvedApproval() {
  return {
    ...approval(),
    decision: {
      decision: 'approved',
      grantedScope: {
        capabilities: ['task.execute'],
        resources: ['workspace://outputs/report.md'],
        expiresAt: '2099-01-01T00:00:00.000Z',
        maxUses: 1,
      },
    },
  };
}
