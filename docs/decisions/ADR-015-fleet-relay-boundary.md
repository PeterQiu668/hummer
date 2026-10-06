# ADR-015: Fleet Relay is a transport and lease boundary

- Status: Accepted for Phase 0
- Date: 2026-10-07
- Milestone: D1 / AC-P0-01

## Context

HUMMER must dispatch a pending task to multiple devices and runtimes without merging agent-hub, runtime sessions, or device inventory into one application. The existing `hummer.work-order-task` intake is human-confirmed and tenant-scoped, but it has no remote node description, lease, idempotent delivery envelope, or runtime event contract.

## Decision

1. HUMMER remains authoritative for WorkOrders, approvals, results, receipts, and capabilities. agent-hub remains authoritative for device identity, common policy, and backup. Codex, Claude, DeepSeek, and other runtimes remain authoritative for their own sessions. No layer imports another layer's implementation code.
2. Fleet Relay implements transport and lease coordination behind `FleetTransport` and `FleetStore` ports. It does not become a product fact store and does not reinterpret `hummer.work-order-task` version 1.
3. A node registers a `NodeManifest` version 1. `nodeId` maps one-to-one to the agent-hub device ID, but the manifest is a HUMMER contract and contains no agent-hub implementation type.
4. Relay creates a `TaskEnvelope` version 1 by embedding the original structured task. It overwrites caller tenant identity with the authenticated session tenant and defaults missing or unknown approval policy to the strictest policy.
5. Every task received from a file, API, Relay, capability package, or replay starts as `pending`. Registration, delivery, lease acquisition, or runtime availability never constitutes human confirmation.
6. Delivery is idempotent by `(tenantId, idempotencyKey)`. Exact duplicate delivery returns the original outcome without appending an event. Reusing the key for different content is rejected.
7. A lease is bounded by `leaseMs`. Expiry returns an unfinished task to `queued`; it does not extend an approval, auto-confirm an intake, or prove that prior work did not occur. Completed and failed task facts arrive as ordered `RunEvent` records.
8. Node capabilities are claims to be checked against current runtime probes and Relay policy. A manifest is not authority to execute a protected action.
9. Contract payloads are limited to 64 KiB UTF-8 and reject unknown fields and unsupported versions. Artifact bytes remain outside Relay messages and travel by content-addressed evidence references.

## Consequences

- Node agents and Relay can be replaced independently of the HUMMER product domain.
- A disconnected node can recover through lease and idempotency rules without duplicate product events.
- This ADR freezes only the Phase 0 fleet contracts. It does not claim the Relay, node agent, two-machine test, or database migration is implemented.
- Storage implementation, heartbeat timing, jitter handling, and WSS/SSE deployment belong to later D2/D3 work and must preserve this boundary.

## Verification

`npm run test:contract` validates the TypeBox/Ajv contract source, strict field rejection, serialization limit, idempotent replay helper, and RunEvent ordering rules. Cross-machine zero-duplicate execution remains a D3 acceptance test.
