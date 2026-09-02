# ADR-002: M4 identity and tenant boundary precedes collaboration expansion

Date: 2026-08-30
Status: Accepted
Supersedes: ADR-001 only where it deferred multi-tenant identity

## Decision

HUMMER M4 is strictly serial. M4-A establishes account identity and tenant isolation before approvals UI, durable projects, channels, tools, or desktop automation expand.

SQLite migration version 3 adds:

- `tenants`
- `accounts`
- `memberships`
- `invitations`
- `sessions_auth`

Migration versions 1 and 2 remain unchanged. The earlier domain-model proposal that reserved migration version 3 for project objects is superseded; M4-C project and evolution tables start at migration version 4.

## Security boundary

The renderer is not authoritative for `tenantId` or an approval actor.

1. The renderer retains an opaque session token.
2. SQLite stores only its SHA-256 digest in `sessions_auth`.
3. Every Electron IPC business call resolves `currentTenantId()` from that session.
4. Organization writes and approval decisions overwrite caller-supplied identity with the authenticated membership.
5. Tenant-scoped reads include the resolved tenant predicate.
6. Invitation tokens are also stored only as SHA-256 digests.

The current implementation is local-device authentication and tenant isolation. It is not yet remote SSO, MFA, encrypted credential storage, cloud session revocation, or PostgreSQL row-level security. Browser-only mode is explicitly an interactive prototype and cannot prove cross-profile persistence.

## Responsibility rules

- One account can have active memberships in multiple tenants.
- Roles are `owner`, `admin`, and `member`.
- Each membership maps to one tenant-scoped `HumanUser`.
- Creating or accepting a membership creates one active `DigitalTwin`.
- A partial unique SQLite index enforces at most one active twin per tenant and human.
- Protected-action approval uses `account:<accountId>` from the authenticated session; legacy `human:` references remain resolvable for historical records.

## Consequences

- `tenant_demo` and `human:owner` are forbidden in production code paths; test fixtures may retain synthetic values.
- React clients no longer accept arbitrary tenant IDs for organization, approval, persistence, or execution-node operations.
- The tenant switcher reads memberships and updates `sessions_auth.current_tenant_id`.
- M4-B, M4-C, M4-D, and M5 remain blocked until the complete M4-A acceptance suite is green.
- Existing global hash-chain verification remains intact. A future migration may add per-tenant chain heads if independent tenant export or deletion becomes required.

## Acceptance evidence

The first M4-A slice is covered by `apps/desktop/src/persistence/m4-identity-tenant.test.ts`:

- versioned migration creates all five identity tables;
- two authenticated tenant sessions cannot read each other's domain events;
- invitation acceptance persists across reopen;
- the database rejects a second active twin;
- the authenticated member resolves to a named account approver.

`npm run test:desktop:identity` provides the packaged Electron evidence: two isolated renderer profiles create and accept an invitation in the same tenant, each retains one distinct active twin, and the owner profile preserves both members after restart. The latest machine-generated evidence is `spikes/m4-identity/two-profile-evidence.json`.

M4-A is complete for the local Electron scope. Remote SSO, MFA, encrypted credential storage, cloud session revocation, and PostgreSQL row-level security remain future production-hardening work and must not be implied by this local proof.
