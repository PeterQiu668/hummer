import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ExecutionNodesPage from './ExecutionNodesPage';

afterEach(() => { delete window.hummerExecutionNodes; });

describe('ExecutionNodesPage', () => {
  it('shows host-backed node facts and sends the real kill-all command', async () => {
    const killAll = vi.fn().mockResolvedValue({ killed: 1 });
    window.hummerExecutionNodes = {
      list: vi.fn().mockResolvedValue([{ id: 'node_local', tenantId: 'tenant_demo', displayName: 'H4-480', runtimeId: 'codex-cli', status: 'online', cwd: 'C:\\workspace', permissionScope: 'workspace-write; approval-required', currentSessionId: 'ses_live', lastSeenAt: '2026-08-28T11:00:00.000Z' }]),
      killAll,
    };

    const { container } = render(<ExecutionNodesPage />);
    expect(await screen.findByText('H4-480')).toBeInTheDocument();
    expect(screen.getByText('当前会话 ses_live')).toBeInTheDocument();
    expect(screen.getByText('workspace-write; approval-required')).toBeInTheDocument();
    expect(container.querySelector('[data-node-id="node_local"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '全部停止' }));
    await waitFor(() => expect(killAll).toHaveBeenCalledOnce());
  });
});
