import { describe, expect, it } from 'vitest';
import { approvalResult, textInput, translateAppServerMessage } from './app-server-protocol.js';

describe('Codex app-server protocol boundary', () => {
  it('translates v2 item notifications to the exec JSONL shape consumed by the existing adapter', () => {
    expect(translateAppServerMessage({ method: 'item/completed', params: { item: { type: 'commandExecution', id: 'cmd-1', command: 'Get-Content input.txt', cwd: 'C:/work', status: 'completed', aggregatedOutput: 'ok', durationMs: 21 } } })).toEqual([{
      type: 'item.completed',
      item: { type: 'command_execution', id: 'cmd-1', command: 'Get-Content input.txt', cwd: 'C:/work', status: 'completed', aggregated_output: 'ok', duration_ms: 21 },
    }]);
    expect(translateAppServerMessage({ method: 'item/completed', params: { item: { type: 'fileChange', id: 'patch-1', status: 'completed', changes: [{ path: 'summary.md' }] } } })).toEqual([{
      type: 'item.completed',
      item: { type: 'file_change', id: 'patch-1', status: 'completed', changes: [{ path: 'summary.md' }] },
    }]);
  });

  it('normalizes approval requests and client responses without importing generated Codex types', () => {
    expect(translateAppServerMessage({ id: 9, method: 'item/fileChange/requestApproval', params: { itemId: 'patch-1', reason: 'write required' } })).toEqual([{
      id: 9,
      method: 'item/commandExecution/requestApproval',
      params: { itemId: 'patch-1', reason: 'write required', kind: 'fileChange' },
    }]);
    expect(approvalResult(true)).toEqual({ decision: 'accept' });
    expect(approvalResult(false)).toEqual({ decision: 'decline' });
    expect(textInput('continue')).toEqual([{ type: 'text', text: 'continue', text_elements: [] }]);
  });

  it('maps the versioned app-server token-usage notification to a neutral message', () => {
    expect(translateAppServerMessage({
      method: 'thread/tokenUsage/updated',
      params: { tokenUsage: { last: { totalTokens: 12, inputTokens: 8, cachedInputTokens: 2, cacheWriteInputTokens: 0, outputTokens: 4, reasoningOutputTokens: 1 } } },
    })).toEqual([{
      type: 'usage.updated',
      usage: { totalTokens: 12, inputTokens: 8, cachedInputTokens: 2, cacheWriteInputTokens: 0, outputTokens: 4, reasoningOutputTokens: 1 },
    }]);
  });
});
