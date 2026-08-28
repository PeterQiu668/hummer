export function textInput(text: string): Array<{ type: 'text'; text: string; text_elements: [] }> {
  return [{ type: 'text', text, text_elements: [] }];
}

export function approvalResult(approved: boolean): { decision: 'accept' | 'decline' } {
  return { decision: approved ? 'accept' : 'decline' };
}

export function translateAppServerMessage(message: unknown): unknown[] {
  if (!isRecord(message)) return [];
  const method = stringValue(message.method);
  const params = isRecord(message.params) ? message.params : {};

  if (method === 'thread/started' && isRecord(params.thread)) {
    return [{ type: 'thread.started', thread_id: stringValue(params.thread.id) }];
  }
  if (method === 'turn/started') return [{ type: 'turn.started' }];
  if (method === 'turn/completed') {
    const turn = isRecord(params.turn) ? params.turn : {};
    if (turn.status === 'failed' || turn.status === 'interrupted') {
      return [{ type: 'turn.failed', error: { message: turn.status === 'interrupted' ? 'Codex turn was interrupted.' : errorMessage(turn.error) } }];
    }
    return [{ type: 'turn.completed' }];
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

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
