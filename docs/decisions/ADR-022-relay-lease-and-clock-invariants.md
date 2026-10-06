# ADR-022: Relay lease accounting and clock invariants fail closed

- Status: Accepted for Phase 0
- Date: 2026-10-07
- Milestone: D3 / AC-P0-04

## Context

The frozen fleet contract already defines `NodeManifest.load.running` as the
unfinished lease count, lease expiry, per-WorkOrder event ordering, and
tenant-scoped idempotency. The initial Relay stored those values but did not
enforce heartbeat-to-lease equality or a deterministic policy when its wall
clock moved. It also selected the newest task by `workOrderId` for a `RunEvent`;
because the frozen event has no task, delivery, or attempt field, an event from
an older retry attempt needed an additional fail-closed association rule.

## Decision

1. Relay receive time is authoritative for node liveness, task expiry, and
   lease expiry. Node-authored timestamps are evidence and never extend these
   timers.
2. Each Relay store maintains a monotonic receive-time high-water mark. Equal
   timestamps are allowed. A timestamp below the high-water mark is rejected as
   `clock_regression` before the requested business mutation. A forward jump is
   accepted as authoritative and immediately applies every timeout boundary.
3. A node is offline when `receiveNow - lastSeenAt >= 60_000ms`. It is online at
   59,999ms and offline at exactly 60,000ms.
4. Before validating a heartbeat, Relay recovers leases whose
   `leaseExpiresAt <= receiveNow`. The reported `load.running` must then equal
   the number of remaining `leased` tasks owned by that tenant and node. A
   mismatch is rejected as `heartbeat_load_mismatch`; `lastSeenAt` and online
   status are not renewed, and the rejected heartbeat commits no lease mutation.
5. Expired-lease recovery and claim are serialized by the store. Recovery
   returns the same task to `queued`; exactly one successful claim increments
   its `attempt`, while a competing claim returns no task.
6. Task expiry timestamps are normalized to UTC ISO milliseconds before Relay
   storage. SQLite comparisons use parsed date-time values, so equivalent `Z`
   and offset forms have the same exact-millisecond boundary.
7. Without changing the frozen `RunEvent` fields, Relay associates a new event
   only with the current leased task for its WorkOrder and requires
   `occurredAt` to fall within that lease's calculated start and Relay receive
   time. A late event timestamped in an earlier attempt is rejected as
   `invalid_transition`.
8. Exact duplicate task or event payloads keep returning the first stored
   outcome. Repeating the same idempotency key 100 times does not create a
   second task, claim, start, artifact, or completion fact.

## Storage boundary

`RELAY_SCHEMA_VERSION = 12` is only the schema version of the dedicated Relay
database owned by `SqliteFleetStore`. Version 12 adds the singleton
`relay_clock` high-water table and a Relay migration marker. It is not a desktop
migration, does not open or modify `hummer.sqlite3`, and does not change desktop
migrations v1-v10.

## Consequences and limits

- No serialized fleet field or version changes, so the frozen v1 contract and
  machine-checked field table remain unchanged.
- Clock rollback fails availability closed until wall time catches the stored
  high-water mark or an operator follows a separately approved recovery
  procedure. Relay does not silently rewind timers.
- The event-window check blocks ordinary delayed events from an older attempt.
  The current v1 contract cannot cryptographically prevent the same node from
  restamping an old event into a newer lease window. Cross-process and
  two-machine evidence must keep this residual risk explicit; a future attempt
  token would require a separately approved contract version.

## Verification

The Relay suite runs the same invariant tests against `MemoryFleetStore` and
`SqliteFleetStore`: 59,999/60,000ms offline boundaries, heartbeat under/over
reporting, exact-boundary lease recovery with competing claims, rollback and
forward-jump behavior, offset task expiry, retry plus late-old-attempt event,
and 100 duplicate deliveries with one completion.
