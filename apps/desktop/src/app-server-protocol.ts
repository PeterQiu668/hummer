export function textInput(text: string): Array<{ type: 'text'; text: string; text_elements: [] }> {
  return [{ type: 'text', text, text_elements: [] }];
}

export function approvalResult(approved: boolean): { decision: 'accept' | 'decline' } {
  return { decision: approved ? 'accept' : 'decline' };
}

export function mcpElicitationResult(approved: boolean):
  | { action: 'accept'; content: Record<string, never> }
  | { action: 'decline'; content: null } {
  return approved ? { action: 'accept', content: {} } : { action: 'decline', content: null };
}

export interface ScopedApprovalRequest {
  approvalId: string;
  requestId: string | number;
  message: Record<string, unknown>;
}

export function scopeAppServerApproval(message: unknown, scope: string): ScopedApprovalRequest | undefined {
  if (!isRecord(message)) return undefined;
  const method = stringValue(message.method);
  if (method !== 'item/commandExecution/requestApproval' && method !== 'item/fileChange/requestApproval') return undefined;
  if (message.id === undefined || (typeof message.id !== 'string' && typeof message.id !== 'number')) return undefined;
  const params = isRecord(message.params) ? message.params : {};
  const localApprovalId = stringValue(params.approvalId) || String(message.id);
  const approvalId = scope + ':' + localApprovalId;
  return {
    approvalId,
    requestId: message.id,
    message: {
      ...message,
      params: { ...params, approvalId },
    },
  };
}

export function translateAppServerMessage(message: unknown): unknown[] {
  if (!isRecord(message)) return [];
  const method = stringValue(message.method);
  const params = isRecord(message.params) ? message.params : {};

  if (method === 'thread/started' && isRecord(params.thread)) {
    return [{ type: 'thread.started', thread_id: stringValue(params.thread.id) }];
  }
  if (method === 'turn/started') return [{ type: 'turn.started', turn_id: nestedString(params, 'turn', 'id') }];
  if (method === 'turn/completed') {
    const turn = isRecord(params.turn) ? params.turn : {};
    if (turn.status === 'failed' || turn.status === 'interrupted') {
      return [{ type: 'turn.failed', turn_id: stringValue(turn.id), error: { message: turn.status === 'interrupted' ? 'Codex turn was interrupted.' : errorMessage(turn.error) } }];
    }
    return [{ type: 'turn.completed', turn_id: stringValue(turn.id) }];
  }
  if (method === 'thread/tokenUsage/updated') {
    const tokenUsage = isRecord(params.tokenUsage) ? params.tokenUsage : {};
    return isRecord(tokenUsage.last) ? [{ type: 'usage.updated', usage: tokenUsage.last }] : [];
  }
  if (method === 'item/completed' && isRecord(params.item)) {
    const item = normalizeItem(params.item);
    return item ? [{ type: 'item.completed', item }] : [];
  }
  if (method === 'item/fileChange/requestApproval') {
    return [{ ...message, method: 'item/commandExecution/requestApproval', params: { ...params, kind: 'fileChange' } }];
  }
  if (method === 'item/commandExecution/requestApproval') return [message];
  return [];
}

function normalizeItem(item: Record<string, unknown>): Record<string, unknown> | undefined {
  const type = stringValue(item.type);
  if (type === 'agentMessage') return { type: 'agent_message', id: item.id, text: item.text };
  if (type === 'commandExecution') return {
    type: 'command_execution',
    id: item.id,
    command: item.command,
    cwd: item.cwd,
    status: item.status,
    aggregated_output: item.aggregatedOutput,
    duration_ms: item.durationMs,
  };
  if (type === 'fileChange') return { type: 'file_change', id: item.id, status: item.status, changes: item.changes };
  if (type === 'mcpToolCall') return {
    type: 'mcp_tool_call',
    id: item.id,
    server: item.server,
    tool: item.tool,
    status: item.status,
    arguments: item.arguments,
    result: item.result,
    error: item.error,
    duration_ms: item.durationMs,
  };
  return undefined;
}

function errorMessage(value: unknown): string {
  return isRecord(value) && typeof value.message === 'string' ? value.message : 'Codex turn failed.';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);

}
function nestedString(value: unknown, ...path: string[]): string {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) return '';
    current = current[key];
  }
  return stringValue(current);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
