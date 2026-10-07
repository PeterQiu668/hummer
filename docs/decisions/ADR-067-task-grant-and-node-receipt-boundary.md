# ADR-067: Separate node identity, task grants, approval, and receipt durability

- Status: Accepted for Phase 1 hardening
- Date: 2026-10-07
- Milestone: Node execution authorization foundation

## Context

The Node Agent previously held two secrets but the real HTTP client sent only
the long-lived node badge. The local `grantScopes` list was therefore a
self-assertion, `TaskEnvelope.grantRef` was not checked by Relay, and
`submitReceipt()` returned successfully without persisting anything. Wiring a
runtime executor on top of those seams would have allowed execution without a
server-verified task grant and completion without a durable receipt.

The existing grant registry also counted every successful bearer
authorization as one use. Reusing that behavior for heartbeats, event uploads,
and revocation checkpoints would exhaust a one-use execution grant before the
approved action finished.

## Decision

1. Node identity and task authority are separate credentials. The ordinary
   `Authorization: Bearer` badge authenticates the node and its Relay route.
   The opaque task grant is sent only to the two task-grant routes in
   `x-hummer-task-grant`; it is never put in a URL, body, log, receipt, event,
   or diagnostic.
2. Relay derives the authorization context from persisted facts, not the node
   request: leased task, `TaskEnvelope.grantRef`, approval request, human/account
   decision, active approval authorization, tenant, node, WorkOrder, run,
   capabilities, and paths.
3. `consume` atomically validates those bindings and increments `usedCount`
   once. A one-use grant becomes exhausted. `checkpoint` is non-consuming and
   is allowed only after a successful consume for that bound run; expiry,
   rotation, and revocation still fail immediately. A second consume fails.
4. The Node Agent independently rejects an approval decision that widens the
   requested capabilities, paths, use budget, or expiry. It also verifies every
   task-grant response against the active tenant/node/WorkOrder/run/grantRef and
   exact approved scope before invoking the executor.
5. Portable OutcomeReceipt verification lives in
   `@hummer/outcome-receipts`. Relay maps its uniform failure to the existing
   trust error; Node Agent uses the same verifier. Envelope, manifest, and
   receipt-body unknown fields are rejected, and all field/root hashes plus the
   disclosed domain-event chain and accepted outcome binding are recomputed.
6. Node Agent config version 2 adds an absolute `receiptRoot`. The daemon
   initializes a tenant/node-scoped marker and persists each verified receipt
   as canonical JSON using create-only `wx` plus file `fsync`. Existing files
   are never overwritten. A missing store fails closed.
7. Non-terminal RunEvents are sent first, then the verified receipt is durably
   persisted, then the terminal `completed` event is sent. Receipt persistence
   failure prevents the terminal event.

## Consequences and limits

- A stolen node badge is insufficient to authorize execution; a stolen task
  grant is insufficient without the bound node badge and approved persisted
  context.
- Checkpoints do not replenish or spend the one-use execution budget.
- Relay CLI provisioning of durable grant snapshots/rotation remains a
  separate control-plane slice. Until it is wired, the task-grant routes must
  receive an injected `TaskGrantAuthenticator` and otherwise return 503.
- The production runtime executor remains `executor_unavailable`. This ADR
  does not authorize Codex, Claude, shell, container, network, write, spend,
  delete, or privilege actions.
- The receipt proves internal hash consistency, not signer identity,
  non-repudiation, or trusted time.

## Verification

```powershell
npm.cmd run typecheck -w @hummer/node-agent
npm.cmd test -w @hummer/node-agent
npm.cmd run test:grants -w @hummer/relay
npm.cmd test -w @hummer/relay
npm.cmd run test:daemons
```

Negative cases cover missing/wrong badges, missing/wrong/reflected task tokens,
pre-consume checkpoints, second consume, foreign run/grant binding, expanded
approval scope, revocation, tampered receipts, unknown receipt fields,
tenant/node receipt-root reuse, duplicate receipt writes, and receipt-write
failure before terminal completion.
