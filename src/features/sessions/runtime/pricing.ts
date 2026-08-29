import type { RuntimeTokenUsage } from './adapter';

interface RuntimePriceBand {
  inputCnyPerMillion: number;
  cachedInputCnyPerMillion: number;
  outputCnyPerMillion: number;
}

export interface RuntimePricing {
  currency: 'CNY';
  models: Record<string, RuntimePriceBand & {
    peak?: RuntimePriceBand;
    peakSchedule?: {
      timeZone: 'Asia/Shanghai';
      weekdays: number[];
      windows: string[][];
    };
  }>;
}

export function calculateRuntimeCostCny(model: string | undefined, usage: RuntimeTokenUsage, pricing: RuntimePricing, occurredAt = new Date()): number | null {
  if (!model) return null;
  const configured = pricing.models[model];
  if (!configured) return null;
  const price = configured.peak && configured.peakSchedule && isPeakTime(occurredAt, configured.peakSchedule)
    ? configured.peak
    : configured;
  const uncachedInput = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
  const cost = (
    uncachedInput * price.inputCnyPerMillion
    + usage.cachedInputTokens * price.cachedInputCnyPerMillion
    + usage.outputTokens * price.outputCnyPerMillion
  ) / 1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

function isPeakTime(date: Date, schedule: NonNullable<RuntimePricing['models'][string]['peakSchedule']>): boolean {
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
