import { canonicalJson } from './canonical-json.js';
import type { SqliteDatabase } from './sqlite.js';

export interface ExecutionNodeRecord {
  id: string;
  tenantId: string;
  displayName: string;
  runtimeId: string;
  status: 'online' | 'offline';
  cwd: string;
  permissionScope: string;
  currentSessionId: string | null;
  lastSeenAt: string;
}

export interface RegisterExecutionNodeInput extends Omit<ExecutionNodeRecord, 'status' | 'currentSessionId'> {}

interface NodeRow {
  id: string;
  tenant_id: string;
  display_name: string;
  runtime_id: string;
  status: 'online' | 'offline';
  cwd: string;
  permission_scope: string;
  current_session_id: string | null;
  last_seen_at: string;
}

export class ExecutionNodeStore {
  constructor(private readonly database: SqliteDatabase) {}

  registerLocal(input: RegisterExecutionNodeInput): ExecutionNodeRecord {
    this.database.prepare(`
      INSERT INTO execution_nodes
        (id, tenant_id, display_name, runtime_id, status, cwd, permission_scope,
         current_session_id, last_seen_at, payload_json)
      VALUES (?, ?, ?, ?, 'online', ?, ?, NULL, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        display_name = excluded.display_name,
        runtime_id = excluded.runtime_id,
        status = 'online',
        cwd = excluded.cwd,
        permission_scope = excluded.permission_scope,
        last_seen_at = excluded.last_seen_at,
        payload_json = excluded.payload_json
    `).run(input.id, input.tenantId, input.displayName, input.runtimeId, input.cwd, input.permissionScope, input.lastSeenAt, canonicalJson({ host: 'electron-main' }));
    return this.require(input.id);
  }

  list(tenantId: string): ExecutionNodeRecord[] {
    return this.database.prepare(`
      SELECT id, tenant_id, display_name, runtime_id, status, cwd, permission_scope,
        (SELECT id FROM sessions
          WHERE sessions.runtime_id = execution_nodes.runtime_id
            AND sessions.status IN ('running', 'awaiting_approval', 'paused')
          ORDER BY sessions.started_at DESC LIMIT 1) AS current_session_id,
        last_seen_at
      FROM execution_nodes WHERE tenant_id = ? ORDER BY display_name, id
    `).all<NodeRow>(tenantId).map(mapNode);
  }

  markOffline(id: string, occurredAt: string): void {
    this.database.prepare(`UPDATE execution_nodes SET status = 'offline', current_session_id = NULL, last_seen_at = ? WHERE id = ?`)
      .run(occurredAt, id);
  }

  private require(id: string): ExecutionNodeRecord {
    const row = this.database.prepare(`
      SELECT id, tenant_id, display_name, runtime_id, status, cwd, permission_scope,
        current_session_id, last_seen_at FROM execution_nodes WHERE id = ?
    `).get<NodeRow>(id);
    if (!row) throw new Error(`Execution node ${id} was not persisted`);
    return mapNode(row);
  }
}

function mapNode(row: NodeRow): ExecutionNodeRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    displayName: row.display_name,
    runtimeId: row.runtime_id,
    status: row.status,
    cwd: row.cwd,
    permissionScope: row.permission_scope,
    currentSessionId: row.current_session_id,
    lastSeenAt: row.last_seen_at,
  };
}
