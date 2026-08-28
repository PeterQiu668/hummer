import { describe, expect, it } from 'vitest';
import { draftPlanFromPrompt } from '../model/session';
import type { RuntimeEvent } from './adapter';
import { buildCodexInvocation, CodexRuntimeAdapter, extractCodexThreadId, extractCodexUsage, mapCodexMessage, type CodexCliHost } from './codexRuntimeAdapter';

describe('CodexRuntimeAdapter mapping skeleton', () => {
  it('builds the verified exec JSONL invocation without granting unrestricted access', () => {
    const invocation = buildCodexInvocation(draftPlanFromPrompt('读取 README 并总结', { approvalMode: 'L1' }));

    expect(invocation.command).toBe('codex');
    expect(invocation.args).toEqual(['exec', '--json', '--sandbox', 'read-only', '-']);
    expect(invocation.engineProfileId).toBe('deepseek-standard');
    expect(invocation.stdin).toContain('读取 README 并总结');
    expect(invocation.args).not.toContain('danger-full-access');
  });

  it('maps user-facing quality tiers to internal engine profile ids', () => {
    const plan = draftPlanFromPrompt('complex analysis', { modelProfile: '\u65d7\u8230' });
    expect(buildCodexInvocation(plan).engineProfileId).toBe('openai-flagship');
  });

  it('maps completed command and approval messages without importing Codex types', () => {
    const tool = mapCodexMessage({
      type: 'item.completed',
      item: { id: 'item_1', type: 'command_execution', command: 'Get-Content README.md', status: 'completed', aggregated_output: 'summary input' },
    });
    expect(tool[0]).toMatchObject({
      type: 'tool',
      tool: 'shell.command',
      result: 'summary input',
      durationMs: null,
      costCny: null,
    });

    const approval = mapCodexMessage({
      id: 42,
      method: 'item/commandExecution/requestApproval',
      params: { itemId: 'item_2', reason: 'needs write access', kind: 'command' },
    });
    expect(approval[0]).toMatchObject({
      type: 'approval_required',
      approvalId: '42',
      actorRef: 'employee:codex',
    });
  });

  it('extracts the native thread id without leaking the Codex event type', () => {
    expect(extractCodexThreadId('{"type":"thread.started","thread_id":"thread_123"}')).toBe('thread_123');
    expect(extractCodexThreadId({ type: 'turn.started', thread_id: 'thread_ignored' })).toBeUndefined();
  });

  it('surfaces desktop-host stderr as a diagnostic trajectory step', () => {
    expect(mapCodexMessage({ type: 'host.stderr', line: 'app-server rejected response' })[0]).toMatchObject({
      type: 'step',
      category: 'system',
      title: 'Runtime 诊断',
      result: 'app-server rejected response',
    });
  });

  it('records the human approval decision before the runtime continues', async () => {
    let onMessage: ((message: unknown) => void) | undefined;
    const host: CodexCliHost = {
      start: async () => ({ processId: 'process-1' }),
      subscribe: (_run, callback) => { onMessage = callback; return () => undefined; },
      respondToApproval: async () => undefined,
      stop: async () => undefined,
    };
    const runtime = new CodexRuntimeAdapter({ enabled: true, host, protocol: 'app-server-jsonrpc' });
    const handle = await runtime.startSession(draftPlanFromPrompt('审批后继续'));
    const events: RuntimeEvent[] = [];
    runtime.subscribe(handle, (event) => events.push(event));

    onMessage?.({ id: 7, method: 'item/commandExecution/requestApproval', params: { reason: 'write required' } });
    await runtime.respondToApproval(handle, '7', true);

    expect(events.map((event) => event.type)).toEqual(['approval_required', 'approval_resolved']);
    expect(events[1]).toMatchObject({ actorRef: 'human:operator', approved: true });
  });

  it('records a successful human steer in the same trajectory', async () => {
    const host: CodexCliHost = {
      start: async () => ({ processId: 'process-1' }),
      subscribe: () => () => undefined,
      sendHumanMessage: async () => undefined,
      stop: async () => undefined,
    };
    const runtime = new CodexRuntimeAdapter({ enabled: true, host, protocol: 'app-server-jsonrpc' });
    const handle = await runtime.startSession(draftPlanFromPrompt('等待插话'));
    const events: RuntimeEvent[] = [];
    runtime.subscribe(handle, (event) => events.push(event));

    await runtime.sendHumanMessage(handle, '改为只生成 steered-summary.md');

    expect(events[0]).toMatchObject({
      type: 'step',
      category: 'message',
      actorRef: 'human:operator',
      title: '你补充了要求',
      result: '改为只生成 steered-summary.md',
    });
  });

  it('extracts real token usage without inventing a price', () => {
    const usage = extractCodexUsage({
      type: 'usage.updated',
      usage: { totalTokens: 120, inputTokens: 80, cachedInputTokens: 20, cacheWriteInputTokens: 0, outputTokens: 40, reasoningOutputTokens: 10 },
    });
    expect(usage).toEqual({ totalTokens: 120, inputTokens: 80, cachedInputTokens: 20, cacheWriteInputTokens: 0, outputTokens: 40, reasoningOutputTokens: 10 });

    expect(mapCodexMessage({ type: 'turn.completed' }, 'done', { usage, durationMs: 1234 })[0]).toMatchObject({
      type: 'result',
      durationMs: 1234,
      costCny: null,
      usage,
    });
  });
});
