# ADR-025: In-doubt node attempts require immutable operator adjudication

- Status: Accepted for W3
- Date: 2026-10-07
- Scope: `apps/node-agent` recovery control plane

## Context

ADR-024 deliberately leaves every non-terminal journal claim in
`recovery_required` after restart. In particular, a durable `executing` record
does not prove whether its external side effect happened. Automatically
replaying that attempt could duplicate a write; silently discarding it would
erase the operational decision and its accountability.

Relay already requires a retry to be a distinct task with a new idempotency key
in the same WorkOrder/origin lineage. The node needs a local, append-only bridge
between an in-doubt attempt and that separate Relay retry flow.

## Decision

1. `inspectRecovery` exposes a redacted view of an in-doubt journal claim. It
   returns identifiers, journal stage, and envelope hash only.
2. A recovery decision requires an explicit `human:*` or `account:*` actor and
   a safe machine-readable reason code. `system:*`, task data, SSE, and approval
   decisions are not recovery authorities.
3. `abandonRecovery` appends `recovery_abandoned`. The original attempt is
   permanently closed and cannot consume approval or execute after restart.
4. `authorizeRecoveryRetry` appends `recovery_retry_authorized` and generates a
   fresh retry attempt ID and retry idempotency key. The record links them to
   the old claim and WorkOrder.
5. Retry authorization is not retry execution. It makes no transport,
   approval-consumption, or executor call. A separate authenticated Relay
   operator action must block the old task and enqueue a new TaskEnvelope using
   the generated key; that new claim requires its own approval.
6. Recovery records use the existing canonical JSONL SHA-256 chain and durable
   append. They are immutable terminal resolutions for the old attempt. A
   second resolution, an identifier collision, or a journal append failure
   fails closed.
7. Existing journal records, Fleet contracts, Relay schema, and desktop schema
   remain unchanged.

## Safety properties and limitations

- The old claim is never retried in place and journal history is never
  rewritten.
- A restart reconstructs the same resolution and continues to block execution
  of the old claim.
- Fresh retry lineage prevents reuse of the old idempotency identity, but does
  not prove that retry is semantically safe. That judgment remains with the
  authenticated operator and their external evidence.
- This ADR does not make the node journal Byzantine-proof and does not add a
  network identity provider. ADR-024's intact-file and single-writer limits
  remain.

## Verification

- Recover an `executing` claim and prove inspect, poll, confirmation, and
  approval paths call the executor zero times.
- Append abandon and retry-authorized decisions, verify their hash-chain link,
  reconstruct the agent, and prove the decisions persist.
- Prove `system:*`, unsafe reason text, unknown/terminal claims, conflicting
  second decisions, identifier collisions, and tampered decision bytes fail
  closed without repairing or truncating the journal.
