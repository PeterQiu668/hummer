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

  it('uses the configured Asia/Shanghai peak window without guessing', () => {
    const usage = { inputTokens: 1_000_000, cachedInputTokens: 200_000, outputTokens: 100_000, totalTokens: 1_100_000 };
    const pricing = {
      currency: 'CNY' as const,
      models: {
        'scheduled-model': {
          inputCnyPerMillion: 1.5,
          cachedInputCnyPerMillion: 0.05,
          outputCnyPerMillion: 4.5,
          peak: { inputCnyPerMillion: 3, cachedInputCnyPerMillion: 0.1, outputCnyPerMillion: 9 },
          peakSchedule: { timeZone: 'Asia/Shanghai' as const, weekdays: [1, 2, 3, 4, 5], windows: [['09:00', '12:00'], ['14:00', '18:00']] },
        },
      },
    };

    expect(calculateRuntimeCostCny('scheduled-model', usage, pricing, new Date('2026-08-28T02:00:00Z'))).toBe(3.32);
    expect(calculateRuntimeCostCny('scheduled-model', usage, pricing, new Date('2026-08-29T02:00:00Z'))).toBe(1.66);
  });
});
