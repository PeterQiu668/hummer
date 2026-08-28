import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MCPAppsPage from './MCPAppsPage';

afterEach(() => { delete window.hummerRuntimeConnectors; });

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
});
