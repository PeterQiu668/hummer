# Fleet Relay core operations (Phase 0 D3)

## Current boundary

This increment is the storage and application core behind the Relay. It is not a
network server and it is not two-machine evidence. `FleetTransport` is the only
port a later Fastify 5 + WSS/SSE adapter may implement. The core does not import
Fastify, WebSocket, Electron, a runtime, or agent-hub code.

The Relay is a thin delivery plane. HUMMER remains the source of truth for work
orders, approvals, results, receipts, and capabilities. A transport adapter must
derive `tenantId` from its authenticated session; caller-supplied tenant context
is never authoritative. `SqliteFleetStore` uses a dedicated Relay database; it
must not point at the desktop `hummer.sqlite3`. The shared names in the v11
integration contract describe compatible semantics, not a shared physical
database or a second owner of HUMMER product facts.

## Contract validation boundary

`FleetService` accepts a `FleetValidators` dependency. Every inbound node
manifest, heartbeat, task envelope, and run event passes that dependency before
the Relay reads routing claims or writes storage. The Relay intentionally does
not contain a second list of shared contract fields. `createSharedFleetValidators`
binds these ports to the TypeBox/Ajv validators exported by `@hummer/contracts`.
Heartbeat uses the same validated `NodeManifest`; the Relay projects only
`nodeId` and `load.running` from it.

Validation failures, tenant mismatches, unknown/offline nodes, expired tasks or
leases, wrong lease owners, sequence gaps, and illegal state changes fail closed
with a `FleetRejectedError` code. Duplicate task/event delivery returns the
first stored result only when the canonical validated payload is identical. A
reused key with different content is rejected as `duplicate_delivery`; it never
silently aliases two commands.

## Stores and migration alignment

- `MemoryFleetStore` is the deterministic contract-test implementation.
- `SqliteFleetStore` enables WAL, foreign keys, and a 5-second busy timeout.
- Relay migration marker `11` creates `fleet_nodes`, `fleet_tasks`,
  `fleet_task_leases`, `fleet_run_events`, and `relay_audit`.
- `fleet_task_leases` contains the integration columns
  `tenant_id/task_id/node_id/delivery_id/idempotency_key/envelope_json/state/lease_expires_at/attempt/result_json/created_at/updated_at`, with tenant-scoped unique keys for delivery and idempotency.
- `fleet_tasks` and `fleet_run_events` are Relay-owned supporting tables. The
  desktop v11 migration remains an integration-owner change and is deliberately
  not edited here.

Each store method requires `tenantId`. SQLite reads and writes use an explicit
tenant predicate. A stale node is marked offline before claim/event decisions.
An expired lease returns its task to `queued`; the next valid claim increments
`attempt` without creating another task. Stop moves a nonterminal task to
`blocked` and writes `relay_audit`. Retry accepts a fully validated new envelope
and requires a new idempotency key while preserving the work-order/origin
lineage; prior approvals are not copied.

## Verification

From the repository root:

```powershell
npm.cmd run typecheck -w @hummer/relay
npm.cmd run test -w @hummer/relay
```

The suite runs the same 20 store behaviors against both memory and SQLite stores,
plus three shared-contract adapter assertions (43 tests total). Negative cases cover unknown fields, tenant mismatch, stale nodes,
wrong lease ownership, sequence gaps, completion without an artifact, stopped
tasks, expired tasks, and retry-key reuse. A 10-task scenario double-delivers
every envelope and completion event, then proves exactly ten claims and ten
stored completion events on one store instance.

## Remaining integration work

1. Add the Fastify/WSS adapter and SSE fallback behind `FleetTransport`.
2. Add authenticated session and short-lived badge-token middleware.
3. Run two real nodes through disconnect/reconnect, clock skew, and 100-task
   duplicate-delivery tests. Until that evidence exists, do not describe D3 or
   AC-P0-04 as complete.
