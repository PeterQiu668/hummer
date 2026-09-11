import { readFileSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import { requireWorkspaceFile, type WorkspaceFile } from './workspace-file-guard.js';
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
      const file = guardedEvidenceFile(workspaceDirectory, relativePath, 'runtime_file_change', 25 * 1024 * 1024, true);
      if (!file) continue;
      const stored = persistence.evidence.put(readFileSync(file.absolutePath), {
        tenantId,
        sessionId: event.sessionId,
        mediaType: mediaType(file.absolutePath),
        name: file.relativePath,
        createdAt: event.occurredAt,
        metadata: { source: 'runtime-file-change', relativePath: file.relativePath },
      });
      evidenceRefs.push(stored.ref);
    }
  }
  if (event.type === 'tool' && (event.tool === 'fs.read' || event.tool === 'doc.extract')) {
    const requestedPath = isRecord(event.args) && typeof event.args.path === 'string' ? event.args.path : undefined;
    if (requestedPath) {
      const file = guardedEvidenceFile(
        workspaceDirectory,
        requestedPath,
        event.tool === 'doc.extract' ? 'doc_extract_evidence' : 'fs_read_evidence',
        event.tool === 'doc.extract' ? 25 * 1024 * 1024 : 1_048_576,
      );
      if (file) {
        const stored = persistence.evidence.put(readFileSync(file.absolutePath), {
          tenantId,
          sessionId: event.sessionId,
          mediaType: mediaType(file.absolutePath),
          name: file.relativePath,
          createdAt: event.occurredAt,
          metadata: { source: 'tool-invocation', capabilityId: event.tool, relativePath: file.relativePath },
        });
        evidenceRefs.push(stored.ref);
      }
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
  return ({
    '.md': 'text/markdown', '.txt': 'text/plain', '.json': 'application/json', '.csv': 'text/csv',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.pdf': 'application/pdf',
  } as Record<string, string>)[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

function guardedEvidenceFile(
  workspaceDirectory: string,
  requestedPath: string,
  capability: string,
  maxBytes: number,
  allowAbsolute = false,
): WorkspaceFile | undefined {
  let safePath = requestedPath;
  if (isAbsolute(requestedPath)) {
    if (!allowAbsolute || !isInside(workspaceDirectory, requestedPath)) return undefined;
    safePath = relative(resolve(workspaceDirectory), resolve(requestedPath));
  }
  try {
    return requireWorkspaceFile({ workspaceDirectory, requestedPath: safePath, capability, maxBytes });
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
