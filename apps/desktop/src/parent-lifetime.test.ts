import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { bindParentStdinLifetime } from './parent-lifetime.js';

class FakeStdin extends EventEmitter {
  readonly resume = vi.fn();
}

describe('parent stdin lifetime', () => {
  it('is inert unless explicitly enabled', () => {
    const input = new FakeStdin();
    const quit = vi.fn();
    expect(bindParentStdinLifetime({}, input, quit)).toBe(false);
    input.emit('end');
    expect(input.resume).not.toHaveBeenCalled();
    expect(quit).not.toHaveBeenCalled();
  });

  it('consumes the opt-in and quits when the supervisor closes stdin', () => {
    const environment = { HUMMER_EXIT_ON_STDIN_END: '1' };
    const input = new FakeStdin();
    const quit = vi.fn();
    expect(bindParentStdinLifetime(environment, input, quit)).toBe(true);
    expect(environment.HUMMER_EXIT_ON_STDIN_END).toBeUndefined();
    expect(input.resume).toHaveBeenCalledOnce();
    input.emit('end');
    expect(quit).toHaveBeenCalledOnce();
  });
});
