# ADR-026: Relay owns the short-lived CapabilityGrant lifecycle

- Status: Accepted for Phase 1 W2
- Date: 2026-10-07
- Milestone: Fleet control-plane hardening

## Context

Phase 0 authenticated Relay requests through a static map of opaque bearer-token
fingerprints. That proved tenant, node, expiry, and scope binding, but it was not
an issuer: it could not rotate or revoke a badge, count uses, preserve revocation
state across a controlled restart, or prove that a delegated badge was narrower
than the authority that created it.

The product contract requires a task-scoped `CapabilityGrant` with `grantId`,
tenant, WorkOrder, node, capabilities, paths, expiry, `maxUses`, `usedCount`, and
run binding. The plaintext bearer token must never enter logs, evidence,
diagnostics, or persistence.

## Decision

1. `CapabilityGrantRegistry` is the Relay-local issuance and revocation source.
   Issuance receives an already authenticated authority boundary and rejects any
   widening of tenant, node, WorkOrder, run, capability, path, expiry, or use
   budget. Unknown capabilities, duplicate identifiers, malformed state, and
   expired authority fail closed.
2. Default issuance creates a 256-bit random opaque bearer token. The token is
   returned once as a non-enumerable field in `IssuedCapabilityGrant` and is never retained. Relay keeps
   only its SHA-256 digest and an opaque `grant:<grantId>` reference. SHA-256 is
   appropriate here because the source token is uniformly random with 256 bits
   of entropy, not a user password. Making the field non-enumerable prevents
   ordinary JSON serialization and object inspection from copying it by
   accident; the caller must still treat direct `issued.token` access as secret.
3. Authentication and use accounting are one `authorize` operation. A denied
   scope does not spend a use. A successful authorization increments
   `usedCount`; the exact `maxUses` boundary exhausts the grant. Expiry is
   inclusive: `now >= expiresAt` is denied.
4. Rotation issues a narrower replacement bounded by the source grant's
   remaining uses, then marks the source `rotated` and immediately unusable.
   Revocation likewise becomes effective at the next Fastify authorization
   checkpoint. Both operations return only redaction-safe records.
5. `snapshot()` is the only persistence boundary. It contains safe metadata and
   a 64-character token digest, never bearer plaintext. Restore rejects unknown
   fields, malformed digests, duplicate records, impossible counters, and
   inconsistent states. The embedding process must persist the complete
   snapshot transactionally after lifecycle mutation; the registry itself does
   no filesystem I/O.
6. Fastify depends only on `BadgeTokenAuthenticator.authorize`. Unknown,
   expired, revoked, rotated, and exhausted tokens all receive the same generic
   401 response; an authenticated but insufficient scope receives 403. Error
   bodies never reflect the bearer token. `FleetTransport` and the application
   ingress/store ports remain unchanged.
7. No public HTTP issuance endpoint is added. A deployment identity/control
   plane calls the issuer programmatically after authenticating the delegating
   authority. The Phase 0 static authenticator remains explicitly development
   only.

## Consequences

- A stolen grant is bounded by tenant, node, task/run context, explicit scopes,
  paths, TTL, and a finite use count. Rotation never replenishes already spent
  uses.
- Durable revocation requires the host to persist each returned snapshot before
  acknowledging the control-plane mutation. A database adapter with its own
  transaction boundary may replace this snapshot seam later without changing
  Fastify or `FleetTransport`.
- Existing node registration tokens still use the static development registry
  until the deployment identity provider provisions `CapabilityGrantRegistry`.
  This ADR does not claim production identity integration.
- An already running tool action needs a node-agent checkpoint to observe a
  later revocation. This increment guarantees the next Relay authorization
  checkpoint; W3 remains responsible for execution-loop checkpoints.

## Verification

```powershell
npm.cmd run typecheck -w @hummer/relay
npm.cmd run test:grants -w @hummer/relay
npm.cmd run test -w @hummer/relay
```

Tests cover least-privilege issuance, tenant/node/WorkOrder/run/capability/path/
expiry/use-budget widening, exact expiry, `maxUses`, no-spend scope denial,
rotation, revocation, duplicate token/id rejection, restart restoration,
malformed persisted state, generic Fastify denial, and plaintext absence from
safe records, snapshots, and HTTP responses.
