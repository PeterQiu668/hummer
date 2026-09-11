import { currentSessionToken } from '../identity/identityClient';

export interface ToolDefinitionRecord {
  id: string;
  tenantId: string;
  capabilityId: string;
  displayName: string;
  transport: 'mcp' | 'builtin';
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  policyActionPattern: string;
  endpoint: Record<string, unknown>;
  status: 'pending' | 'verified' | 'disabled';
  verifiedAt: string | null;
}

export interface ToolRegistryPort {
  list(): Promise<ToolDefinitionRecord[]>;
  verifyLocalMcp(): Promise<ToolDefinitionRecord>;
  createExternalSendDraft(input: ExternalSendDraftRequest): Promise<ExternalSendDraftResult>;
}

export interface ExternalSendDraftRequest {
  sessionId: string;
  approvalId: string;
  requestedBy: string;
  relativePath: string;
  content: string;
  occurredAt: string;
  idempotencyKey: string;
}

export interface ExternalSendDraftResult {
  id: string;
  action: string;
  relativePath: string;
  evidenceRef: string;
  sha256: string;
  sizeBytes: number;
}

interface DesktopToolRegistryHost {
  list(token: string): Promise<ToolDefinitionRecord[]>;
  verifyLocalMcp(token: string): Promise<ToolDefinitionRecord>;
  createExternalSendDraft(request: { token: string; input: ExternalSendDraftRequest }): Promise<ExternalSendDraftResult>;
}

declare global { interface Window { hummerToolRegistry?: DesktopToolRegistryHost } }

export function desktopToolRegistryPort(): ToolRegistryPort | undefined {
  if (typeof window === 'undefined' || !window.hummerToolRegistry) return undefined;
  const host = window.hummerToolRegistry;
  return {
    list: () => host.list(requireToken()),
    verifyLocalMcp: () => host.verifyLocalMcp(requireToken()),
    createExternalSendDraft: (input) => host.createExternalSendDraft({ token: requireToken(), input }),
  };
}

function requireToken(): string {
  const token = currentSessionToken();
  if (!token) throw new Error('Tool registry requires an authenticated account');
  return token;
}
