import pricingConfig from '../config/deepseek-pricing.json' with { type: 'json' };

export interface RuntimeUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

export interface PricedCost {
  costCny: number;
  pricingSource: string;
  pricingVerifiedAt: string;
}

interface PriceBand {
  inputCnyPerMillion: number;
  cachedInputCnyPerMillion: number;
  outputCnyPerMillion: number;
}

interface PricedModel extends PriceBand {
  peak?: PriceBand;
  peakSchedule?: {
    timeZone: 'Asia/Shanghai';
    weekdays: number[];
    windows: string[][];
  };
}

const models = pricingConfig.models as Record<string, PricedModel>;

/**
 * Computes a verified CNY cost for one unit of runtime token usage. Fails closed: if no verified
 * price exists for the model, this throws rather than inventing a number. The outcome ledger must
 * never record a fabricated cost (see docs/decisions/ADR-004-m5a-outcome-ledger.md).
 */
export function calculateOutcomeCostCny(model: string, usage: RuntimeUsage, occurredAt: Date | string): PricedCost {
  const configured = models[model];
  if (!configured) {
    throw new Error(`No verified CNY price is configured for model "${model}"; the outcome cost cannot be recorded.`);
  }
  assertNonNegativeUsage(usage);
  const at = typeof occurredAt === 'string' ? new Date(occurredAt) : occurredAt;
  if (Number.isNaN(at.getTime())) throw new TypeError('occurredAt must be a valid date');

  const price = configured.peak && configured.peakSchedule && isPeakTime(at, configured.peakSchedule)
    ? configured.peak
    : configured;
  const uncachedInput = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
  const rawCost = (
    uncachedInput * price.inputCnyPerMillion
    + usage.cachedInputTokens * price.cachedInputCnyPerMillion
    + usage.outputTokens * price.outputCnyPerMillion
  ) / 1_000_000;

  return {
    costCny: Math.round(rawCost * 1_000_000) / 1_000_000,
    pricingSource: pricingConfig.sourceUrl,
    pricingVerifiedAt: pricingConfig.verifiedAt,
  };
}

function assertNonNegativeUsage(usage: RuntimeUsage): void {
  for (const [key, value] of Object.entries(usage)) {
    if (!Number.isFinite(value) || value < 0) throw new TypeError(`Runtime usage field "${key}" must be a non-negative finite number`);
  }
  if (usage.cachedInputTokens > usage.inputTokens) throw new TypeError('cachedInputTokens cannot exceed inputTokens');
}

function isPeakTime(date: Date, schedule: NonNullable<PricedModel['peakSchedule']>): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: schedule.timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(value('weekday'));
  if (!schedule.weekdays.includes(weekday)) return false;
  const minuteOfDay = Number(value('hour')) * 60 + Number(value('minute'));
  return schedule.windows.some(([start, end]) => (
    typeof start === 'string'
    && typeof end === 'string'
    && minuteOfDay >= clockMinutes(start)
    && minuteOfDay < clockMinutes(end)
  ));
}

function clockMinutes(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}
