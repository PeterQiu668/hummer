# ADR-023: Relay owns the Phase 0 approval binding ledger

- Status: Accepted for Phase 0
- Date: 2026-10-07
- Milestone: D3/D4 approval boundary

## Context

The frozen `ApprovalRequest` and `ApprovalDecision` contracts describe the
wire facts, but the first node skeleton accepted any locally supplied,
contract-valid decision in `confirmAndExecute`. There was no durable Relay
association between the pending claim and its tenant, WorkOrder, node, run,
action, requested scope, human decision, or one-time use. An SSE payload or
other local caller could therefore be mistaken for control-plane authority.

The five Phase 0 Fleet contracts are frozen. The desktop migrations v1-v11 are
also owned by the desktop integration and cannot be repurposed as a Relay
database.

## Decision

1. The Relay adds three Relay-only append-only tables:
   `fleet_approval_requests`, `fleet_approval_decisions`, and
   `fleet_approval_consumptions`. They live only in the dedicated Relay SQLite
   database. Relay migration marker 12 does not modify or share the desktop
   v1-v11 database.
2. A node-bound badge with `approval.request` may append a request only for a
   currently leased claim owned by that same tenant and node. The authenticated
   actor must equal `requestedBy`; WorkOrder and node bindings must match the
   lease. The request stores the run, action, target, requested scope, and
   expiry without mutating the frozen wire object.
3. Only a non-node control badge whose authenticated actor is `human:*` or
   `account:*` and whose scope includes `approval.decide` may append the single
   immutable decision. The payload actor and tenant must match the badge.
   Static badges used by tests are an explicit test/development substitute;
   they are not a production identity service.
4. An approved grant must be a subset of requested capabilities and paths, may
   not exceed the requested maximum uses, and must expire no later than the
   request. Unknown fields, actor mismatch, cross-tenant lookup, expired
   request/grant, and a second decision fail closed.
5. A node-bound badge with `approval.consume` may atomically consume the
   approved decision once, only while the original claim still has an active
   lease owned by that node. Consumption appends a separate fact and never
   mutates the request or decision.
6. `HummerNodeAgent.confirmAndExecute(claimId)` accepts no decision argument.
   It fetches the request/decision bundle through the authenticated Relay,
   revalidates both with the shared validators, compares the returned request
   to its pending local request, then invokes the executor. A caller-supplied
   decision is rejected. SSE remains notification-only and never confirms or
   resumes execution.
7. The contract schemas and their fields remain unchanged. The new HTTP routes,
   store ports, and migration are Relay implementation interfaces governed by
   this ADR.

## Consequences

- Approval is now authorization for one bound protected action, not ambient
  authority and not proof of execution.
- A crash after consumption but before execution does not permit replay; a new
  claim/request/decision is required. This intentionally prefers fail-closed
  recovery over automatic retry.
- Production still needs a real issuer, revocation, and account-control-plane
  integration. The static badge registry proves authorization shape only.
- The Relay still is not the product WorkOrder database. It retains only the
  delivery-plane binding facts needed to prevent cross-claim approval reuse.

## Verification

- Memory and SQLite store suites exercise identical request, decision, expiry,
  subset, replay, and one-time-consumption behavior.
- Real Fastify plus `RelayHttpClient` plus `HummerNodeAgent` integration proves
  that a pending claim executes once only after a control-badge decision is
  persisted and fetched from the Relay.
- Negative integration cases cover unknown fields, system-authored decisions,
  cross-tenant access, scope expansion, expiry, second decision, local decision
  injection, and stop-before-execution.
