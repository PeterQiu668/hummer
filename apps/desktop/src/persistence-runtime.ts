import { existsSync, readFileSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import type { DesktopPersistence } from './persistence/database.js';
import type { PersistableRuntimeEvent } from './persistence/runtime-event-store.js';

export function enrichRuntimeEventEvidence(
  persistence: DesktopPersistence,
  event: PersistableRuntimeEvent,
  workspaceDirectory: string,
  tenantId: string,
): PersistableRuntimeEvent {
  const evidenceRefs = event.evidenceRefs.filter((ref) => !/^(?:evi|fixture):\/\//.test(ref));
  if (event.type === 'tool' && event.tool === 'workspace.patch') {
    for (const relativePath of changePaths(event.args)) {
      const path = resolve(workspaceDirectory, relativePath);
      if (!isInside(workspaceDirectory, path) || !existsSync(path)) continue;
      const stored = persistence.evidence.put(readFileSync(path), {
        tenantId,
        sessionId: event.sessionId,
        mediaType: mediaType(path),
        name: relativePath,
        createdAt: event.occurredAt,
        metadata: { source: 'runtime-file-change', relativePath },
      });
      evidenceRefs.push(stored.ref);
    }
  }
  if (event.type === 'result') {
    evidenceRefs.push(...persistence.listEvidence(event.sessionId).map((item) => item.ref));
  }
  return { ...event, evidenceRefs: [...new Set(evidenceRefs)] };
}

function changePaths(args: unknown): string[] {
  if (!isRecord(args) || !Array.isArray(args.changes)) return [];
  return args.changes.flatMap((change) => {
    if (!isRecord(change)) return [];
    const path = typeof change.path === 'string' ? change.path : typeof change.filePath === 'string' ? change.filePath : undefined;
    return path ? [path] : [];
  });
}

function isInside(root: string, candidate: string): boolean {
  const path = relative(resolve(root), candidate);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

function mediaType(path: string): string {
  return ({ '.md': 'text/markdown', '.txt': 'text/plain', '.json': 'application/json', '.csv': 'text/csv' } as Record<string, string>)[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
