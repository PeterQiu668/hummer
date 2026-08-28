export type RuntimeConnectorStatus = 'starting' | 'connected' | 'failed';

export interface RuntimeConnectorRecord {
  id: string;
  runtimeId: string;
  technicalName: string;
  transport: 'mcp';
  status: RuntimeConnectorStatus;
  checkedAt: string;
  sessionId: string | null;
  error: string | null;
}

const records = new Map<string, RuntimeConnectorRecord>();

export function recordMcpStartupStatus(message: unknown, occurredAt = new Date().toISOString()): RuntimeConnectorRecord | undefined {
  if (!isRecord(message) || message.method !== 'mcpServer/startupStatus/updated' || !isRecord(message.params)) return undefined;
  const name = typeof message.params.name === 'string' ? message.params.name : '';
  const nativeStatus = typeof message.params.status === 'string' ? message.params.status : '';
  if (!name || !['starting', 'ready', 'failed'].includes(nativeStatus)) return undefined;
  const record: RuntimeConnectorRecord = {
    id: name,
    runtimeId: 'codex-cli',
    technicalName: name,
    transport: 'mcp',
    status: nativeStatus === 'ready' ? 'connected' : nativeStatus as 'starting' | 'failed',
    checkedAt: occurredAt,
    sessionId: typeof message.params.threadId === 'string' ? message.params.threadId : null,
    error: typeof message.params.error === 'string'
      ? message.params.error
      : typeof message.params.failureReason === 'string' ? message.params.failureReason : null,
  };
  records.set(record.id, record);
  return record;
}

export function listRuntimeConnectors(): RuntimeConnectorRecord[] {
  return [...records.values()].sort((left, right) => left.technicalName.localeCompare(right.technicalName));
}

export function clearRuntimeConnectors(): void {
  records.clear();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
