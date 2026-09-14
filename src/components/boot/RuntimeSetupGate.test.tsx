import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RuntimeSetupGate from './RuntimeSetupGate';

describe('RuntimeSetupGate', () => {
  afterEach(() => { delete window.hummerEnvironmentDoctor; });

  it('shows a Chinese repair path when Codex is unavailable and can recheck', async () => {
    const check = vi.fn()
      .mockResolvedValueOnce({
        ready: false,
        node: { available: true, version: '22.22.3', source: 'embedded' },
        codex: { available: false, compatible: false, expectedVersion: '0.153.4', issue: 'Codex CLI \u672a\u5b89\u88c5' },
      })
      .mockResolvedValueOnce({
        ready: true,
        node: { available: true, version: '22.22.3', source: 'embedded' },
        codex: { available: true, compatible: true, version: '0.153.4', expectedVersion: '0.153.4' },
        workspaceExec: { available: false, runtime: 'docker', passed: 4, total: 5, checkedAt: '2026-09-13T13:00:00.000Z', issue: '执行能力不可用：本机网络隔离未生效' },
      });
    window.hummerEnvironmentDoctor = { check, openInstallGuide: vi.fn() };

    render(<RuntimeSetupGate><div>workspace ready</div></RuntimeSetupGate>);
    expect(await screen.findByRole('heading', { name: '\u5b8c\u6210\u6267\u884c\u73af\u5883\u8bbe\u7f6e' })).toBeInTheDocument();
    expect(screen.getByText(/Codex CLI \u672a\u5b89\u88c5/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '\u67e5\u770b\u5b89\u88c5\u6307\u5f15' }));
    expect(window.hummerEnvironmentDoctor.openInstallGuide).toHaveBeenCalledWith('codex');
    fireEvent.click(screen.getByRole('button', { name: '\u91cd\u65b0\u68c0\u6d4b' }));
    await waitFor(() => expect(screen.getByText('workspace ready')).toBeInTheDocument());
    expect(screen.getByText('执行能力不可用：本机网络隔离未生效')).toBeInTheDocument();
  });

  it('does not block the browser prototype', async () => {
    render(<RuntimeSetupGate><div>browser prototype</div></RuntimeSetupGate>);
    expect(await screen.findByText('browser prototype')).toBeInTheDocument();
  });

  it('offers the Podman setup guide without hiding the rest of the app', async () => {
    const openInstallGuide = vi.fn();
    window.hummerEnvironmentDoctor = {
      check: vi.fn().mockResolvedValue({
        ready: true,
        node: { available: true, version: '22.22.3', source: 'embedded' },
        codex: { available: true, compatible: true, version: '0.153.4', expectedVersion: '0.153.4' },
        container: { available: false, runtime: 'unavailable', preferredRuntime: 'podman', productionRecommended: false, issue: '未检测到容器运行时。请先安装 Podman Desktop，并按引导启用 WSL2。' },
        workspaceExec: { available: false, runtime: 'unavailable', passed: 0, total: 5, checkedAt: '2026-09-14T08:00:00.000Z', issue: '执行能力不可用：未找到 Podman 或 Docker 容器运行时' },
      }),
      openInstallGuide,
    };

    render(<RuntimeSetupGate><div>workspace ready</div></RuntimeSetupGate>);
    expect(await screen.findByText('workspace ready')).toBeInTheDocument();
    expect(screen.getByText(/未检测到容器运行时/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '安装 Podman' }));
    expect(openInstallGuide).toHaveBeenCalledWith('container');
  });
});
