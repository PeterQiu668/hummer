# Relay P0d tenant-surface audit

## Outcome

One real P0 metadata leak was found and contained: SSE event IDs used a global
counter and exposed gaps caused by another tenant's active stream. ADR-034 moves
the counter into the existing `(tenantId, nodeId)` boundary and resets it when
that stream has no subscribers.

No payload crossover or cross-tenant store mutation was found. The Memory and
SQLite implementations consistently qualify queue, event, approval, audit,
and idempotency state by tenant. The HTTP adapter derives tenant identity from
the badge rather than paths or request bodies.

## Surfaces exercised

The `[TEN-P0D-RELAY-SURFACES]` suite uses two real tenant sessions and covers:

1. A tenant-B claim cannot see a queued tenant-A task, even when node IDs match.
2. Foreign task/work-order/request references and unknown tenant-B references
   return the same HTTP status and error body for stop, event submission,
   approval request, decision, and consumption.
3. A token bound to another node receives the same `node_mismatch` result for a
   real foreign node ID and a missing node ID.
4. Foreign and unknown retry sources return the same store/service rejection.
5. Event and approval reads return empty/null outside the owning tenant; audit
   reads remain empty and failed probes create no entries.
6. Both tenants may independently use identical task, idempotency, event, and
   approval IDs in Memory and SQLite.
7. Concurrent A/B SSE connections receive only their own payloads and each see
   their own `1..N` IDs. `Last-Event-ID` is ignored on reconnect and never
   selects or compares another stream.

Status and response equality close identifier-existence oracles at the
application boundary. The suite intentionally avoids flaky wall-clock timing
thresholds and does not claim constant-time networking or database execution.

## Receipt boundary

There is no receipt route or receipt store method under `apps/relay`. Relay's
public HTTP paths end at node registration/heartbeat, task enqueue/claim/events/
stop, approval request/decision/consume, and SSE notifications. Receipt
assembly, verification, and export remain outside Relay, so there is no Relay
receipt reference to probe or newly expose in this change.

## Commands

```powershell
npm.cmd run test:p0d-surfaces -w @hummer/relay
npm.cmd run typecheck -w @hummer/relay
npm.cmd run test -w @hummer/relay
```

Relay schema stays at 13. No quota, export, chain, receipt, desktop, or root
script/package work is part of this containment.
