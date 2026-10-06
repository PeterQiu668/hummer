import { canonicalJson, sha256Hex, type JsonValue } from './canonical-json.js';

export interface TenantChainEventMaterial {
  id: string;
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  type: string;
  occurredAt: string;
  actorRef: string;
  correlationId: string;
  payload: JsonValue;
}

export function computeTenantEventHash(
  event: TenantChainEventMaterial,
  tenantPosition: number,
  tenantPreviousHash: string | null,
): string {
  return sha256Hex(canonicalJson({
    actorRef: event.actorRef,
    aggregateId: event.aggregateId,
    aggregateType: event.aggregateType,
    aggregateVersion: event.aggregateVersion,
    correlationId: event.correlationId,
    id: event.id,
    occurredAt: event.occurredAt,
    payload: event.payload,
    tenantId: event.tenantId,
    tenantPosition,
    tenantPreviousHash,
    type: event.type,
  }));
}
