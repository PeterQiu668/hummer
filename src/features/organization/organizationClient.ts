import { currentSessionToken } from '../identity/identityClient';

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
  departmentId: string;
  name: string;
  jobTitle: string;
  runtimeProfile: string;
  autonomyLevel: 'L1' | 'L2' | 'L3';
  idempotencyKey: string;
}
export interface OrganizationPort {
  listDigitalEmployees(): Promise<DigitalEmployeeRecord[]>;
  hireDigitalEmployee(command: HireDigitalEmployeeCommand): Promise<DigitalEmployeeRecord>;
}
export interface DesktopOrganizationHost {
  listDigitalEmployees(token: string): Promise<DigitalEmployeeRecord[]>;
  hireDigitalEmployee(request: { token: string; input: HireDigitalEmployeeCommand }): Promise<DigitalEmployeeRecord>;
}
declare global { interface Window { hummerOrganization?: DesktopOrganizationHost } }

export function desktopOrganizationPort(): OrganizationPort | undefined {
  if (typeof window === 'undefined' || !window.hummerOrganization) return undefined;
  const host = window.hummerOrganization;
  return {
    listDigitalEmployees: () => host.listDigitalEmployees(requireToken()),
    hireDigitalEmployee: (command) => host.hireDigitalEmployee({ token: requireToken(), input: command }),
  };
}
function requireToken(): string {
  const token = currentSessionToken();
  if (!token) throw new Error('Organization access requires an authenticated session');
  return token;
}
