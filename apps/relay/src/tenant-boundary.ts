import { FleetRejectedError } from './ports.js';

function validTenantSet(values: readonly string[]): boolean {
  return values.length > 0
    && values.every((value) => typeof value === 'string' && value.trim().length > 0)
    && new Set(values).size === values.length;
}

/**
 * A badge authorizes exactly its primary tenant unless an identity provider
 * supplies an explicit tenant grant. Invalid identity-provider claims fail
 * closed without identifying any tenant in the error text.
 */
export function resolveAuthorizedTenantIds(
  tenantId: string,
  explicitlyAuthorized?: readonly string[],
  tenantGrantRef?: string,
): readonly string[] {
  const authorized = explicitlyAuthorized ? [...explicitlyAuthorized] : [tenantId];
  if (!tenantId.trim() || !validTenantSet(authorized) || !authorized.includes(tenantId)
    || (authorized.length > 1 && !tenantGrantRef?.trim())) {
    throw new FleetRejectedError('tenant_mismatch', 'node tenant authorization is invalid');
  }
  return authorized;
}

/** Defense in depth for both FleetService and direct FleetStore callers. */
export function assertNodeTenantAuthorization(
  tenantId: string,
  manifestTenantIds: readonly string[],
  authorizedTenantIds: readonly string[],
  tenantGrantRef?: string,
): void {
  const authorized = resolveAuthorizedTenantIds(tenantId, authorizedTenantIds, tenantGrantRef);
  const allowed = new Set(authorized);
  if (!validTenantSet(manifestTenantIds)
    || !manifestTenantIds.includes(tenantId)
    || manifestTenantIds.some((candidate) => !allowed.has(candidate))) {
    throw new FleetRejectedError('tenant_mismatch', 'node manifest tenant set is not authorized');
  }
}
