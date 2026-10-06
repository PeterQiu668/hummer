# ADR-028: API identifiers are tenant-qualified at every boundary

- Status: accepted
- Date: 2026-10-07

## Context

The in-memory WorkOrder and Runtime services used globally keyed maps for work
orders, approvals, results, idempotency records, and runtime snapshots. Their
public read and mutation methods accepted a bare object identifier. A caller
that learned an identifier from another tenant could therefore address that
object without proving the tenant boundary.

This is a P0 isolation defect under the W4 stop rule. Feature work remains
paused until the executable cross-tenant regression gate passes.

## Decision

1. Every WorkOrder command carries an authenticated `tenantId` and tenant
   role. Caller-supplied tenant data never overrides that context.
2. All internal map keys use `tenantId + NUL + objectId`; tenant-local object
   identifiers and idempotency keys may safely repeat across tenants.
3. Public reads require `tenantId`. Wrong-tenant access returns the same
   `not_found` class as an unknown object and does not reveal existence.
4. Runtime resume, cancel, and snapshot reads also require `tenantId`, and
   runtime/approval indexes are tenant-qualified.
5. `auditor` and `operator` roles cannot make a final result acceptance or
   rejection decision. The acceptance actor must equal the authenticated actor.
6. A behavior test with the stable ID
   `[TEN-P0-API-WORKORDER-BARE-ID]` proves duplicate local IDs and
   idempotency keys remain isolated and wrong-tenant reads/writes fail closed.

## Consequences

- Existing internal callers must provide tenant and role context explicitly.
- This change intentionally breaks ambiguous bare-ID API calls at compile time.
- PostgreSQL RLS remains a later second gate; this decision provides the
  application and in-memory boundary required before that spike can be useful.
