import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApprovalContinuationWatchdog } from './approval-watchdog.js';

afterEach(() => vi.useRealTimers());

describe('ApprovalContinuationWatchdog', () => {
  it('reports when the runtime emits no event after an approval response', () => {
    vi.useFakeTimers();
    const failures: string[] = [];
    const watchdog = new ApprovalContinuationWatchdog(5_000, (approvalId) => failures.push(approvalId));

    watchdog.arm('approval-1');
    vi.advanceTimersByTime(5_000);

    expect(failures).toEqual(['approval-1']);
  });

  it('clears pending approvals when the runtime continues', () => {
    vi.useFakeTimers();
    const failures: string[] = [];
    const watchdog = new ApprovalContinuationWatchdog(5_000, (approvalId) => failures.push(approvalId));

    watchdog.arm('approval-1');
    watchdog.acknowledgeAll();
    vi.advanceTimersByTime(5_000);

    expect(failures).toEqual([]);
  });
});
