import { currentSessionToken } from '../identity/identityClient';

export type WorkOrderIntakeSource = 'folder' | 'form';
export type WorkOrderIntakeStatus = 'pending' | 'confirmed' | 'cancelled';

export interface WorkOrderIntakePayload {
  title: string;
  target: string;
  expectedDeliverable: string;
  assignee: string;
  dueAt: string | null;
  attachmentNames: string[];
  prompt: string;
  executable?: boolean;
  suggestedCapabilities?: string[];
  preReadSummary?: string;
  preReadError?: string;
  sourceSha256?: string;
}

export interface WorkOrderIntakeRecord {
  id: string;
  tenantId: string;
  source: WorkOrderIntakeSource;
  externalRef: string;
  receivedAt: string;
  status: WorkOrderIntakeStatus;
  payloadEvidenceRef: string;
  payload: WorkOrderIntakePayload;
  workOrderId: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkOrderInboxRecord { tenantId: string; directory: string; enabled: boolean }

export interface WorkOrderIntakePort {
  list(): Promise<WorkOrderIntakeRecord[]>;
  listAll(): Promise<WorkOrderIntakeRecord[]>;
  submitForm(payload: WorkOrderIntakePayload): Promise<WorkOrderIntakeRecord>;
  confirm(id: string): Promise<WorkOrderIntakeRecord>;
  inbox(): Promise<WorkOrderInboxRecord | null>;
  chooseInbox(): Promise<WorkOrderInboxRecord | null>;
  configureInbox(directory: string): Promise<WorkOrderInboxRecord>;
}

interface WorkOrderIntakeHost {
  list(token: string): Promise<WorkOrderIntakeRecord[]>;
  listAll(token: string): Promise<WorkOrderIntakeRecord[]>;
  submitForm(request: { token: string; input: WorkOrderIntakePayload }): Promise<WorkOrderIntakeRecord>;
  confirm(request: { token: string; input: { id: string } }): Promise<WorkOrderIntakeRecord>;
  inbox(token: string): Promise<WorkOrderInboxRecord | null>;
  chooseInbox(token: string): Promise<WorkOrderInboxRecord | null>;
  configureInbox(token: string, directory: string): Promise<WorkOrderInboxRecord>;
}

declare global { interface Window { hummerWorkOrderIntake?: WorkOrderIntakeHost } }

export function desktopWorkOrderIntakePort(): WorkOrderIntakePort | undefined {
  if (typeof window === 'undefined' || !window.hummerWorkOrderIntake) return undefined;
  const host = window.hummerWorkOrderIntake;
  return {
    list: () => host.list(requireToken()),
    listAll: () => host.listAll(requireToken()),
    submitForm: (input) => host.submitForm({ token: requireToken(), input }),
    confirm: (id) => host.confirm({ token: requireToken(), input: { id } }),
    inbox: () => host.inbox(requireToken()),
    chooseInbox: () => host.chooseInbox(requireToken()),
    configureInbox: (directory) => host.configureInbox(requireToken(), directory),
  };
}

function requireToken(): string {
  const token = currentSessionToken();
  if (!token) throw new Error('Work order intake requires an authenticated account');
  return token;
}
