import { randomUUID } from 'node:crypto';
import catalog from '../config/tool-definitions.json' with { type: 'json' };
import { canonicalJson, type JsonValue } from './canonical-json.js';
import { DomainEventStore } from './domain-event-store.js';
import type { SqliteDatabase } from './sqlite.js';

export type ToolTransport = 'mcp' | 'builtin';
export type ToolRiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type ToolDefinitionStatus = 'pending' | 'verified' | 'disabled';
export type ToolInvocationStatus = 'completed' | 'failed' | 'declined';

export interface ToolDefinitionRecord {
  id: string;
  tenantId: string;
  capabilityId: string;
  displayName: string;
  transport: ToolTransport;
  riskLevel: ToolRiskLevel;
  policyActionPattern: string;
  endpoint: Record<string, JsonValue>;
  status: ToolDefinitionStatus;
  verifiedAt: string | null;
}

export interface RecordToolInvocationInput {
  tenantId: string;
  sessionId: string;
  capabilityId: string;
  actorRef: string;
  status: ToolInvocationStatus;
  args: JsonValue;
  result: JsonValue;
  durationMs: number | null;
  evidenceRefs: string[];
  occurredAt: string;
  idempotencyKey: string;
}

export interface ToolInvocationRecord extends RecordToolInvocationInput {
  id: string;
  toolDefinitionId: string;
}

interface CatalogDefinition {
  id: string;
  capabilityId: string;
  displayName: string;
  transport: ToolTransport;
  riskLevel: ToolRiskLevel;
  policyActionPattern: string;
  enabled: boolean;
  endpoint: Record<string, JsonValue>;
}

interface DefinitionRow {
  id: string; tenant_id: string; capability_id: string; display_name: string; transport: ToolTransport;
  risk_level: ToolRiskLevel; policy_action_pattern: string; endpoint_config_json: string;
  status: ToolDefinitionStatus; verified_at: string | null;
}

interface InvocationRow {
  id: string; tenant_id: string; session_id: string; tool_definition_id: string; capability_id: string;
  actor_ref: string; status: ToolInvocationStatus; args_json: string; result_json: string;
  duration_ms: number | null; evidence_refs_json: string; occurred_at: string; idempotency_key: string;
}

const definitions = catalog.definitions.map(validateCatalogDefinition);

export class ToolRegistryStore {
  private readonly events: DomainEventStore;

  constructor(private readonly database: SqliteDatabase) {
    this.events = new DomainEventStore(database);
  }

  ensureDefaults(tenantId: string, actorRef: string): void {
    const now = new Date().toISOString();
    const insert = this.database.prepare(`
      INSERT OR IGNORE INTO tool_definitions
        (id, tenant_id, capability_id, display_name, transport, risk_level, policy_action_pattern,
         endpoint_config_json, status, verified_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
    `);
    const run = this.database.transaction(() => {
      for (const definition of definitions.filter((candidate) => candidate.enabled)) {
        const id = `${tenantId}_${definition.id}`;
        const result = insert.run(
          id, tenantId, definition.capabilityId, definition.displayName, definition.transport,
          definition.riskLevel, definition.policyActionPattern, canonicalJson(definition.endpoint),
          definition.transport === 'builtin' ? 'verified' : 'pending', now, now,
        );
        if (result.changes > 0) this.events.append({
          id: `evt_${randomUUID()}`,
          tenantId,
          aggregateType: 'tool_definition',
          aggregateId: id,
          type: 'tool.registered',
          occurredAt: now,
          actorRef,
          correlationId: `corr_${id}`,
          payload: { capabilityId: definition.capabilityId, riskLevel: definition.riskLevel, transport: definition.transport },
        });
      }
    });
    run();
  }

  listDefinitions(tenantId: string): ToolDefinitionRecord[] {
    return this.database.prepare(`
      SELECT id, tenant_id, capability_id, display_name, transport, risk_level,
             policy_action_pattern, endpoint_config_json, status, verified_at
      FROM tool_definitions WHERE tenant_id = ? ORDER BY capability_id
    `).all<DefinitionRow>(tenantId).map(mapDefinition);
  }

  recordConnectionStatus(input: {
    tenantId: string;
    capabilityId: string;
    connected: boolean;
    actorRef: string;
    occurredAt: string;
    error: string | null;
  }): ToolDefinitionRecord {
    const definition = this.listDefinitions(input.tenantId).find((candidate) => candidate.capabilityId === input.capabilityId);
    if (!definition) throw new Error(`Capability is not registered for this tenant: ${input.capabilityId}`);
    const status: ToolDefinitionStatus = input.connected ? 'verified' : 'pending';
    if (definition.status === status && (status !== 'verified' || definition.verifiedAt)) return definition;
    this.database.prepare(`
      UPDATE tool_definitions SET status = ?, verified_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ?
    `).run(status, input.connected ? input.occurredAt : null, input.occurredAt, definition.id, input.tenantId);
    this.events.append({
      id: `evt_${randomUUID()}`,
      tenantId: input.tenantId,
      aggregateType: 'tool_definition',
      aggregateId: definition.id,
      type: input.connected ? 'tool.connection_verified' : 'tool.connection_failed',
      occurredAt: input.occurredAt,
      actorRef: input.actorRef,
      correlationId: `corr_${definition.id}`,
      payload: { capabilityId: input.capabilityId, error: input.error, status },
    });
    return this.listDefinitions(input.tenantId).find((candidate) => candidate.id === definition.id)!;
  }

  assertCapabilities(tenantId: string, capabilityIds: readonly string[]): void {
    const available = new Set(this.listDefinitions(tenantId).filter((tool) => tool.status !== 'disabled').map((tool) => tool.capabilityId));
    const unknown = capabilityIds.find((capabilityId) => !available.has(capabilityId));
    if (unknown) throw new Error(`Capability is not registered for this tenant: ${unknown}`);
  }

  recordInvocation(input: RecordToolInvocationInput): ToolInvocationRecord {
    this.assertCapabilities(input.tenantId, [input.capabilityId]);
    const definition = this.listDefinitions(input.tenantId).find((candidate) => candidate.capabilityId === input.capabilityId);
    if (!definition) throw new Error(`Capability is not registered for this tenant: ${input.capabilityId}`);
    const existing = this.database.prepare('SELECT * FROM tool_invocations WHERE tenant_id = ? AND idempotency_key = ?')
      .get<InvocationRow>(input.tenantId, input.idempotencyKey);
    if (existing) return mapInvocation(existing);
    const id = `tool_inv_${randomUUID()}`;
    const transaction = this.database.transaction(() => {
      this.database.prepare(`
        INSERT INTO tool_invocations
          (id, tenant_id, session_id, tool_definition_id, capability_id, actor_ref, status,
           args_json, result_json, duration_ms, evidence_refs_json, occurred_at, idempotency_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, input.tenantId, input.sessionId, definition.id, input.capabilityId, input.actorRef, input.status,
        canonicalJson(input.args), canonicalJson(input.result), input.durationMs,
        canonicalJson(input.evidenceRefs), input.occurredAt, input.idempotencyKey,
      );
      this.events.append({
        id: `evt_${randomUUID()}`,
        tenantId: input.tenantId,
        aggregateType: 'tool_invocation',
        aggregateId: id,
        type: 'tool.invoked',
        occurredAt: input.occurredAt,
        actorRef: input.actorRef,
        correlationId: `corr_${input.sessionId}`,
        payload: {
          capabilityId: input.capabilityId,
          durationMs: input.durationMs,
          evidenceRefs: input.evidenceRefs,
          sessionId: input.sessionId,
          status: input.status,
        },
      });
    });
    transaction();
    return { id, toolDefinitionId: definition.id, ...input };
  }

  listInvocations(tenantId: string, sessionId: string): ToolInvocationRecord[] {
    return this.database.prepare(`
      SELECT * FROM tool_invocations WHERE tenant_id = ? AND session_id = ? ORDER BY occurred_at, id
    `).all<InvocationRow>(tenantId, sessionId).map(mapInvocation);
  }
}

function mapDefinition(row: DefinitionRow): ToolDefinitionRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    capabilityId: row.capability_id,
    displayName: row.display_name,
    transport: row.transport,
    riskLevel: row.risk_level,
    policyActionPattern: row.policy_action_pattern,
    endpoint: JSON.parse(row.endpoint_config_json) as Record<string, JsonValue>,
    status: row.status,
    verifiedAt: row.verified_at,
  };
}

function mapInvocation(row: InvocationRow): ToolInvocationRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    sessionId: row.session_id,
    toolDefinitionId: row.tool_definition_id,
    capabilityId: row.capability_id,
    actorRef: row.actor_ref,
    status: row.status,
    args: JSON.parse(row.args_json) as JsonValue,
    result: JSON.parse(row.result_json) as JsonValue,
    durationMs: row.duration_ms,
    evidenceRefs: JSON.parse(row.evidence_refs_json) as string[],
    occurredAt: row.occurred_at,
    idempotencyKey: row.idempotency_key,
  };
}

function validateCatalogDefinition(value: unknown): CatalogDefinition {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('Tool definition must be an object');
  const candidate = value as Record<string, unknown>;
  const transport = candidate.transport;
  const riskLevel = candidate.riskLevel;
  if (!['mcp', 'builtin'].includes(String(transport)) || !['low', 'medium', 'high', 'critical'].includes(String(riskLevel))) {
    throw new TypeError('Tool definition has an invalid transport or risk level');
  }
  const endpoint = JSON.parse(JSON.stringify(candidate.endpoint ?? {})) as JsonValue;
  if (typeof endpoint !== 'object' || endpoint === null || Array.isArray(endpoint)) throw new TypeError('Tool definition endpoint must be an object');
  for (const key of ['id', 'capabilityId', 'displayName', 'policyActionPattern'] as const) {
    if (typeof candidate[key] !== 'string' || !candidate[key]) throw new TypeError(`Tool definition ${key} is required`);
  }
  return {
    id: candidate.id as string,
    capabilityId: candidate.capabilityId as string,
    displayName: candidate.displayName as string,
    transport: transport as ToolTransport,
    riskLevel: riskLevel as ToolRiskLevel,
    policyActionPattern: candidate.policyActionPattern as string,
    enabled: candidate.enabled === true,
    endpoint: endpoint as Record<string, JsonValue>,
  };
}
