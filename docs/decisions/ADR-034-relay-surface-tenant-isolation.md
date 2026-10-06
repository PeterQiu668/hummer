# ADR-034: Relay surface metadata is isolated by tenant and node

- Status: Accepted as P0 containment
- Date: 2026-10-07
- Scope: Existing Relay HTTP, SSE, queue, event, approval, and audit surfaces

## Context

The W4 P0d audit tested whether a valid tenant-B badge could use a tenant-A
node or object reference to observe, mutate, subscribe to, or infer tenant A's
state. Store and HTTP operations were already tenant-qualified, but the SSE
broker assigned event IDs from one process-global counter.

With active A and B subscriptions, an A event received ID 1, a B event received
ID 2, and A's next event received ID 3. A never received B's payload, but the
gap disclosed cross-tenant notification activity. This is a P0 metadata side
channel even though SSE IDs are not execution authority.

Relay has no receipt read, write, cache, or export route. Outcome receipts
remain HUMMER-owned; node integration may transport them onward but the Relay
surface audited here neither accepts nor persists receipt references.

## Decision

1. `FleetSseBroker` sequences events independently for each
   `(tenantId, nodeId)` stream key. A publish in another tenant or node cannot
   change the next visible ID.
2. The sequence is removed when the last subscriber for that stream closes.
   Reconnect begins a new notification-only sequence.
3. `Last-Event-ID` remains deliberately ignored. It is neither authorization
   nor a replay cursor, is never compared across streams, and cannot influence
   the new stream's counter. Durable replay remains out of scope.
4. Tenant identity continues to come only from authenticated badge claims.
   Route and payload identifiers never select a tenant.
5. Foreign and unknown references have the same tenant-local result for stop,
   retry, event, approval request/decision/consumption, store reads, and audit
   reads. Tests compare status/code/message or null/empty results; they do not
   claim cryptographic constant-time HTTP handling.
6. Memory and SQLite must exhibit the same behavior, including tenant-scoped
   idempotency caches and identical identifiers in different tenants.
7. This containment adds no endpoint, schema, migration, quota, audit export,
   chain head, receipt feature, or shared-contract change. Relay schema remains
   version 13.

## Consequences

- SSE IDs are meaningful only inside one live tenant-node subscription epoch.
- Consumers must not treat SSE IDs as durable offsets. Every reconnect still
  reauthenticates and obtains current task authority through normal Relay calls.
- The fix removes an activity leak without changing `FleetTransport` or the
  Fastify boundary.
- The broader W4 P0 stop remains in effect; this ADR does not authorize paused
  governance features.

## Verification

The stable suite marker is `[TEN-P0D-RELAY-SURFACES]`.

```powershell
npm.cmd run test:p0d-surfaces -w @hummer/relay
npm.cmd run typecheck -w @hummer/relay
npm.cmd run test -w @hummer/relay
```

The pre-fix regression produced A stream IDs `1,3` after one B publish. The
fixed behavior produces A `1,2`, B `1`, keeps payloads disjoint, and resets an
A reconnect to `1` even when it supplies `Last-Event-ID: 999999`.
