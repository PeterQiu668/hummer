# ADR-030: Node manifests require explicit tenant authorization at Relay boundaries

- Status: Accepted as P0 containment
- Date: 2026-10-07
- Scope: Relay tenant-boundary P0 containment

## Context

The W4 audit found that `FleetService.register` accepted a node manifest when
`manifest.tenantIds` merely contained the authenticated session tenant. A
tenant-A badge could therefore submit `[tenant-A, tenant-B]`; Memory and SQLite
would persist and return the ungranted tenant-B reference inside tenant A's node
record. The existing storage predicates prevented direct reads or writes to
tenant B, but persisting an ungranted cross-tenant reference violates the
fail-closed device/tenant rule in section 8.6.

The same audit found that `CapabilityGrantRegistry` keyed management methods
only by `grantId` and exposed an all-tenant `list()`/`snapshot()`. Although the
current Fastify adapter does not publish those methods, a control-plane caller
could otherwise read, rotate, revoke, or export another tenant's grant by bare
identifier.

Other product layers had already triggered the W4 P0 stop condition. This ADR
therefore authorizes containment of the existing Relay defect only. It does not
authorize quota, export, chain-head, lifecycle, Postgres, or schema work.

## Decision

1. A node badge authorizes exactly its primary `tenantId` by default.
2. An identity provider may add `authorizedTenantIds` as an explicit
   registration grant. That set must be non-empty, unique, and include the
   primary tenant. A set containing multiple tenants also requires a non-empty
   opaque `grantRef`. Both are derived from authenticated claims, never from
   the node manifest or request body.
3. `NodeManifest.tenantIds` must be a non-empty, unique subset of the
   authenticated grant and must contain the current session tenant. Merely
   containing the current tenant is no longer sufficient.
4. `FleetService` enforces the rule before persistence. `MemoryFleetStore` and
   `SqliteFleetStore` enforce it again for direct callers; the store port carries
   the explicit authorization set. No caller can bypass the domain check by
   invoking a store directly.
5. Error code `tenant_mismatch` is retained. Error messages are generic and do
   not echo the ungranted tenant identifier.
6. Task-scoped `CapabilityGrant` authentication exposes only its single bound
   tenant. A future production identity provider must explicitly provision any
   multi-tenant registration badge.
7. No wire contract, shared contract version, table, or migration changes. The
   dedicated Relay schema remains version 13; desktop migrations are untouched.
8. Capability-grant management methods require an explicit tenant for get,
   list, snapshot, rotate, and revoke. Internal grant keys are composite
   tenant/grant keys; identical grant IDs in different tenants are valid.
9. A wrong-tenant grant reference and an unknown grant have identical outcomes:
   `null` for get, empty tenant-scoped collections, and generic
   `grant_not_found` for mutations. Errors never echo another tenant or grant.
10. Durable grant snapshots are emitted per tenant. Restore requires the
    expected tenant and rejects mixed or mismatched records before the registry
    is exposed to callers.

## Consequences

- Existing single-tenant badges continue to register manifests containing only
  their own tenant.
- A previously accepted manifest with extra tenant references will be rejected
  on re-registration unless the identity provider supplies an explicit grant.
- Explicit authorization plus its opaque grant reference permits a subset; it does not duplicate the node
  record into another tenant. Each tenant's store row remains separately keyed.
- This fix does not clear the overall W4 P0 stop. Quota, audit export, tenant
  chain heads, and schema 14 remain deliberately unimplemented.
- Grant-management callers must migrate from bare identifiers and unscoped
  snapshots to the tenant-explicit API. This is a deliberate fail-closed
  compatibility break.

## Verification

```powershell
npm.cmd run test:tenant-boundary -w @hummer/relay
npm.cmd run typecheck -w @hummer/relay
npm.cmd run test -w @hummer/relay
```

The regression suite runs the same storage checks against Memory and SQLite,
tests the Fastify badge boundary, verifies identical identifiers remain isolated
between two tenants, and asserts that rejection text does not reveal an
ungranted tenant identifier. The stable regression marker
`[TEN-P0-RELAY-MULTITENANT-GRANT]` covers grant ID collisions, wrong-tenant
existence resistance, tenant-filtered snapshots, and restore validation.
