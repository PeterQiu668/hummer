import { describe, expect, it } from 'vitest';
import { JsonLineDecoder } from './jsonl.js';

describe('JsonLineDecoder', () => {
  it('decodes complete JSON values across arbitrary stdout chunks', () => {
    const decoder = new JsonLineDecoder();
    expect(decoder.push('{"type":"thread.started","thread_id":"t1"}\n{"type":"item.')).toEqual([
      { type: 'thread.started', thread_id: 't1' },
    ]);
    expect(decoder.push('completed","item":{"type":"command_execution"}}\n')).toEqual([
      { type: 'item.completed', item: { type: 'command_execution' } },
    ]);
    expect(decoder.finish()).toEqual([]);
  });

  it('reports a malformed complete line instead of inventing an event', () => {
    const decoder = new JsonLineDecoder();
    expect(() => decoder.push('not-json\n')).toThrow(/Invalid Codex JSONL/);
  });
});
