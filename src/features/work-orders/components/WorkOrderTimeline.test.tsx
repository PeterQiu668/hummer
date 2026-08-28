import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WorkOrderTimeline } from './WorkOrderTimeline';

describe('WorkOrderTimeline', () => {
  it('sorts events by sequence and displays the actor and occurrence time', () => {
    render(
      <WorkOrderTimeline
        events={[
          {
            sequence: 3,
            type: 'work_order.planned',
            actorRef: 'employee:gtm-01',
            occurredAt: '2026-08-23T09:20:00Z',
          },
          {
            sequence: 1,
            type: 'work_order.submitted',
            actorRef: 'human:owner-01',
            occurredAt: '2026-08-23T09:00:00Z',
          },
          {
            sequence: 2,
            type: 'work_order.assigned',
            actorRef: 'human:owner-01',
            occurredAt: '2026-08-23T09:10:00Z',
          },
        ]}
      />,
    );

    expect(screen.getAllByRole('listitem').map((item) => item.getAttribute('aria-label'))).toEqual([
      '事件 1：任务已提交',
      '事件 2：任务已分派',
      '事件 3：执行计划已就绪',
    ]);
    expect(screen.getAllByText('human:owner-01')).toHaveLength(2);
    expect(screen.getByText('2026-08-23 09:00 UTC')).toBeVisible();
  });

  it('makes approval requests and decisions visible', () => {
    render(
      <WorkOrderTimeline
        events={[
          {
            sequence: 4,
            type: 'approval.requested',
            actorRef: 'system:policy',
            occurredAt: '2026-08-23T09:30:00Z',
          },
          {
            sequence: 5,
            type: 'approval.decided',
            actorRef: 'human:owner-01',
            occurredAt: '2026-08-23T09:45:00Z',
          },
        ]}
      />,
    );

    expect(screen.getByText('已发起审批')).toBeVisible();
    expect(screen.getByText('审批已决策')).toBeVisible();
  });

  it('shows a clear empty state when no events exist', () => {
    render(<WorkOrderTimeline events={[]} />);

    expect(screen.getByRole('status')).toHaveTextContent('暂无执行事件');
  });
});
