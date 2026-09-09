import { describe, expect, it } from 'vitest';
import { calculateOutcomeCostCny } from './deepseek-pricing.js';

const usage = { inputTokens: 1_000_000, cachedInputTokens: 200_000, outputTokens: 100_000 };

describe('calculateOutcomeCostCny', () => {
  it('computes the off-peak CNY cost for deepseek-v4-flash using the verified price table', () => {
    // Sunday is never a peak weekday in the configured schedule, so this always exercises the base band.
    const priced = calculateOutcomeCostCny('deepseek-v4-flash', usage, new Date('2026-08-30T03:00:00.000Z'));
    // (800_000 * 1.5 + 200_000 * 0.05 + 100_000 * 4.5) / 1_000_000
    expect(priced.costCny).toBeCloseTo(1.66, 6);
    expect(priced.pricingSource).toBe('https://api-docs.deepseek.com/zh-cn/quick_start/pricing/');
    expect(priced.pricingVerifiedAt).toBe('2026-08-29');
  });

  it('applies the peak band on a configured weekday window in Asia/Shanghai', () => {
    // 2026-09-02 is a Wednesday; 10:00 Asia/Shanghai falls inside the 09:00-12:00 peak window.
    const peakAt = new Date('2026-09-02T02:00:00.000Z');
    const offPeakAt = new Date('2026-09-02T21:00:00.000Z'); // 05:00 next day Asia/Shanghai, off-peak
    const peak = calculateOutcomeCostCny('deepseek-v4-flash', usage, peakAt);
    const offPeak = calculateOutcomeCostCny('deepseek-v4-flash', usage, offPeakAt);
    expect(peak.costCny).toBeGreaterThan(offPeak.costCny);
    // (800_000 * 3 + 200_000 * 0.1 + 100_000 * 9) / 1_000_000
    expect(peak.costCny).toBeCloseTo(3.32, 6);
  });

  it('fails closed for a model with no verified price rather than inventing a cost', () => {
    expect(() => calculateOutcomeCostCny('glm-5.2', usage, new Date())).toThrow(/No verified CNY price/);
  });

  it('rejects negative or inconsistent usage', () => {
    expect(() => calculateOutcomeCostCny('deepseek-v4-flash', { inputTokens: -1, cachedInputTokens: 0, outputTokens: 0 }, new Date())).toThrow(TypeError);
    expect(() => calculateOutcomeCostCny('deepseek-v4-flash', { inputTokens: 10, cachedInputTokens: 20, outputTokens: 0 }, new Date())).toThrow(/cachedInputTokens cannot exceed/);
  });
});
