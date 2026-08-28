import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import MCPAppsPage from './MCPAppsPage';

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
});
