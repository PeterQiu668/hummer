import { describe, expect, it } from 'vitest';
import { draftPlanFromPrompt } from '../model/session';
import type { RuntimeEvent } from './adapter';
import {
  buildClaudeInvocation,
  ClaudeRuntimeAdapter,
  mapClaudeMessage,
  type ClaudeCliHost,
} from './claudeRuntimeAdapter';

describe('ClaudeRuntimeAdapter', () => {
  it('uses Claude Code stream JSON with manual permission handling', () => {
    const invocation = buildClaudeInvocation(draftPlanFromPrompt('读取 input.txt 后写 summary.md'));
    expect(invocation.command).toBe('claude');
    expect(invocation.args).toEqual(expect.arrayContaining([
      '--print',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--permission-mode', 'manual',
    ]));
    expect(invocation.args).not.toContain('--dangerously-skip-permissions');
  });

  it('maps Claude tool and result messages to neutral runtime events', () => {
    expect(mapClaudeMessage({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: 'input.txt' } }] },
    })[0]).toMatchObject({ type: 'tool', tool: 'claude.Read', actorRef: 'employee:claude' });
    expect(mapClaudeMessage({ type: 'result', subtype: 'success', result: 'done', session_id: 'session-1' })[0])
      .toMatchObject({ type: 'result', summary: 'done', actorRef: 'employee:claude' });
  });

  it('does not report Claude authentication failures as successful results', () => {
    expect(mapClaudeMessage({
      type: 'result', subtype: 'success', is_error: true,
      terminal_reason: 'api_error', result: 'Not logged in',
    })[0]).toMatchObject({ type: 'status', status: 'blocked', reason: 'Not logged in' });
  });

  it('implements the RuntimeAdapter boundary independently from Codex', async () => {
    let publish: ((message: unknown) => void) | undefined;
    const host: ClaudeCliHost = {
      start: async () => ({ processId: 'claude-process-1' }),
      subscribe: (_run, callback) => { publish = callback; return () => undefined; },
      respondToApproval: async () => undefined,
      sendHumanMessage: async () => undefined,
      stop: async () => undefined,
    };
    const runtime = new ClaudeRuntimeAdapter({ enabled: true, host });
    const handle = await runtime.startSession(draftPlanFromPrompt('做一份摘要'));
    const events: RuntimeEvent[] = [];
    runtime.subscribe(handle, (event) => events.push(event));

    publish?.({ type: 'result', subtype: 'success', result: 'summary ready', session_id: 'claude-session-1' });

    expect(handle.runtimeId).toBe('claude-code');
    expect(events[0]).toMatchObject({ type: 'result', summary: 'summary ready' });
  });
});
