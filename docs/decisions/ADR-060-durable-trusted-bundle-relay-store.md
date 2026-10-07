# ADR-060: Durable SQLite store for trusted capability bundles

- Status: accepted
- Date: 2026-10-07
- Scope: `apps/relay/src/trusted-bundle-relay.ts`, `apps/relay/src/trusted-bundle-sqlite-store.ts`

## Context

ADR-058 deliberately shipped an in-memory reference store. That proves strict
Relay-to-Node authorization and byte verification, but a Relay restart loses the
reviewed envelope. Re-publishing from an untrusted caller after every restart is
not an acceptable persistence strategy, and reporting success before durable
commit would break the bridge's immutable/idempotent guarantee.

This change must not alter `TrustedBundleEnvelopeV1`, the public HTTP routes, the
approved-decision derivation, or tenant/node badge semantics.

## Decision

Introduce a `TrustedBundleRelayStore` port implemented by both the existing
memory store and a new `SqliteTrustedBundleRelayStore`. Both implementations run
the same authorization, contract, decision, descriptor, and byte validation
before attempting storage.

The SQLite adapter owns an additive, independently versioned migration ledger:

- `trusted_bundle_schema_migrations` starts at version 1;
- `trusted_bundle_envelopes` uses `(tenant_id, bundle_id)` as its primary key;
- each row stores the target node, envelope digest, exact validated canonical
  envelope JSON, complete trusted gate input, and derived approved decision;
- append-only triggers reject update and delete;
- migration history is only appended and is never rewritten.

Publication executes in one SQLite transaction. If the primary key already
exists, an identical envelope digest is an idempotent replay and returns the
original result; a different digest is `bundle_conflict`. SQLite locks and other
write failures escape as failures and cannot return an inserted result. No
separate metadata row exists, so a committed row is the only success fact.

Consumption always qualifies by authenticated tenant and bundle id, then checks
the persisted target node before returning a clone. A missing row remains
indistinguishable across tenants (`bundle_not_found`).

## Consequences and limits

- Validated bundles survive Relay process/store restart when the same database
  file is reopened.
- Identical replay remains idempotent; bundle-id byte substitution remains
  rejected across restarts.
- A sustained database lock or injected write failure returns an explicit Relay
  failure and leaves no readable bundle row.
- The adapter is local SQLite persistence, not production deployment evidence.
  Production backup, HA, encryption-at-rest, key management, and Postgres/RLS
  remain outside this ADR.
- Approved gate evidence lookup is still supplied by the existing trusted Relay
  boundary; this ADR does not create a second approval source.

## Rejected alternatives

- **Write a file per bundle.** Cross-process atomicity, uniqueness, and lock
  behavior would need a second ad-hoc database protocol.
- **Upsert on conflict.** It would permit mutation of bytes under an existing
  bundle id and destroy the immutable transport guarantee.
- **Store only the digest and reconstruct bytes elsewhere.** The target node must
  download and independently verify the exact reviewed bytes.
- **Reuse or renumber historical Relay migrations.** Migration history is
  append-only; the trusted-bundle adapter has its own version ledger because it
  can be composed with or operated separately from `SqliteFleetStore`.
