import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DigitalEmployeeRecord, OrganizationPort } from '../../features/organization/organizationClient';
import EmployeesPage from './EmployeesPage';

const hiredEmployee: DigitalEmployeeRecord = {
  id: 'employee_m-1',
  tenantId: 'tenant_demo',
  sponsorActorRef: 'human:owner',
  departmentId: 'department_sales',
  name: '高客单 BD 顾问',
  jobTitle: '销售增长',
  runtimeProfile: 'standard',
  autonomyLevel: 'L2',
  status: 'probation',
  createdAt: '2026-08-28T14:30:00.000Z',
  updatedAt: '2026-08-28T14:30:00.000Z',
};

afterEach(() => {
  delete window.hummerOrganization;
});

describe('EmployeesPage organization facts', () => {
  it('renders the durable employee id returned by the desktop organization port', async () => {
    const organization: OrganizationPort = {
      listDigitalEmployees: vi.fn().mockResolvedValue([]),
      hireDigitalEmployee: vi.fn().mockResolvedValue(hiredEmployee),
    };
    window.hummerOrganization = organization;

    const { container } = render(<EmployeesPage />);
    fireEvent.click(screen.getByRole('button', { name: '添加数字同事' }));
    fireEvent.click(screen.getAllByRole('button', { name: /开始 7 天试用/ })[0]);

    await waitFor(() => expect(organization.hireDigitalEmployee).toHaveBeenCalledWith(expect.objectContaining({
      id: hiredEmployee.id,
      tenantId: hiredEmployee.tenantId,
      sponsorActorRef: hiredEmployee.sponsorActorRef,
    })));
    expect(await screen.findByText(hiredEmployee.id)).toBeInTheDocument();
    expect(container.querySelector(`[data-employee-id="${hiredEmployee.id}"]`)).not.toBeNull();
  });

  it('builds project teams from accountable human-twin pairs and temporary digital assistants', async () => {
    const organization: OrganizationPort = {
      listDigitalEmployees: vi.fn().mockResolvedValue([]),
      hireDigitalEmployee: vi.fn(),
    };
    window.hummerOrganization = organization;

    const { container } = render(<EmployeesPage />);
    expect(container.textContent).not.toMatch(/Worker|Manager|Agent|Skill/);
    expect(screen.getByText('我和我的分身')).toBeInTheDocument();
    expect(screen.getByText('真人负责结果，分身代表协同')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '项目小队' }));
    fireEvent.click(screen.getByRole('button', { name: '组建项目小队' }));
    expect(screen.getByRole('heading', { name: '组建项目小队' })).toBeInTheDocument();
    expect(screen.getByText(/昆仑.*最终负责人/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /邀请吴帆/ }));
    expect(screen.getAllByText('吴帆 + 吴帆分身').length).toBeGreaterThan(1);
    expect(screen.getAllByText('临时助手 · 不承担最终责任').length).toBeGreaterThan(0);
  });
});
