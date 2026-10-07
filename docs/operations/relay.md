# Fleet Relay core operations (Phase 0 D3)

## Current boundary

This increment includes the storage/application core plus a bounded Fastify 5
HTTP and SSE adapter. It is not two-machine evidence. `FleetTransport` remains
the delivery port; the core does not import Fastify, WebSocket, Electron, a
runtime, or agent-hub code. WSS remains a future adapter because the Phase 0
control and notification flow does not justify another protocol dependency.

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

Heartbeat lease accounting is also fail closed. In one store operation Relay
evaluates/reclaims leases at `leaseExpiresAt <= receiveNow`, then requires the validated
`NodeManifest.load.running` to equal that node's remaining active lease count.
`heartbeat_load_mismatch` does not renew `lastSeenAt` or online status. Node
liveness changes to offline at exactly `receiveNow - lastSeenAt >= 60_000ms`.

Relay receive time is monotonic store state. Equal observations are accepted;
clock rollback is rejected as `clock_regression`, while a forward jump is
authoritative and immediately evaluates liveness, task expiry, and lease expiry.
Task expiry is normalized to UTC ISO milliseconds before storage. Run-event
`occurredAt` never controls timers and must fall inside the current lease window;
this rejects an ordinary late event from a previous retry attempt without adding
fields to the frozen fleet contract. See ADR-022 for the residual same-node
restamping limitation.

## HTTP, badge token, and stream boundary

The Fastify adapter exposes only the Phase 0 operations needed to register and
heartbeat a node, enqueue and claim a task, append a generic run event, append
the stricter `started`/`completed`/`failed` events, stop a task, and subscribe to
node notifications. Contract payloads still flow through
`createSharedFleetValidators`; the adapter does not maintain another fleet
schema. Body size is capped at the shared 64 KiB limit. Body-less claim and stop
commands reject any unknown field.

Bearer credentials are short-lived opaque badge tokens. The included static
authenticator is a test/development substitute, not production identity
authentication, and retains only SHA-256 token fingerprints. Each resolved badge is
bound to one tenant, an actor, an explicit scope set, an expiry, and optionally
one node. Node routes require the token's `nodeId` to match the route and shared
contract body. Control routes derive tenant identity from the badge rather than
caller input. Missing, malformed, unknown, expired, under-scoped, cross-tenant,
and cross-node requests fail closed.

`GET /v1/nodes/:nodeId/events` is an SSE stream for `task.available` and
`task.stop`. Subscribers are keyed by `(tenantId, nodeId)`, removed on socket
close, and forcibly ended at badge expiry. `Last-Event-ID` is not an authority:
every reconnect must present and revalidate a badge. Durable replay and WSS are
not claimed by this slice.

## Stores and migration alignment

- `MemoryFleetStore` is the deterministic contract-test implementation.
- `SqliteFleetStore` enables WAL, foreign keys, and a 5-second busy timeout.
- Relay migration marker `11` creates `fleet_nodes`, `fleet_tasks`,
  `fleet_task_leases`, `fleet_run_events`, and `relay_audit`.
- Relay-only migration marker `12` adds the singleton `relay_clock` high-water
  table. Relay-only marker `13` adds append-only `fleet_approval_requests`,
  `fleet_approval_decisions`, and `fleet_approval_consumptions`; it does not
  modify or share the desktop database or its migration registry.
- Relay-only marker `14` adds tenant audit chains and heads, daily tenant-node
  quota counters, and immutable audit export manifests. Relay and desktop use
  separate databases and migration registries; desktop v12/v13 does not collide
  with Relay v14. See ADR-040, ADR-041, and `relay-governance.md`.
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

## Approval binding ledger

ADR-023 requires a node badge to append one request for its active lease, a
human/account control badge to append one decision, and the bound node to
atomically consume that approved decision once while the lease is still active.
Capabilities, paths, maximum uses, and expiry can only narrow. The request,
decision, and consumption are protected by no-update/no-delete triggers and
remain separate immutable records.

Approval decisions are never delivered as SSE authority. The node must read and
consume the persisted bundle over an authenticated Relay request. The static
human badge in tests demonstrates this route shape only; replacement with a
real issuer and revocation source remains required before production use.

## Verification

From the repository root:

```powershell
npm.cmd run typecheck -w @hummer/relay
npm.cmd run test -w @hummer/relay
```

The suite runs the same store behaviors against both memory and SQLite stores,
plus shared-contract adapter and real Fastify/node integration tests. Negative
cases cover unknown fields, tenant mismatch, exact
offline and expiry boundaries, heartbeat/lease disagreement, Relay clock rollback,
forward jumps, late prior-attempt events, offset timestamps, stale nodes,
wrong lease ownership, sequence gaps, completion without an artifact, stopped
tasks, expired tasks, retry-key reuse, wrong/expired/under-scoped badge tokens,
cross-node binding, and unauthorized SSE reconnect after disconnect. A 10-task scenario double-delivers
every envelope and completion event, then proves exactly ten claims and ten
stored completion events on one store instance. A separate fault-injection case
replays the same task and each run-event key 100 times and proves one claim and
one stored completion.

## Runnable local daemon

`hummer-relay start --config <absolute-json>` starts the same SQLite store,
service, shared validators, and Fastify transport described above. Its strict
v1 config accepts only `127.0.0.1`, an absolute database path, and badge
metadata whose `tokenEnv` fields point to environment variables. Token values
in config and unknown fields are rejected. npm package `bin` metadata produces
the Windows `.cmd` shim; a source checkout can run
`node apps/relay/bin/hummer-relay.mjs start --config ...` after
`npm run build:cli -w @hummer/relay`.

This bootstrap is intentionally loopback-only. Do not expose it publicly or
describe it as TLS/IdP deployment evidence.

## Remaining integration work

1. Add WSS only if measured duplex traffic or deployment constraints require it;
   SSE is the implemented Phase 0 event channel.
2. Replace the in-process static badge registry with the deployment identity
   issuer/revocation source; do not put plaintext tokens in config committed to Git.
3. Run two real nodes through disconnect/reconnect, independent-process clock
   skew, competing claims, and 100-task duplicate-delivery tests. Include a
   same-node restamped old-attempt event probe. Until that evidence exists, do
   not describe the two-machine portion of D3 or AC-P0-04 as complete.
4. Run the Postgres/RLS spike against a real Postgres instance and two database
   roles. It remains pending; SQLite tenant predicates are not RLS evidence.
