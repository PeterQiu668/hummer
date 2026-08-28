import type { RuntimeTokenUsage } from './adapter';

export interface RuntimePricing {
  currency: 'CNY';
  models: Record<string, {
    inputCnyPerMillion: number;
    cachedInputCnyPerMillion: number;
    outputCnyPerMillion: number;
  }>;
}

export function calculateRuntimeCostCny(model: string | undefined, usage: RuntimeTokenUsage, pricing: RuntimePricing): number | null {
  if (!model) return null;
  const price = pricing.models[model];
  if (!price) return null;
  const uncachedInput = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
  const cost = (
    uncachedInput * price.inputCnyPerMillion
    + usage.cachedInputTokens * price.cachedInputCnyPerMillion
    + usage.outputTokens * price.outputCnyPerMillion
  ) / 1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
