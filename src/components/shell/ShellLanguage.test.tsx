import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import LeftNav from './LeftNav';
import TopBar from './TopBar';

describe('commercial shell language', () => {
  it('uses business-facing navigation and exposes personal settings', () => {
    render(<><TopBar /><LeftNav /></>);

    expect(screen.getAllByText('团队协作').length).toBeGreaterThan(0);
    expect(screen.getAllByText('能力与连接').length).toBeGreaterThan(0);
    expect(screen.getAllByText('成长与复盘').length).toBeGreaterThan(0);
    expect(screen.queryByText('机器')).not.toBeInTheDocument();
    expect(screen.queryByText(/Hermes|HiClaw|龙虾/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '打开个人菜单' }));
    expect(screen.getByRole('button', { name: '我的设置' })).toBeInTheDocument();
  });
});
