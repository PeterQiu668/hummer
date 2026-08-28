import { describe, expect, it } from 'vitest';
import { draftPlanFromPrompt } from '../model/session';
import type { RuntimeAdapter, RuntimeHandle } from './adapter';
import { FailoverRuntimeAdapter } from './failoverRuntimeAdapter';
import { MockRuntimeAdapter } from './mockRuntimeAdapter';

describe('FailoverRuntimeAdapter', () => {
  it('falls back explicitly when the primary runtime cannot start', async () => {
    const primary = failingRuntime('Codex CLI is unavailable');
    const fallback = new MockRuntimeAdapter({ stepDelayMs: 1 });
    const runtime = new FailoverRuntimeAdapter(primary, fallback);

    expect(runtime.id).toBe('codex-cli');

    const handle = await runtime.startSession(draftPlanFromPrompt('整理本周线索'));

    expect(handle.runtimeId).toBe('mock-runtime-v4');
    expect(runtime.id).toBe('mock-runtime-v4');
    expect(runtime.fallbackReason).toBe('Codex CLI is unavailable');
  });
});

function failingRuntime(message: string): RuntimeAdapter {
  const unsupported = async (): Promise<void> => {
    throw new Error('not reached');
  };
  return {
    id: 'codex-cli',
    startSession: async (): Promise<RuntimeHandle> => {
      throw new Error(message);
    },
    subscribe: () => () => undefined,
    respondToApproval: unsupported,
    sendHumanMessage: unsupported,
    pause: unsupported,
    resume: unsupported,
    stop: unsupported,
    forkFromCheckpoint: async () => {
      throw new Error('not reached');
    },
  };
}
