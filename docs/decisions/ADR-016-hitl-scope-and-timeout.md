# ADR-016: Approval grants are human, scoped, expiring, and non-transitive

- Status: Accepted for Phase 0
- Date: 2026-10-07
- Milestone: D1 / AC-P0-02

## Context

Remote execution creates two dangerous ambiguities: whether an approval authorizes the task or only one action, and whether a node may keep using approval after a disconnect, retry, or timeout. Existing ADR-003 and ADR-009 establish immutable human decisions and a runtime-enforced write gate. Fleet execution must preserve those semantics across devices.

## Decision

1. An `ApprovalRequest` names one tenant, WorkOrder, node, run, risk class, action, target, requested scope, requester, and expiry. Unknown actions use risk class `unknown` and are treated as the highest risk.
2. Requests may be emitted by `system:*`, `employee:*`, or `twin:*`. `human:*` is rejected as a request actor because a request record describes the bounded executor seeking authority, not the accountable approver.
3. An `ApprovalDecision` is immutable. Its decision is `approved`, `denied`, `expired`, or `revoked`. `approved` and every other decision record must identify a `human:*` or authenticated `account:*` actor. A `system:*` decision is invalid and triggers a security alert.
4. Approval authorizes only the named protected action and granted scope. It is not proof that the action executed, not confirmation of the parent task, and not authority to change approval policy.
5. Granted scope may narrow capabilities, paths, expiry, and maximum uses. It cannot broaden the request. It is tenant-, request-, run-, and node-bound; it cannot be reused across tenants, tasks, nodes, runtime sessions, or retries.
6. After `RunEvent.type = needs_approval`, that run cannot emit progress or artifacts until a matching decision is accepted. A denied, expired, or revoked decision permits only a terminal failure or cancellation path.
7. Expiry is fail-closed. No node, Relay, retry worker, or runtime may silently extend a decision or automatically retry a high-risk action. A new attempt after expiry requires a new request and human decision.
8. A decision does not mutate the historical request. Protected action execution emits a separate event and evidence record, preserving the distinction between authorization and execution established by ADR-003.

## Consequences

- Disconnection and lease recovery cannot convert an old approval into ambient authority.
- Automatic expiration may be projected as operational state, but the persisted `ApprovalDecision` still requires a human/account actor under the v0.1 contract. A future system-authored expiry fact requires a distinct event type and ADR rather than impersonating a decision maker.
- Notification routing and user experience may change without weakening the scope, actor, or expiry rules.

## Verification

`npm run test:contract` includes mandatory failures for `system:*` decisions, human requesters, unknown fields, denied decisions carrying grants, progress while paused, and completion without an artifact. Runtime execution gates and notification behavior are verified in D4 and later chaos suites.
