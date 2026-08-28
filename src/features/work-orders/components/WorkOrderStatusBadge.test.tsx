import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WorkOrderStatusBadge } from './WorkOrderStatusBadge';

describe('WorkOrderStatusBadge', () => {
  it('makes a protected action visible as waiting for approval', () => {
    render(<WorkOrderStatusBadge status="awaiting_approval" />);

    expect(screen.getByText('待人工审批')).toBeVisible();
    expect(screen.getByLabelText('任务状态：待人工审批')).toBeVisible();
  });
});
