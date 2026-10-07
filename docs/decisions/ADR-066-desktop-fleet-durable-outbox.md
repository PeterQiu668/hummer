# ADR-066: Give Desktop Fleet dispatch a durable at-least-once outbox

- Status: accepted
- Date: 2026-10-07
- Scope: Desktop `StartWorkFlow` dispatch to Relay

## Context

The Desktop Relay bridge previously sent a `TaskEnvelope` directly after the
renderer invoked `enqueueTask`. A process crash before the HTTP request lost
the dispatch. A crash after Relay committed but before Desktop received the
response left Desktop unable to distinguish loss from acceptance. Retrying
without a retained immutable request also made payload drift possible.

This problem is limited to the Desktop path that sends work through Relay.
The intake confirmation path is a separate local runtime flow, and the Web
client still sends directly to Relay. Treating either as covered would
overstate the implementation.

## Decision

Append Desktop migration v16 with `fleet_dispatch_outbox`. Before network I/O,
the main process validates and canonicalizes the complete `TaskEnvelope`, then
commits an immutable row keyed by `(tenant_id, idempotency_key)`. A reused key
is accepted only for the same actor and SHA-256 payload. The database retains
all terminal history, rejects deletes and payload mutation, and constrains
pending, delivered, and rejected rows to valid column combinations.

Delivery is at-least-once. Startup and a bounded background loop replay active
membership rows in creation order. Concurrent calls in one Desktop process
single-flight by outbox id. Relay's existing tenant-scoped idempotency key
converges repeated HTTP requests to one logical task. A successful response is
accepted only when tenant, task id, and canonical envelope digest bind back to
the pending row. Expired requests and permanent 400/404/409/422 failures become
retained `rejected` rows; transient network, authentication, and server
failures remain pending.

The renderer session token is rejected anywhere inside the envelope before
persistence. Relay badge credentials remain owned by the main process and are
not written to the outbox. Replay rechecks active membership and therefore
fails closed after membership loss.

## Evidence and consequences

`npm run test:desktop:outbox` builds Desktop, runs the five focused Vitest
files, then kills a dedicated persistence process after its SQLite commit and
uses a fresh process to recover the pending row. The integration gate also
simulates a response lost after Relay acceptance and proves byte-identical
replay with `inserted: false`.

This does not provide transport exactly-once. It provides durable at-least-once
requests and effectively-once logical Relay task creation under Relay's
idempotency contract. It does not cover browser/mobile clients, intake
confirmation, a packaged Electron kill, or a transaction spanning a separate
local WorkOrder fact. Those require their own gates before broader claims.

## Contract and migration impact

No file under `packages/contracts/**` or
`docs/architecture/api-contract.yaml` changed. Desktop migration v16 is
append-only; migrations v1-v15 are unchanged. Relay's independent schema
version is unaffected.
