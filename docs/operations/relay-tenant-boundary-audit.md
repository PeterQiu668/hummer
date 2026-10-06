# Relay tenant-boundary audit and P0 containment

## Outcome

The audit found two Relay cross-tenant reference defects. Node registration only
checked that the manifest included the session tenant. Capability-grant
management used a bare grant ID and exposed unscoped list/snapshot operations.
ADR-030 closes the first at the authenticated session, service, and both
storage implementations, and closes the second inside the Relay-local grant
registry.

After containment, no Relay query was found that returned or mutated another
tenant's stored business object. Existing task, event, approval, consumption,
and audit paths require `tenantId`; SQLite predicates and compound constraints
include `tenant_id`, Memory keys use `tenantId + NUL + id`, and grant management
now uses composite tenant/grant keys. The singleton Relay clock and schema
migration table are operational metadata, not tenant business objects.

The audit was performed after the overall W4 stop condition had been triggered
outside Relay. Consequently, this change contains the existing defect only.
It does not add quota counters, audit export, chain heads, schema 14, or an
external anchor.

## Authorization rule

- No `authorizedTenantIds` claim: authorize only the badge's primary tenant.
- Explicit claim: it must be unique, non-empty, and contain the primary tenant;
  a multi-tenant set also requires a non-empty opaque `grantRef`.
- Manifest tenant set: it must be unique, non-empty, contain the current tenant,
  and be a subset of the authenticated claim.
- Invalid sets fail with generic `tenant_mismatch`; the response does not echo
  the ungranted identifier.
- The store repeats the check so an internal caller cannot bypass
  `FleetService`.

The manifest is never an authority source. A production identity provider is
responsible for issuing the explicit multi-tenant claim. Task-scoped capability
grants remain single-tenant.

## Negative evidence

`test/tenant-boundary.test.ts` covers both Memory and SQLite plus Fastify:

1. Default tenant-A session rejects manifest `[A, B]` and persists no row.
2. Direct store invocation with authorization `[A]` also rejects `[A, B]`.
3. Explicit `[A, B]` authorization plus an opaque grant reference accepts only
   a matching subset; the same set without a reference is rejected.
4. Explicit `[A, B]` rejects `[A, C]` without revealing C or overwriting the
   prior safe record.
5. Identical node/task/event/approval identifiers in A and B remain isolated.
6. Reads and a stop reference from B return no A object and do not mutate A.
7. A malformed explicit badge tenant set is rejected during provisioning.
8. `[TEN-P0-RELAY-MULTITENANT-GRANT]` proves identical grant IDs remain isolated
   across tenants; wrong-tenant and unknown lookups/mutations are
   indistinguishable; list/snapshot are tenant-filtered; and restore rejects a
   missing or mismatched tenant context.

## Commands

```powershell
npm.cmd run test:tenant-boundary -w @hummer/relay
npm.cmd run typecheck -w @hummer/relay
npm.cmd run test -w @hummer/relay
```

Do not resume W4 governance features until the integration owner clears every
known P0 tenant-boundary defect across API, desktop session, and Relay layers.
