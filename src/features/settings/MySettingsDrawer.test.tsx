import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import MySettingsDrawer from './MySettingsDrawer';

describe('MySettingsDrawer', () => {
  it('updates model, permission and digital-twin preferences', () => {
    render(<MySettingsDrawer />);

    fireEvent.change(screen.getByLabelText('默认模型'), { target: { value: '公司私有模型' } });
    fireEvent.change(screen.getByLabelText('默认任务权限'), { target: { value: 'L1' } });
    fireEvent.click(screen.getByRole('checkbox', { name: '职场导师建议' }));
    fireEvent.click(screen.getByRole('button', { name: '保存我的设置' }));

    expect(useAppStore.getState().personalSettings).toMatchObject({
      preferredModel: '公司私有模型',
      defaultPermission: 'L1',
      mentorEnabled: false,
    });
  });
});
