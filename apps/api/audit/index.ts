export type AuditEventType =
  | 'work_order.created'
  | 'work_order.submitted'
  | 'work_order.assigned'
  | 'work_order.planned'
  | 'work_order.started'
  | 'approval.requested'
  | 'approval.decided'
  | 'tool.invoked'
  | 'evidence.recorded'
  | 'result_package.created'
  | 'result_package.accepted'
  | 'result_package.rejected'
  | 'work_order.failed'
  | 'work_order.cancelled'
  | 'work_order.archived';

export interface DomainEvent<T extends Record<string, unknown> = Record<string, unknown>> {
  readonly id: string;
  readonly tenantId: string;
  readonly sequence: number;
  readonly type: AuditEventType;
  readonly occurredAt: string;
  readonly actorRef: string;
  readonly subjectRef: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly previousEventHash?: string;
  readonly eventHash: string;
  readonly data: Readonly<T>;
}

export interface EventAppendInput<T extends Record<string, unknown> = Record<string, unknown>> {
  tenantId: string;
  subjectRef: string;
  type: AuditEventType;
  actorRef: string;
  correlationId: string;
  occurredAt: string;
  data: T;
  causationId?: string;
}

export interface EventStore {
  append<T extends Record<string, unknown>>(input: EventAppendInput<T>): Promise<DomainEvent<T>>;
  list(subjectRef: string, tenantId: string): readonly DomainEvent[];
  rebuild<T>(subjectRef: string, tenantId: string, reducer: (state: T | undefined, event: DomainEvent) => T): T | undefined;
}

const SENSITIVE_KEY = /(secret|token|password|credential|authorization|api[-_]?key|customer|pii|raw)/i;

export class InMemoryEventStore implements EventStore {
  private readonly eventsBySubject = new Map<string, DomainEvent[]>();
  private readonly counters = new Map<string, number>();
  private readonly lastHashes = new Map<string, string>();
  private nextId = 1;

  async append<T extends Record<string, unknown>>(input: EventAppendInput<T>): Promise<DomainEvent<T>> {
    const key = `${input.tenantId}:${input.subjectRef}`;
    const sequence = (this.counters.get(key) ?? 0) + 1;
    const previousEventHash = this.lastHashes.get(key);
    const data = deepFreeze(redactPayload(input.data)) as Readonly<T>;
    const hashInput = canonicalize({
      tenantId: input.tenantId,
      sequence,
      type: input.type,
      occurredAt: input.occurredAt,
      actorRef: input.actorRef,
      subjectRef: input.subjectRef,
      correlationId: input.correlationId,
      causationId: input.causationId,
      previousEventHash,
      data,
    });
    const event: DomainEvent<T> = deepFreeze({
      id: `evt_${String(this.nextId++).padStart(8, '0')}`,
      tenantId: input.tenantId,
      sequence,
      type: input.type,
      occurredAt: input.occurredAt,
      actorRef: input.actorRef,
      subjectRef: input.subjectRef,
      correlationId: input.correlationId,
      ...(input.causationId ? { causationId: input.causationId } : {}),
      ...(previousEventHash ? { previousEventHash } : {}),
      eventHash: await sha256(hashInput),
      data,
    });
    const events = this.eventsBySubject.get(key) ?? [];
    events.push(event);
    this.eventsBySubject.set(key, events);
    this.counters.set(key, sequence);
    this.lastHashes.set(key, event.eventHash);
    return event;
  }

  list(subjectRef: string, tenantId: string): readonly DomainEvent[] {
    return [...(this.eventsBySubject.get(`${tenantId}:${subjectRef}`) ?? [])];
  }

  rebuild<T>(subjectRef: string, tenantId: string, reducer: (state: T | undefined, event: DomainEvent) => T): T | undefined {
    return this.list(subjectRef, tenantId).reduce<T | undefined>(reducer, undefined);
  }
}

export function redactPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactPayload);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactPayload(nested)]));
  }
  return value;
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => `${JSON.stringify(key)}:${canonicalize(nested)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}
