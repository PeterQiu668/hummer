import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

export function requireTenantWorkspace(workspaceDirectory: string, tenantId: string): string {
  if (!tenantId) throw new TypeError('Tenant workspace requires tenantId');
  mkdirSync(workspaceDirectory, { recursive: true });
  const workspace = realpathSync(workspaceDirectory);
  const tenantKey = createHash('sha256').update(tenantId, 'utf8').digest('hex');
  const target = join(workspace, '.hummer', 'tenants', tenantKey);
  let cursor = workspace;
  for (const segment of relative(workspace, target).split(/[\\/]/).filter(Boolean)) {
    cursor = resolve(cursor, segment);
    if (existsSync(cursor)) {
      if (lstatSync(cursor).isSymbolicLink()) throw new Error('Tenant workspace refuses symbolic-link paths');
      if (!lstatSync(cursor).isDirectory()) throw new Error('Tenant workspace path must be a directory');
    } else {
      mkdirSync(cursor);
    }
  }
  return realpathSync(target);
}
