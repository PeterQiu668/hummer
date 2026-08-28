import { describe, expect, it } from 'vitest';
import { calculateRuntimeCostCny } from './pricing';

describe('runtime token pricing', () => {
  it('calculates CNY only from an explicitly configured model price', () => {
    const usage = { inputTokens: 1_000_000, cachedInputTokens: 200_000, outputTokens: 100_000, totalTokens: 1_100_000 };
    const pricing = {
      currency: 'CNY' as const,
      models: {
        'verified-model': { inputCnyPerMillion: 10, cachedInputCnyPerMillion: 2, outputCnyPerMillion: 30 },
      },
    };

    expect(calculateRuntimeCostCny('verified-model', usage, pricing)).toBe(11.4);
    expect(calculateRuntimeCostCny('unknown-model', usage, pricing)).toBeNull();
    expect(calculateRuntimeCostCny(undefined, usage, pricing)).toBeNull();
  });
});
