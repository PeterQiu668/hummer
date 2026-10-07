# ADR-064: Revalidate approved work at explicit executor checkpoints

- Status: accepted
- Date: 2026-10-07
- Scope: Relay approval lifecycle and Node Agent execution control

## Context

An immutable `approved` decision proved who granted a bounded action, but it
could not represent a later withdrawal without rewriting history. The Node
Agent also treated a claim as terminal before its executor returned, so a
Relay stop or revocation could not prevent later side effects from a long
executor. SSE delivery alone is insufficient because a node can disconnect
and miss the notification.

## Decision

Approval decisions remain immutable. A later human/account withdrawal is a
separate append-only `ApprovalRevocationRecord` bound to the same tenant and
request. Memory and SQLite stores atomically choose between revocation and task
completion; successful revocation moves an active task to `failed`, clears its
lease, appends a tenant audit event, and rejects late events or completion.

The Node Agent passes every executor an `AbortSignal` and an asynchronous
`authorization.checkpoint()`. It checks Relay authority before execution,
before each returned event, before the receipt, and before completion. Runtime
adapters must additionally call the checkpoint immediately before every
high-risk side effect. Local expiry, Relay stop, and post-approval revocation
become explicit `approval_expired`, `relay_stop`, or `approval_revoked`
terminal reasons.

Relay publishes `approval.revoked` over the tenant/node-scoped SSE stream only
as a latency hint. Every checkpoint also calls the authenticated authorization
projection, so reconnect and missed-event behavior fail closed.

The Workbench derives the displayed action, object, expiry, and maximum-use
copy from the stored approval scope and exposes one explicit revoke button.
Renderer code supplies only the request identifier; tenant and actor continue
to come from the authenticated control badge and trusted Desktop main process.

## Contract and migration impact

No `@hummer/contracts` v1 object, receipt format, or Desktop v1-v10 migration
is changed. Relay schema v16 adds only the append-only
`fleet_approval_revocations` table and no-update/no-delete triggers. The Relay
port gains additive revocation and authorization-query methods. Existing
executor functions remain callable because the additional authorization input
is additive, but a transport without authoritative authorization lookup is now
rejected at Node Agent construction.

## Consequences and limits

- Approved work can be stopped within one explicit checkpoint, including when
  an SSE notification is missed.
- A checkpoint does not consume `CapabilityGrant.maxUses`; it observes the
  already-authorized approval lifecycle.
- Revocation prevents new work after the next checkpoint. It cannot roll back
  an irreversible side effect completed before that checkpoint.
- Production runtime adapters must place checkpoints at their real side-effect
  boundaries. The deterministic two-step executor proves the port semantics,
  not every future adapter.
- This remains local loopback evidence; external TLS, production identity, and
  two-machine operation are separate acceptance gates.
