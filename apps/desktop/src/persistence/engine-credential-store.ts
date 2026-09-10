import { randomUUID } from 'node:crypto';
import type { SqliteDatabase } from './sqlite.js';

export interface EncryptedEngineCredential {
  id: string;
  tenantId: string;
  engineProfileId: string;
  envKey: string;
  encryptedValue: string;
  createdAt: string;
  updatedAt: string;
}

export interface EngineCredentialStatus {
  engineProfileId: string;
  envKey: string;
  configured: boolean;
  updatedAt: string;
}

interface CredentialRow {
  id: string;
  tenant_id: string;
  engine_profile_id: string;
  env_key: string;
  encrypted_value: string;
  created_at: string;
  updated_at: string;
}

export class EngineCredentialStore {
  constructor(private readonly database: SqliteDatabase, private readonly now: () => Date = () => new Date()) {}

  upsert(input: { tenantId: string; engineProfileId: string; envKey: string; encryptedValue: string }): EncryptedEngineCredential {
    requireValue(input.tenantId, 'tenantId');
    requireValue(input.engineProfileId, 'engineProfileId');
    requireValue(input.envKey, 'envKey');
    requireValue(input.encryptedValue, 'encryptedValue');
    const timestamp = this.now().toISOString();
    const existing = this.getEncrypted(input.tenantId, input.engineProfileId);
    const id = existing?.id ?? `credential_${randomUUID().replace(/-/g, '')}`;
    this.database.prepare(`
      INSERT INTO engine_credentials (
        id, tenant_id, engine_profile_id, env_key, encrypted_value, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (tenant_id, engine_profile_id) DO UPDATE SET
        env_key = excluded.env_key,
        encrypted_value = excluded.encrypted_value,
        updated_at = excluded.updated_at
    `).run(id, input.tenantId, input.engineProfileId, input.envKey, input.encryptedValue, existing?.createdAt ?? timestamp, timestamp);
    return this.getEncrypted(input.tenantId, input.engineProfileId)!;
  }

  getEncrypted(tenantId: string, engineProfileId: string): EncryptedEngineCredential | undefined {
    const row = this.database.prepare(`
      SELECT id, tenant_id, engine_profile_id, env_key, encrypted_value, created_at, updated_at
      FROM engine_credentials WHERE tenant_id = ? AND engine_profile_id = ?
    `).get<CredentialRow>(tenantId, engineProfileId);
    return row ? mapRow(row) : undefined;
  }

  listStatus(tenantId: string): EngineCredentialStatus[] {
    return this.database.prepare(`
      SELECT id, tenant_id, engine_profile_id, env_key, encrypted_value, created_at, updated_at
      FROM engine_credentials WHERE tenant_id = ? ORDER BY engine_profile_id
    `).all<CredentialRow>(tenantId).map((row) => ({
      engineProfileId: row.engine_profile_id,
      envKey: row.env_key,
      configured: true,
      updatedAt: row.updated_at,
    }));
  }

  remove(tenantId: string, engineProfileId: string): boolean {
    return this.database.prepare('DELETE FROM engine_credentials WHERE tenant_id = ? AND engine_profile_id = ?')
      .run(tenantId, engineProfileId).changes > 0;
  }
}

function mapRow(row: CredentialRow): EncryptedEngineCredential {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    engineProfileId: row.engine_profile_id,
    envKey: row.env_key,
    encryptedValue: row.encrypted_value,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function requireValue(value: string, field: string): void {
  if (!value.trim()) throw new TypeError(`Engine credential requires ${field}`);
}
