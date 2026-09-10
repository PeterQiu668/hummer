import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import MySettingsDrawer from './MySettingsDrawer';

describe('MySettingsDrawer', () => {
  afterEach(() => {
    delete window.hummerEngineCredentials;
    delete window.hummerEngineProfiles;
    localStorage.clear();
  });

  it('updates model, permission and digital-twin preferences', () => {
    render(<MySettingsDrawer />);

    fireEvent.change(screen.getByLabelText('默认模型'), { target: { value: '旗舰' } });
    fireEvent.change(screen.getByLabelText('默认任务权限'), { target: { value: 'L1' } });
    fireEvent.click(screen.getByRole('checkbox', { name: '职场导师建议' }));
    fireEvent.click(screen.getByRole('button', { name: '保存我的设置' }));

    expect(useAppStore.getState().personalSettings).toMatchObject({
      preferredModel: '旗舰',
      defaultPermission: 'L1',
      mentorEnabled: false,
    });
  });

  it('stores an engine credential without ever rendering it back', async () => {
    localStorage.setItem('hummer.auth.session', 'session-token');
    window.hummerEngineProfiles = {
      list: vi.fn().mockResolvedValue([
        { id: 'deepseek-standard', tier: 'standard', label: '\u6807\u51c6', available: false, dataDomain: 'api.deepseek.com', credentialStatus: 'not_configured', compatibilityNote: '\u672a\u914d\u7f6e\u5bc6\u94a5' },
      ]),
    };
    window.hummerEngineCredentials = {
      configure: vi.fn().mockResolvedValue({ engineProfileId: 'deepseek-standard', envKey: 'DEEPSEEK_API_KEY', configured: true }),
      remove: vi.fn(),
    };
    render(<MySettingsDrawer />);
    const input = await screen.findByLabelText('\u6807\u51c6\u5bc6\u94a5');

    fireEvent.change(input, { target: { value: 'sk-fake-ui-secret' } });
    fireEvent.click(screen.getByRole('button', { name: '\u4fdd\u5b58\u6807\u51c6\u5bc6\u94a5' }));

    await waitFor(() => expect(window.hummerEngineCredentials?.configure).toHaveBeenCalledWith({
      token: 'session-token', engineProfileId: 'deepseek-standard', credential: 'sk-fake-ui-secret',
    }));
    expect(input).toHaveValue('');
    expect(screen.queryByDisplayValue('sk-fake-ui-secret')).not.toBeInTheDocument();
  });
});
