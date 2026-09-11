import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MCPAppsPage from './MCPAppsPage';

afterEach(() => {
  delete window.hummerRuntimeConnectors;
  delete window.hummerToolRegistry;
  localStorage.removeItem('hummer.auth.session');
});

describe('Capabilities and connections page', () => {
  it('combines experts, skills, knowledge, models and workplace connections', () => {
    render(<MCPAppsPage />);

    expect(screen.getByRole('heading', { name: '能力与连接' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '专家' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '技能' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '企业知识' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '模型' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '工作应用' })).toBeInTheDocument();
    expect(screen.getByText('飞书')).toBeInTheDocument();
    expect(screen.getByText('钉钉')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '技能' }));
    expect(screen.getByText('线索整理与跟进')).toBeInTheDocument();
  });

  it('labels only a host-observed MCP handshake as connected', async () => {
    window.hummerRuntimeConnectors = {
      list: vi.fn().mockResolvedValue([{
        id: 'node_repl',
        runtimeId: 'codex-cli',
        technicalName: 'node_repl',
        transport: 'mcp',
        status: 'connected',
        checkedAt: '2026-08-28T06:28:55.354Z',
        sessionId: 'thread-1',
        error: null,
      }]),
      subscribe: vi.fn(() => () => undefined),
    };

    render(<MCPAppsPage />);

    expect(await screen.findByText('本地工具连接器')).toBeInTheDocument();
    expect(screen.getAllByText('已验证连接').length).toBeGreaterThan(0);
    expect(screen.getByText(/技术名称：node_repl/)).toBeInTheDocument();
    expect(screen.getByText('飞书')).toBeInTheDocument();
    expect(screen.getAllByText('待接入').length).toBeGreaterThan(0);
  });

  it('marks fs.read verified only after the desktop handshake succeeds', async () => {
    const pending = {
      id: 'tool_fs_read', tenantId: 'tenant_1', capabilityId: 'fs.read', displayName: '工作区文件读取',
      transport: 'mcp' as const, riskLevel: 'low' as const, policyActionPattern: 'fs.read',
      endpoint: { serverName: 'hummer_local', toolName: 'fs_read' }, status: 'pending' as const, verifiedAt: null,
    };
    const verifyLocalMcp = vi.fn().mockResolvedValue({ ...pending, status: 'verified', verifiedAt: '2026-09-11T05:00:00.000Z' });
    window.hummerToolRegistry = {
      list: vi.fn().mockResolvedValue([pending]),
      verifyLocalMcp,
      createExternalSendDraft: vi.fn(),
    };
    window.hummerRuntimeConnectors = {
      list: vi.fn().mockResolvedValue([]),
      subscribe: vi.fn(() => () => undefined),
    };
    localStorage.setItem('hummer.auth.session', 'test-token');

    render(<MCPAppsPage />);

    const card = (await screen.findByText('工作区文件读取')).closest<HTMLElement>('.hum-card');
    if (!card) throw new Error('Tool card was not rendered');
    expect(within(card).getByText('待接入')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '验证连接' }));
    await waitFor(() => expect(verifyLocalMcp).toHaveBeenCalled());
    await waitFor(() => expect(within(card).getByText('已验证连接')).toBeInTheDocument());
  });
});
