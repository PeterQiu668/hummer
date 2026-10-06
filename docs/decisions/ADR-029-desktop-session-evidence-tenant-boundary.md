# ADR-029: Desktop session and evidence reads require an explicit tenant boundary

- Status: Accepted as P0 isolation repair
- Date: 2026-10-07
- Scope: `apps/desktop/src/persistence`

## Context

Desktop persistence already stored a `tenant_id` on sessions, runtime events,
approvals, result packages, and evidence. Several public read methods still
accepted only a globally shaped session or evidence identifier, however. Their
queries could therefore return another tenant's record when a caller knew or
guessed that identifier. Some projection writes had the same bare-identifier
assumption and could bind an event or approval to a session owned by another
tenant.

This is a P0 isolation defect. Work on later schema versions and per-tenant
hash-chain heads is paused until the existing boundary is closed.

## Decision

1. Public session, runtime-event, approval, result-package, and evidence reads
   require `tenantId` in addition to their resource identifier.
2. SQL queries constrain both the resource identifier and tenant ownership.
   In-memory/store APIs keep the same explicit boundary so a caller cannot
   accidentally bypass the SQL predicate.
3. A session identifier belonging to another tenant is indistinguishable from
   an unknown session: singular reads return `undefined` and collection reads
   return an empty list.
4. Evidence reads and verification use the same generic not-found failure for
   unknown and wrong-tenant references. They do not disclose whether another
   tenant owns the reference.
5. New evidence row IDs include `tenantId` in their derivation. Existing rows
   remain readable for backward compatibility, but only through a matching
   `(tenant_id, ref)` predicate. No journal or evidence record is rewritten.
6. Session projection writes, runtime event projection, approval authorization,
   and evidence-to-session association reject a tenant mismatch before data is
   returned or mutated. Rejection uses a generic tenant-scope error.
7. Startup interruption of stale real sessions remains an internal, host-wide
   maintenance operation rather than a tenant-facing read API.
8. Schema migrations v1-v11 are unchanged. This repair adds no v12/v13 schema
   work and no per-tenant chain implementation.

## Compatibility and limits

- Callers must now propagate the authenticated tenant explicitly. This is an
  intentional source-level breaking change inside the desktop package.
- Content-addressed evidence blobs can still share identical bytes on disk;
  tenant isolation is enforced by the database row and every lookup predicate.
- This ADR covers the discovered session/evidence boundary. Other persistence
  stores with globally scoped operational identifiers need separate review and
  are not silently declared tenant-safe here.

## Verification

The test suite includes the stable marker
`[TEN-P0-DESKTOP-SESSION-BARE-ID]`. Its two-tenant cases prove that:

- a wrong tenant receives no session, runtime event, approval, result package,
  or evidence metadata;
- wrong-tenant and unknown evidence references expose the same error;
- cross-tenant session projection, runtime event, approval, authorization, and
  evidence association writes fail without changing the owner's records; and
- each tenant's legitimate records remain available after the rejected calls.
