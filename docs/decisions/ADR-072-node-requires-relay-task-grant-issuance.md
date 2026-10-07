# ADR-072: Node requires Relay task-grant issuance and has no configured fallback token

## Status

Accepted on 2026-10-07. This supersedes ADR-071 decision item 7.

## Context

ADR-071 made the shipped Relay path issue a one-use task bearer only after the
bound human approval. The Node config still required `grantTokenEnv` solely for
compatibility with transports that lacked the new issue operation. Operators
therefore had to create and protect an unused secret, and a future fallback
could accidentally hide a missing or miswired issuer.

## Decision

1. Node daemon config version 4 removes `grantTokenEnv`. The only configured
   credential is the node badge environment variable.
2. A task whose envelope has `grantRef` requires the transport to implement
   `acquireTaskGrantToken`. Missing issuance fails with
   `task_grant_issuer_unavailable` before consume or executor invocation.
3. The Node Agent keeps a process-local random guard value for its existing
   local scope/expiry invariant. It is not configured, not logged, and cannot
   be used as a task bearer because the fallback branch no longer exists.
4. The issued bearer remains active-execution memory only and is sent solely to
   the bound consume/checkpoint routes.

## Consequences

- Node startup needs one fewer secret and one fewer environment variable.
- Old custom transports must implement issuance before they can execute a
  grant-bound task; silent compatibility is deliberately rejected.
- `grantExpiresAt` and `grantScopes` remain as a local defense-in-depth envelope
  for now. Removing or replacing that local invariant is a separate decision.

## Verification

- config tests reject old/unknown fields and start with badge-only credentials;
- a dedicated Node test proves missing issuance causes zero consume,
  checkpoint, or executor calls;
- the real CLI test proves no task-grant header is emitted during bootstrap,
  heartbeat, claim, approval request, or approval polling;
- the real Relay/Node/SQLite read test proves the dynamically issued token still
  completes exactly one bounded read.
