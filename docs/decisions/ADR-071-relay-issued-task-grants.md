# ADR-071: Issue deterministic task grants only after bound human approval

## Status

Accepted on 2026-10-07. This supersedes ADR-070's offline pre-provisioning
limitation for the normal Desktop read-attestation path. Offline digest imports
remain supported as an explicit recovery/compatibility mechanism.

## Context

ADR-067 and ADR-068 separated node identity from one-use task authority and
made grant state durable, but the operator still had to generate a plaintext
token outside Relay, import its digest, place the same token in the Node
environment, and type its public reference in Desktop. That was safe enough to
prove the boundary, but it was not a usable one-person product flow.

The replacement must preserve the properties already proved: human approval,
exact tenant/node/WorkOrder/run/capability/path binding, one use, durable
revocation and exhaustion, restart safety, and no plaintext token in Desktop,
config, logs, journals, receipts, evidence, or SQLite.

## Decision

1. Relay config version 3 names a dedicated `taskGrantIssuerSecretEnv`. The
   secret must contain at least 32 non-whitespace characters, may not reuse a
   badge environment name, is read once, and is immediately removed from the
   process environment.
2. Desktop accepts only the read path and byte ceiling. It deterministically
   creates an opaque `grant:start-work-*` reference from the plan ID; operators
   never type or handle a bearer token.
3. The token route is node-badge authenticated and accepts only a leased task
   bound to that exact node and a persisted approved human decision whose
   granted scope has `maxUses: 1`.
4. Relay derives `hgr_<base64url>` with HMAC-SHA-256 over the immutable grant
   reference, tenant, WorkOrder, node, run, capability/path scope, expiry, and
   fixed `maxUses: 1`.
5. Before returning plaintext, Relay imports the exact binding and token digest
   into `SqliteTaskGrantAuthority`. Existing immutable rows are idempotent;
   conflicts fail closed. Mutable use/revocation/expiry state is never reset.
6. The Node keeps the returned token only in the active execution object. It is
   sent only in `x-hummer-task-grant` on consume/checkpoint calls and is neither
   journaled nor included in receipts or diagnostics.
7. The former Node-side configured token remains a temporary compatibility
   fallback for transports that do not implement issuance. The shipped Relay
   HTTP transport implements issuance and therefore does not use that fallback.

## Consequences

- A normal Desktop read task needs no offline grant provisioning.
- Relay restart does not lose the ability to re-derive the token, while SQLite
  remains authoritative for exhaustion and revocation.
- Rotation of the issuer secret invalidates the ability to re-derive live
  tokens. Production key rotation therefore needs an explicit drain/migration
  procedure before this leaves internal testing.
- This is still a shared-secret bootstrap, not an external IdP, HSM, remote TLS
  deployment, or multi-device production proof.

## Verification

- issuer unit tests prove deterministic restart derivation, digest-only
  persistence, immutable conflicts, and non-resetting exhaustion;
- Fastify tests prove no issuance before approval and no foreign-node access;
- the real HTTP Relay/Node/SQLite test proves dynamic issuance, one completed
  bounded read, exact exhaustion, and no file body, token, or issuer-secret
  leakage;
- Desktop tests prove the grant reference is generated and frozen without a
  manual token/reference field.
