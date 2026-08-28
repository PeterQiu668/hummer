export interface DigitalEmployeeRecord {
  id: string;
  tenantId: string;
  sponsorActorRef: string;
  departmentId: string | null;
  name: string;
  jobTitle: string;
  runtimeProfile: string;
  autonomyLevel: 'L1' | 'L2' | 'L3';
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface HireDigitalEmployeeCommand {
  id: string;
  tenantId: string;
  sponsorActorRef: string;
  departmentId: string;
  name: string;
  jobTitle: string;
  runtimeProfile: string;
  autonomyLevel: 'L1' | 'L2' | 'L3';
  idempotencyKey: string;
}

export interface OrganizationPort {
  listDigitalEmployees(tenantId: string): Promise<DigitalEmployeeRecord[]>;
  hireDigitalEmployee(command: HireDigitalEmployeeCommand): Promise<DigitalEmployeeRecord>;
}

declare global {
  interface Window {
    hummerOrganization?: OrganizationPort;
  }
}

export function desktopOrganizationPort(): OrganizationPort | undefined {
  return typeof window === 'undefined' ? undefined : window.hummerOrganization;
}
