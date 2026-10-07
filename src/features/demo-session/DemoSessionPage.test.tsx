import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DemoSessionV1 } from '@hummer/contracts';
import DemoSessionPage from './DemoSessionPage';

const baseSession: DemoSessionV1 = {
  schema: 'hummer.demo-session', version: 1, sessionId: 'demo_surface', tenantId: 'tenant_demo',
  expertActorRef: 'human:owner', nodeId: 'node_local_demo',
  sourceBoundary: { apps: ['Microsoft Excel'], windows: ['销售周报'], excluded: ['密码'] },
  startedAt: '2026-10-07T08:00:00.000Z', pausedCount: 0,
  segments: [{ segId: 'seg_one', sequence: 1, from: '2026-10-07T08:00:00.000Z', recordCount: 0, previousDigest: null, digest: 'a'.repeat(64) }],
  captureMode: 'events-only', status: 'capturing', localOnly: true, redactionApplied: false,
  evidenceRefs: [], chainHead: 'a'.repeat(64), deletionAudit: [],
};

afterEach(() => {
  delete window.hummerDemoSessions;
  localStorage.clear();
});

describe('[DEMO-SESSION-UI] honest local teaching control surface', () => {
  it('states the adapter limitation and starts only with explicit application/window allowlists', async () => {
    const host = installHost();
    render(<DemoSessionPage />);
    expect(screen.getByText(/Windows UIAutomation · 仅本机元数据/)).toBeInTheDocument();
    expect(screen.getByText(/不会采集屏幕、键盘原文或视频/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('允许的应用'), { target: { value: 'Microsoft Excel, ERP' } });
    fireEvent.change(screen.getByLabelText('允许的窗口'), { target: { value: '销售周报\n订单列表' } });
    fireEvent.click(screen.getByRole('button', { name: /启动本地会话/ }));
    await waitFor(() => expect(host.start).toHaveBeenCalledWith({
      token: 'auth-demo',
      input: {
        captureMode: 'events-only',
        sourceBoundary: { apps: ['Microsoft Excel', 'ERP'], windows: ['销售周报', '订单列表'], excluded: ['密码', '支付'] },
      },
    }));
    expect(await screen.findByText('本地会话进行中')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /伪|模拟|注入/ })).not.toBeInTheDocument();
  });

  it('requires an explicit process id and exact allowlisted title before a one-shot UIAutomation capture', async () => {
    const captured = { accepted: true as const, processId: 4242, app: 'Microsoft Excel', window: '销售周报', capturedRecords: 3, session: { ...baseSession, segments: [{ ...baseSession.segments[0]!, recordCount: 3 }] } };
    const host = installHost({ captureUia: vi.fn().mockResolvedValue(captured) });
    render(<DemoSessionPage />);
    startSession();
    await screen.findByText('本地会话进行中');
    fireEvent.change(screen.getByLabelText('目标进程 ID'), { target: { value: '4242' } });
    fireEvent.change(screen.getByLabelText('精确窗口标题'), { target: { value: '销售周报' } });
    fireEvent.click(screen.getByRole('button', { name: /采集一次可访问性元数据/ }));
    await waitFor(() => expect(host.captureUia).toHaveBeenCalledWith({
      token: 'auth-demo', input: { sessionId: 'demo_surface', processId: 4242, windowTitle: '销售周报' },
    }));
    expect(await screen.findByText(/已采集 3 条/)).toBeInTheDocument();
  });

  it('requires confirmation before segment deletion and renders the re-chained tombstone returned by Desktop', async () => {
    const paused: DemoSessionV1 = {
      ...baseSession,
      status: 'paused', pausedCount: 1,
      segments: [{ ...baseSession.segments[0]!, to: '2026-10-07T08:02:00.000Z', recordCount: 2 }],
    };
    const deleted: DemoSessionV1 = {
      ...paused,
      segments: [{ ...paused.segments[0]!, deletedAt: '2026-10-07T08:03:00.000Z', recordCount: 0, digest: 'b'.repeat(64) }],
      chainHead: 'b'.repeat(64),
      deletionAudit: [{ segId: 'seg_one', requestedAt: '2026-10-07T08:03:00.000Z', by: 'human:owner', purgedAt: '2026-10-07T08:03:00.000Z', previousDigest: 'a'.repeat(64), replacementDigest: 'b'.repeat(64) }],
    };
    const host = installHost({ pause: vi.fn().mockResolvedValue(paused), deleteSegment: vi.fn().mockResolvedValue(deleted) });
    render(<DemoSessionPage />);
    startSession();
    await screen.findByText('本地会话进行中');
    fireEvent.click(screen.getByRole('button', { name: '暂停' }));
    await screen.findByText('已暂停');
    fireEvent.click(screen.getByRole('button', { name: '删除段落' }));
    expect(screen.getByRole('alertdialog', { name: '确认删除段落' })).toBeInTheDocument();
    expect(host.deleteSegment).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认删除并重链' }));
    await waitFor(() => expect(host.deleteSegment).toHaveBeenCalledWith({ token: 'auth-demo', input: { sessionId: 'demo_surface', segmentId: 'seg_one' } }));
    expect(await screen.findByText(/已删除并重链/)).toBeInTheDocument();
  });

  it('does not expose review export before the user marks the ended session redacted', async () => {
    const ended: DemoSessionV1 = { ...baseSession, status: 'ended', endedAt: '2026-10-07T08:04:00.000Z', segments: [{ ...baseSession.segments[0]!, to: '2026-10-07T08:04:00.000Z' }] };
    const redacted: DemoSessionV1 = { ...ended, redactionApplied: true, redactionPolicyRef: 'local-human-review-v1' };
    const host = installHost({ end: vi.fn().mockResolvedValue(ended), markRedacted: vi.fn().mockResolvedValue(redacted), exportReview: vi.fn().mockResolvedValue(redacted) });
    render(<DemoSessionPage />);
    startSession();
    await screen.findByText('本地会话进行中');
    fireEvent.click(screen.getByRole('button', { name: '结束' }));
    expect(await screen.findByText(/未脱敏，禁止离开本机/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '生成复核投影' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /确认本地复核并标记已脱敏/ }));
    expect(await screen.findByText(/已记录脱敏复核/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '生成复核投影' }));
    await waitFor(() => expect(host.exportReview).toHaveBeenCalledOnce());
    expect(screen.getByLabelText('复核投影')).toHaveTextContent('hummer.demo-session');
  });
});

function installHost(overrides: Partial<NonNullable<Window['hummerDemoSessions']>> = {}) {
  localStorage.setItem('hummer.auth.session', 'auth-demo');
  const host = {
    start: vi.fn().mockResolvedValue(baseSession), get: vi.fn().mockResolvedValue(baseSession),
    pause: vi.fn(), resume: vi.fn(), end: vi.fn(), deleteSegment: vi.fn(), markRedacted: vi.fn(), exportReview: vi.fn(), captureUia: vi.fn(),
    ...overrides,
  };
  window.hummerDemoSessions = host;
  return host;
}

function startSession() {
  fireEvent.change(screen.getByLabelText('允许的应用'), { target: { value: 'Microsoft Excel' } });
  fireEvent.change(screen.getByLabelText('允许的窗口'), { target: { value: '销售周报' } });
  fireEvent.click(screen.getByRole('button', { name: /启动本地会话/ }));
}
