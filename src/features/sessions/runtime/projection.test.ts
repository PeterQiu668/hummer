import { describe, expect, it } from 'vitest';
import type { RuntimeEvent } from './adapter';
import { findPendingApproval } from './projection';

describe('runtime approval projection', () => {
  it('does not let an earlier resolution hide a later request that reuses the native id', () => {
    const events: RuntimeEvent[] = [
      {
        type: 'approval_required', sessionId: 'session-fork', sequence: 1, occurredAt: '2026-08-29T00:00:00.000Z',
        actorRef: 'employee:runtime', approvalId: '0', title: 'first', message: 'first', tool: 'shell.command',
        args: {}, result: 'waiting', durationMs: null, costCny: null, evidenceRefs: [],
      },
      {
        type: 'approval_resolved', sessionId: 'session-fork', sequence: 2, occurredAt: '2026-08-29T00:00:01.000Z',
        actorRef: 'human:operator', approvalId: '0', approved: true, result: 'approved', evidenceRefs: [],
      },
      {
        type: 'approval_required', sessionId: 'session-fork', sequence: 3, occurredAt: '2026-08-29T00:00:02.000Z',
        actorRef: 'employee:runtime', approvalId: '0', title: 'second', message: 'second', tool: 'shell.command',
        args: {}, result: 'waiting', durationMs: null, costCny: null, evidenceRefs: [],
      },
    ];

    expect(findPendingApproval(events)?.title).toBe('second');
  });

  it('clears a request only when its resolution occurs later in the trajectory', () => {
    const events: RuntimeEvent[] = [
      {
        type: 'approval_required', sessionId: 'session', sequence: 1, occurredAt: '2026-08-29T00:00:00.000Z',
        actorRef: 'employee:runtime', approvalId: 'thread:0', title: 'write', message: 'write', tool: 'shell.command',
        args: {}, result: 'waiting', durationMs: null, costCny: null, evidenceRefs: [],
      },
      {
        type: 'approval_resolved', sessionId: 'session', sequence: 2, occurredAt: '2026-08-29T00:00:01.000Z',
        actorRef: 'human:operator', approvalId: 'thread:0', approved: true, result: 'approved', evidenceRefs: [],
      },
    ];
    expect(findPendingApproval(events)).toBeUndefined();
  });
});
