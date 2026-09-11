import { lstatSync, realpathSync, statSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';

export interface WorkspaceFile {
  absolutePath: string;
  relativePath: string;
  sizeBytes: number;
  extension: string;
}

export function requireWorkspaceDirectory(workspaceDirectory: string, requestedDirectory: string): string {
  const workspace = realpathSync(workspaceDirectory);
  const candidate = resolve(requestedDirectory);
  const relativePath = relative(workspace, candidate);
  if (!isInside(relativePath)) throw new Error('Inbox directory is outside the workspace');
  let cursor = workspace;
  for (const segment of relativePath.split(sep).filter(Boolean)) {
    cursor = resolve(cursor, segment);
    if (lstatSync(cursor).isSymbolicLink()) throw new Error('Inbox directory must not contain symbolic links');
  }
  const actual = realpathSync(candidate);
  if (!isInside(relative(workspace, actual))) throw new Error('Inbox directory is outside the workspace');
  if (!statSync(actual).isDirectory()) throw new Error('Inbox path must be a directory');
  return actual;
}

export function requireWorkspaceFile(input: {
  workspaceDirectory: string;
  requestedPath: string;
  capability: string;
  maxBytes: number;
  extensions?: readonly string[];
}): WorkspaceFile {
  const workspace = realpathSync(input.workspaceDirectory);
  if (!input.requestedPath || isAbsolute(input.requestedPath)) {
    throw new Error(`${input.capability} path is outside the workspace`);
  }
  const candidate = resolve(workspace, input.requestedPath);
  const relativePath = relative(workspace, candidate);
  if (!isInside(relativePath)) throw new Error(`${input.capability} path is outside the workspace`);

  let cursor = workspace;
  for (const segment of relativePath.split(sep).filter(Boolean)) {
    cursor = resolve(cursor, segment);
    if (lstatSync(cursor).isSymbolicLink()) throw new Error(`${input.capability} refuses symbolic links`);
  }

  const actual = realpathSync(candidate);
  if (!isInside(relative(workspace, actual))) throw new Error(`${input.capability} path is outside the workspace`);
  const stats = statSync(actual);
  if (!stats.isFile()) throw new Error(`${input.capability} accepts files only`);
  if (stats.size > input.maxBytes) throw new Error(`${input.capability} refuses files larger than ${input.maxBytes} bytes`);
  const extension = extname(actual).toLowerCase();
  if (input.extensions && !input.extensions.includes(extension)) {
    throw new Error(`${input.capability} supports only ${input.extensions.join(', ')}`);
  }
  return { absolutePath: actual, relativePath, sizeBytes: stats.size, extension };
}

function isInside(path: string): boolean {
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}
