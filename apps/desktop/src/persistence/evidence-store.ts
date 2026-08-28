import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonicalJson, sha256Hex, type JsonValue } from './canonical-json.js';
import type { SqliteDatabase } from './sqlite.js';

export interface EvidenceMetadata {
  tenantId: string;
  sessionId?: string;
  mediaType: string;
  name?: string;
  createdAt: string;
  metadata?: { [key: string]: JsonValue };
}

export interface StoredEvidence {
  id: string;
  ref: string;
  tenantId: string;
  sessionId: string | null;
  sha256: string;
  sizeBytes: number;
  mediaType: string;
  name: string | null;
  blobPath: string;
  createdAt: string;
  metadata: { [key: string]: JsonValue };
}

export type EvidenceIntegrity =
  | { valid: true; sha256: string; sizeBytes: number }
  | { valid: false; sha256: string; reason: 'missing_blob' | 'digest_mismatch' | 'size_mismatch' };

interface EvidenceRow {
  id: string;
  ref: string;
  tenant_id: string;
  session_id: string | null;
  sha256: string;
  size_bytes: number;
  media_type: string;
  name: string | null;
  blob_path: string;
  created_at: string;
  metadata_json: string;
}

export class EvidenceStore {
  private readonly blobDirectory: string;

  constructor(
    private readonly database: SqliteDatabase,
    private readonly dataDirectory: string,
  ) {
    this.blobDirectory = join(dataDirectory, 'blobs', 'sha256');
    mkdirSync(this.blobDirectory, { recursive: true });
  }

  put(content: Uint8Array, metadata: EvidenceMetadata): StoredEvidence {
    validateMetadata(metadata);
    const bytes = Buffer.from(content);
    const sha256 = sha256Hex(bytes);
    const ref = `evidence://sha256/${sha256}`;
    const relativePath = join('blobs', 'sha256', sha256);
    const blobPath = join(this.dataDirectory, relativePath);
    this.writeBlob(blobPath, bytes, sha256);

    const id = `evi_${sha256Hex(`${metadata.sessionId ?? 'global'}:${sha256}`).slice(0, 32)}`;
    const metadataJson = canonicalJson(metadata.metadata ?? {});
    this.database.prepare(`
      INSERT INTO evidence (
        id, ref, tenant_id, session_id, sha256, size_bytes, media_type, name, blob_path, created_at, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT DO NOTHING
    `).run(
      id, ref, metadata.tenantId, metadata.sessionId ?? null, sha256, bytes.length,
      metadata.mediaType, metadata.name ?? null, relativePath, metadata.createdAt, metadataJson,
    );
    const row = this.database.prepare('SELECT * FROM evidence WHERE id = ?').get<EvidenceRow>(id);
    if (!row) throw new Error(`Evidence metadata was not recorded for ${ref}`);
    return this.mapRow(row);
  }

  read(ref: string): Buffer {
    const row = this.findRow(ref);
    const integrity = this.verifyRow(row);
    if (!integrity.valid) throw new Error(`Evidence integrity check failed for ${ref}: ${integrity.reason}`);
    return readFileSync(join(this.dataDirectory, row.blob_path));
  }

  verify(ref: string): EvidenceIntegrity {
    return this.verifyRow(this.findRow(ref));
  }

  listBySession(sessionId: string): StoredEvidence[] {
    return this.database.prepare('SELECT * FROM evidence WHERE session_id = ? ORDER BY created_at, id')
      .all<EvidenceRow>(sessionId).map((row) => this.mapRow(row));
  }

  private findRow(ref: string): EvidenceRow {
    const row = this.database.prepare('SELECT * FROM evidence WHERE ref = ? ORDER BY id LIMIT 1').get<EvidenceRow>(ref);
    if (!row) throw new Error(`Unknown evidence reference: ${ref}`);
    return row;
  }

  private verifyRow(row: EvidenceRow): EvidenceIntegrity {
    const path = join(this.dataDirectory, row.blob_path);
    if (!existsSync(path)) return { valid: false, sha256: row.sha256, reason: 'missing_blob' };
    const bytes = readFileSync(path);
    const actualDigest = sha256Hex(bytes);
    if (actualDigest !== row.sha256) return { valid: false, sha256: row.sha256, reason: 'digest_mismatch' };
    if (bytes.length !== row.size_bytes) return { valid: false, sha256: row.sha256, reason: 'size_mismatch' };
    return { valid: true, sha256: row.sha256, sizeBytes: row.size_bytes };
  }

  private writeBlob(path: string, bytes: Buffer, expectedDigest: string): void {
    mkdirSync(dirname(path), { recursive: true });
    if (existsSync(path)) {
      if (sha256Hex(readFileSync(path)) !== expectedDigest) throw new Error(`Existing evidence blob failed integrity check: ${path}`);
      return;
    }
    const temporaryPath = `${path}.${randomUUID()}.tmp`;
    writeFileSync(temporaryPath, bytes, { flag: 'wx' });
    try {
      renameSync(temporaryPath, path);
    } catch (error) {
      rmSync(temporaryPath, { force: true });
      if (!existsSync(path) || sha256Hex(readFileSync(path)) !== expectedDigest) throw error;
    }
  }

  private mapRow(row: EvidenceRow): StoredEvidence {
    return {
      id: row.id,
      ref: row.ref,
      tenantId: row.tenant_id,
      sessionId: row.session_id,
      sha256: row.sha256,
      sizeBytes: row.size_bytes,
      mediaType: row.media_type,
      name: row.name,
      blobPath: join(this.dataDirectory, row.blob_path),
      createdAt: row.created_at,
      metadata: JSON.parse(row.metadata_json) as { [key: string]: JsonValue },
    };
  }
}

function validateMetadata(metadata: EvidenceMetadata): void {
  if (!metadata.tenantId || !metadata.mediaType || !metadata.createdAt) {
    throw new TypeError('Evidence metadata requires tenantId, mediaType and createdAt');
  }
  canonicalJson(metadata.metadata ?? {});
}
