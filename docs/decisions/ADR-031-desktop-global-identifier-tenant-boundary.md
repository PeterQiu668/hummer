# ADR-031: Desktop global identifiers must not bypass tenant ownership

- Status: Accepted as P0 isolation repair
- Date: 2026-10-07
- Scope: desktop domain events, execution nodes, and organization identifiers

## Context

The v1/v2 desktop schema uses globally unique primary keys for domain events,
execution nodes, humans, twins, departments, and digital employees. Tenant-aware
list methods did not make every identifier operation tenant-safe:

- domain-event idempotency looked up an event by bare ID;
- the ordinary-tenant integrity IPC returned global-chain failures, including a
  foreign event ID and count, and a foreign tenant's tamper could make another
  tenant's integrity check fail;
- execution-node registration and offline mutation used a bare node ID, while
  current-session discovery matched only `runtime_id`;
- organization hiring silently reused global human and department IDs and then
  loaded the employee by a bare ID.

The identity store's public human/twin operations were also audited. They
already derive the tenant from an authenticated session and constrain their SQL
by tenant, so they require regression evidence rather than an API rewrite.

## Decision

1. Domain-event idempotency first matches `(tenant_id, id)`. A globally occupied
   event ID from another tenant fails with a generic current-tenant error and
   never returns the foreign event.
2. `verifyTenantDomainEventIntegrity(tenantId)` verifies only that tenant's
   canonical payloads and event hashes. Ordinary tenant IPC and tenant outcome
   receipts use this API. The global integrity verifier remains available only
   to controlled internal/administrative flows and tests.
3. The global event chain and opaque cross-tenant proof nodes remain unchanged.
   A verifiable receipt exposes no foreign event body.
4. Execution-node registration, lookup, and offline mutation constrain both
   tenant and node ID. Cross-tenant and unknown mutations have the same generic
   failure. Current-session discovery also requires the session and node tenant
   to match.
5. Organization hiring validates employee and department ID ownership before
   insert. A human or twin sponsor must already be active in the same tenant;
   unknown and foreign sponsors have the same generic failure. The final
   employee read uses `(tenant_id, id)`.
6. Schema migrations remain unchanged. No v12/v13, tenant chain head, quota, or
   dual-chain feature is introduced by this repair.

## Verification and non-findings

The `[TEN-P0B-DESKTOP-IDENTIFIERS]` behavior suite uses two real tenants and
proves that:

- a foreign domain-event ID cannot be replayed or returned, and a foreign
  tenant's corrupted payload does not change the current tenant's integrity
  result;
- a foreign node cannot be overwritten or marked offline, and a shared runtime
  ID cannot select another tenant's session;
- foreign employee, department, human, and twin identifiers cannot be used to
  create organization records; and
- identity twin listing, actor resolution, and twin creation expose foreign
  humans exactly as unknown humans.

## Limits

- Tenant integrity validates each tenant-owned event against its stored hash.
  Until a separately approved per-tenant chain/head exists, it cannot prove the
  absence or tenant-local order of deleted events. The global verifier remains
  the authority for the legacy global chain.
- Global primary-key collisions still cannot create the same identifier in two
  tenants without a future additive migration. They now fail closed without
  returning or mutating the owning tenant's record.
