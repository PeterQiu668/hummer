import { FleetRejectedError } from './ports.js';

export function canonicalUtcTimestamp(value: string, subject: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new FleetRejectedError('invalid_contract', `${subject} must be a valid timestamp`);
  }
  return new Date(timestamp).toISOString();
}

export function assertEventWithinLease(
  occurredAt: string,
  receivedAt: string,
  leaseExpiresAt: string,
  leaseMs: number,
): void {
  const occurredAtMs = Date.parse(occurredAt);
  const receivedAtMs = Date.parse(receivedAt);
  const leaseExpiresAtMs = Date.parse(leaseExpiresAt);
  const leaseStartedAtMs = leaseExpiresAtMs - leaseMs;
  if (!Number.isFinite(occurredAtMs)
    || occurredAtMs < leaseStartedAtMs
    || occurredAtMs > receivedAtMs) {
    throw new FleetRejectedError(
      'invalid_transition',
      'run event time is outside the current task lease window',
    );
  }
}
