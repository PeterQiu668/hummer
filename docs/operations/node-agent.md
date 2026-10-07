# HUMMER Windows node agent (Phase 0 D2 skeleton)

Status: local alpha skeleton with the frozen D1 contract adapter. This document does **not** claim that a network Relay, two-machine display, 60-second offline detection, or cross-machine execution has passed. Those gates still require transport integration and real-device evidence.

## Boundary

`apps/node-agent` is a Node 22 single-process boundary for a future Fleet Relay. It owns only local runtime discovery, heartbeat scheduling, claim staging, approval-gated execution handoff, and a naming/authorization facade for trusted local tools.

The package engine range is pinned to Node 22.x. Running its development checks under another Node major is not packaging evidence; the eventual D6 installer must bundle or provision the pinned runtime.

It does not own Fleet business contracts, task/approval/result facts, credentials, runtime sessions, or production execution. The node imports none of agent-hub, Electron, a runtime SDK, or a Relay implementation. Transport, shared contract validation, and execution are injected ports.

The implementation preserves these rules:

- `NodeManifest`, claimed tasks, approval decisions, run events, and outcome receipts are all validated by the injected shared contract validator. Invalid data does not cross the transport boundary.
- A valid claimed task is staged as `pending_confirmation`. Claiming never confirms or executes it.
- Execution requires an unexpired capability grant with `task.execute` plus a Relay-persisted shared-contract approval by a `human:*` or `account:*` actor for that exact claim and tenant. Its `grantedScope` must independently include an unexpired `task.execute` capability.
- A terminal claim is never executed twice. Claims are recorded in an injected execution journal; failures are reported and are not automatically retried.
- Restart recovery is durable at-most-once, not distributed exactly-once. A recovered non-terminal claim is `recovery_required` and is never automatically retried.
- The short-lived grant token is private process state. Status objects, probe output, exceptions, and documentation never include it.
- Unknown claim fields, unknown runtime providers, unknown tools, missing scopes, expired grants, and non-human approvals fail closed.

## Runtime probes

The probe reports `provider`, `status`, `path`, `version`, and an explicit diagnostic for four runtime classes:

1. `codex`
2. `claude`
3. `deepseek`
4. `cli-other`, which requires an explicit executable name or path

Run the local probe on Windows:

```powershell
apps\node-agent\hummer-node.cmd probe --other-executable my-agent-cli
```

A missing runtime is a normal reported state, not a silent fallback. An unknown provider is rejected before any process lookup. Native binaries are checked with `execFile`; Windows `.cmd`/`.bat`/`.ps1` shims use a fixed non-interactive PowerShell command with the resolved path passed only through an environment variable, avoiding command-string interpolation. Version probes receive an allowlisted process environment rather than inheriting credentials from the node process.

## Heartbeat and transport port

The heartbeat interval is restricted to 15–30 seconds. The injected `FleetTransport` supplies seven operations:

- `sendHeartbeat(manifest, context)`
- `claimTask(context)`
- `reportClaimStatus(status, context)`
- `submitRunEvent(event, context)`
- `submitReceipt(receipt, context)`
- `submitApprovalRequest(claimId, request, context)`
- `consumeApprovalDecision(claimId, requestId, context)`

`context` carries the node/tenant binding and the ephemeral grant token to the transport adapter. Adapters must redact the token and must not put it in logs, evidence, diagnostics, URLs, or argv. The Relay, not this skeleton, determines the 60-second offline projection and must exclude offline nodes from dispatch.

The heartbeat timer does not trigger task execution and does not perform an automatic retry after an error. Starting it requires an error callback, so a failed heartbeat cannot be silently swallowed; operators and the Relay must observe connection health explicitly.

## Claim flow

```text
Relay claim (unknown bytes)
  -> exact local delivery wrapper validation
  -> injected TaskEnvelope contract validation
  -> durable claim/delivery/WorkOrder/envelope-hash journal record
  -> pending_confirmation status
  -> node badge appends the bound ApprovalRequest to Relay
  -> durable approval-request ID/hash journal record
  -> human/account control badge appends immutable ApprovalDecision to Relay
  -> node badge atomically reads/consumes the bound decision from Relay
  -> ApprovalRequest and ApprovalDecision contract validation
  -> grant expiry/scope check
  -> durable decision-consumed + executing journal records
  -> injected executor at most once per intact journal
  -> injected RunEvent(s) and OutcomeReceipt transport
  -> durable receipt-hash + terminal journal record
```

`createSharedFleetContractValidator` now binds `NodeManifest`, `TaskEnvelope`, `ApprovalRequest`, `ApprovalDecision`, and `RunEvent` directly to `@hummer/contracts`. The existing v1 outcome-receipt verifier remains an injected authority because OutcomeReceipt is not redefined as a sixth Fleet contract.

`confirmAndExecute(claimId)` deliberately has no decision parameter. It accepts
only the request/decision bundle returned by the authenticated Relay consume
route, revalidates both frozen contracts, and checks that the returned request
is exactly the one staged for the pending claim. Passing a local decision is a
hard error. SSE may wake polling or stop a claim, but it never carries approval
authority or triggers execution.

## Execution journal and restart recovery

`HummerNodeAgent` requires an `ExecutionJournal`. `FileExecutionJournal` is the
local durable implementation and `MemoryExecutionJournal` is available for
tests. A file journal is scoped to exactly one tenant and node. It uses
canonical append-only JSONL with a SHA-256 hash chain and flushes every append
before returning. It stores only IDs, hashes, state, and safe reason codes; it
does not store the capability token, raw contracts, credentials, or receipt
body.

Startup verifies every line and refuses tampering, truncation, invalid state
transitions, and tenant/node reuse. It does not delete, truncate, repair, or
time-clean journal history. A recovered terminal delivery remains a duplicate.
Any recovered non-terminal delivery is returned as `recovery_required`, because
a crash after the durable `executing` marker cannot prove whether the executor
side effect occurred. No automatic retry exists. See
`docs/decisions/ADR-024-node-execution-journal.md` for the safety boundary and
`docs/decisions/ADR-027-operator-recovery-adjudication.md` for the manual
resolution protocol.

### Operator recovery adjudication

Recovery is an explicit local control-plane operation. It is not accepted from
SSE, a task payload, a node/system actor, or an approval decision. The operator
must authenticate as a `human:*` or `account:*` actor and choose one immutable
outcome:

1. Call `inspectRecovery(claimId)`. The result contains only the claim,
   delivery, WorkOrder, journal stage, and TaskEnvelope hash. It never contains
   the raw TaskEnvelope, approval, receipt, capability grant, or credential.
2. Establish from external evidence whether the in-doubt side effect occurred.
   Do not infer “not executed” merely because no receipt was written.
3. If the side effect occurred, or replay would otherwise be unsafe, call
   `abandonRecovery(claimId, { operatorActorRef, reasonCode })`. The original
   attempt becomes permanently non-executable.
4. Only when external evidence proves a retry is safe, call
   `authorizeRecoveryRetry(claimId, { operatorActorRef, reasonCode })`. This
   closes the old attempt and returns a newly generated `attemptId` and
   `idempotencyKey` bound to `retryOfClaimId` and the original WorkOrder.
5. Separately use an authenticated Relay human/account control route to block
   the old Relay task and submit `POST /v1/tasks/:oldTaskId/retry` with a new
   TaskEnvelope. Its `originRef` must preserve the returned WorkOrder lineage
   and its `idempotencyKey` must equal the newly issued key. The node does not
   perform this network step. The new claim starts at `pending_confirmation`
   and requires a fresh approval before execution.

Both outcomes append a canonical, SHA-256-chained, fsynced resolution record to
the same journal. A second or conflicting resolution is rejected; journal
history is never updated, truncated, deleted, or repaired. Merely authorizing a
retry causes zero executor, approval-consumption, or Relay calls.

Example embedding code (the CLI does not expose recovery mutation commands):

```js
const evidence = agent.inspectRecovery('delivery-17');
// Human/account operator checks external side-effect evidence here.
const retryPlan = agent.authorizeRecoveryRetry('delivery-17', {
  operatorActorRef: 'human:owner',
  reasonCode: 'verified_not_started',
});
// retryPlan.retry is input to the separate Relay control workflow.
```

Use short machine-readable `reasonCode` values, not customer text or secrets.
If journal verification fails, stop: adjudication cannot bypass a corrupt or
scope-mismatched journal.

## MCP tool facade

The facade exposes exactly the existing `hummer_local` names:

| Tool name | Capability | Node behavior |
| --- | --- | --- |
| `fs_read` | `fs.read` | authorize, then delegate to a trusted local handler |
| `doc_extract` | `doc.extract` | authorize, then delegate to a trusted local handler |
| `workspace_exec` | `workspace.exec` | require scope and explicit confirmation, then delegate |

The facade contains no filesystem, document parser, shell, container, or network implementation. `workspace_exec` must remain behind the HUMMER-owned isolated execution boundary in ADR-012/013; a handler must not be wired until its startup isolation probes pass.

## Long-running authorization checkpoints

Every executor receives `authorization.signal` and an asynchronous
`authorization.checkpoint()`. Call the checkpoint directly before each
high-risk side effect, including a write, outbound request, spend, deletion,
privilege change, or new network endpoint. A checkpoint revalidates the exact
tenant/node/task/request binding with Relay; an SSE revocation is only an early
hint.

The Node Agent also checkpoints before invoking the executor, before each
returned RunEvent, before receipt submission, and before recording completion.
`approval_expired`, `approval_revoked`, and `relay_stop` are terminal for the
attempt. Do not catch one of these errors and continue, and do not reuse the
old approval for a retry. A checkpoint prevents later work; it cannot undo a
side effect already completed before the checkpoint.

## Local verification

```powershell
npm.cmd run typecheck -w @hummer/node-agent
npm.cmd test -w @hummer/node-agent
```

The tests include missing runtime, failed version probe, unknown provider, malformed claim, shared-contract rejection, system-actor approval rejection, expired grant, unknown MCP tool, missing scope, and missing execution approval. They are unit/port tests only; they are not AC-P0-03/04 real Fleet evidence.

## Remaining integration gates

- Construct a real contract-valid `NodeManifest` heartbeat from runtime probes and active-lease load.
- Bind a D3 Relay adapter and persist pending claims in HUMMER's authoritative task store.
- Bind existing trusted `fs_read`, `doc_extract`, and sandboxed `workspace_exec` handlers without moving their policy boundary into the node.
- Run two real nodes, prove offline within 60 seconds, and prove offline nodes receive no dispatch (`AC-P0-03`).
- Run ten cross-machine tasks with zero duplicate execution (`AC-P0-04`).
