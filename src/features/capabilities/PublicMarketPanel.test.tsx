import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PublicMarketPanel from './PublicMarketPanel';
import {
  configureRemotePublicMarketplace,
  type PublicCapabilityListing,
} from './publicMarketClient';

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  localStorage.clear();
});

describe('[PUBLIC-MARKET-UI] public read-only capability surface', () => {
  it('is explicitly unavailable without a configured Remote Relay and shows no samples', () => {
    render(<PublicMarketPanel query="" />);
    expect(screen.getByText(/未配置 Remote Relay/)).toBeInTheDocument();
    expect(screen.queryByTestId('public-capability-card')).not.toBeInTheDocument();
  });

  it('renders a 390px-safe real projection with source, trials, failures, permissions and integrity', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    const listing = fixture();
    const report = vi.fn().mockResolvedValue({ reportId: 'report-1', status: 'open', createdAt: listing.publishedAt });
    dispose = configureRemotePublicMarketplace({
      listPublicCapabilities: vi.fn().mockResolvedValue([listing]),
      getPublicCapability: vi.fn().mockResolvedValue(listing),
      reportPublicCapability: report,
    });

    render(<PublicMarketPanel query="" />);
    const card = await screen.findByTestId('public-capability-card');
    expect(card).toHaveClass('min-w-0', 'overflow-hidden');
    expect(within(card).getByText('Evidence research')).toBeInTheDocument();
    expect(within(card).getByText(/5 成功 \/ 0 失败 \/ 5 次影子运行/)).toBeInTheDocument();
    expect(within(card).getByText(/失败摘要 1 条/)).toBeInTheDocument();
    expect(within(card).getByText(/network.read · read/)).toBeInTheDocument();
    expect(within(card).getByText(/完整性摘要/)).toHaveTextContent('a'.repeat(64));

    fireEvent.click(within(card).getByRole('button', { name: /查看详情/ }));
    const detail = await screen.findByTestId('public-capability-detail');
    expect(within(detail).getByText(/证据 1 · 回执 receipt-1/)).toBeInTheDocument();
    expect(within(detail).getByRole('button', { name: /安装器未连接/ })).toBeDisabled();
    expect(within(detail).getByRole('button', { name: /安装器未连接/ })).toHaveClass('w-full');

    fireEvent.change(within(detail).getByLabelText('举报原因'), { target: { value: '来源披露需要人工复核' } });
    fireEvent.click(within(detail).getByRole('button', { name: /提交举报/ }));
    expect(await within(detail).findByText(/仍保持公开/)).toBeInTheDocument();
    expect(report).toHaveBeenCalledWith('listing-public', '来源披露需要人工复核');
    expect(screen.getAllByText('Evidence research')).toHaveLength(2);
    expect(localStorage.length).toBe(0);
  });

  it('removes a human-taken-down listing and its install request surface after refresh', async () => {
    const listing = fixture();
    const list = vi.fn()
      .mockResolvedValueOnce([listing])
      .mockResolvedValueOnce([]);
    dispose = configureRemotePublicMarketplace({
      listPublicCapabilities: list,
      getPublicCapability: vi.fn().mockResolvedValue(listing),
      reportPublicCapability: vi.fn(),
    }, { requestInstall: vi.fn() });

    render(<PublicMarketPanel query="" />);
    fireEvent.click(await screen.findByRole('button', { name: /查看详情/ }));
    expect(await screen.findByRole('button', { name: /申请可信安装/ })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /刷新/ }));

    await waitFor(() => expect(screen.queryByText('Evidence research')).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /申请可信安装/ })).not.toBeInTheDocument();
    expect(screen.getByText(/已下架条目不会显示/)).toBeInTheDocument();
  });
});

function fixture(): PublicCapabilityListing {
  return {
    schema: 'hummer.public-capability-listing', version: 1, listingId: 'listing-public', status: 'public',
    packageId: 'cap-public', packageVersion: 1, packageDigest: 'a'.repeat(64),
    integrity: { kind: 'package_digest', digest: 'a'.repeat(64) }, title: 'Evidence research',
    goal: 'Produce an evidence-grounded synthesis.', publisherRef: 'publisher:0123456789abcdef',
    provenance: { capturedAt: '2026-10-07T08:00:00.000Z', runtime: 'codex', runtimeVersion: '0.153.4', agentVersion: '1.0.0', demoSessionCount: 1 },
    sourceBoundary: { applicationCount: 1, windowPatternCount: 1, includePathCount: 1, excludePathCount: 1 },
    trialRecord: { shadowRuns: 5, success: 5, failure: 0, lastRunAt: '2026-10-07T08:30:00.000Z', regressionPassed: true, regressionEvidenceDigest: 'b'.repeat(64) },
    failureNotes: [{ summary: 'Publisher-recorded failure note', digest: 'c'.repeat(64) }],
    declaredPermissions: [{ capability: 'network.read', access: 'read', paths: [] }],
    receiptRef: 'receipt-1', evidenceCount: 1, publishedAt: '2026-10-07T09:00:00.000Z',
  };
}
