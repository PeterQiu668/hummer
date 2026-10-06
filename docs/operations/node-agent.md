# HUMMER Windows node agent (Phase 0 D2 skeleton)

Status: local alpha skeleton with the frozen D1 contract adapter. This document does **not** claim that a network Relay, two-machine display, 60-second offline detection, or cross-machine execution has passed. Those gates still require transport integration and real-device evidence.

## Boundary

`apps/node-agent` is a Node 22 single-process boundary for a future Fleet Relay. It owns only local runtime discovery, heartbeat scheduling, claim staging, approval-gated execution handoff, and a naming/authorization facade for trusted local tools.

The package engine range is pinned to Node 22.x. Running its development checks under another Node major is not packaging evidence; the eventual D6 installer must bundle or provision the pinned runtime.

It does not own Fleet business contracts, task/approval/result facts, credentials, runtime sessions, or production execution. The node imports none of agent-hub, Electron, a runtime SDK, or a Relay implementation. Transport, shared contract validation, and execution are injected ports.

The implementation preserves these rules:

- `NodeManifest`, claimed tasks, approval decisions, run events, and outcome receipts are all validated by the injected shared contract validator. Invalid data does not cross the transport boundary.
- A valid claimed task is staged as `pending_confirmation`. Claiming never confirms or executes it.
- Execution requires an unexpired capability grant with `task.execute` plus a shared-contract approval by a `human:*` or `account:*` actor for that exact claim and tenant. Its `grantedScope` must independently include an unexpired `task.execute` capability.
- A terminal claim is never executed twice. Failures are reported and are not automatically retried.
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

The heartbeat interval is restricted to 15–30 seconds. The injected `FleetTransport` supplies five operations:

- `sendHeartbeat(manifest, context)`
- `claimTask(context)`
- `reportClaimStatus(status, context)`
- `submitRunEvent(event, context)`
- `submitReceipt(receipt, context)`

`context` carries the node/tenant binding and the ephemeral grant token to the transport adapter. Adapters must redact the token and must not put it in logs, evidence, diagnostics, URLs, or argv. The Relay, not this skeleton, determines the 60-second offline projection and must exclude offline nodes from dispatch.

The heartbeat timer does not trigger task execution and does not perform an automatic retry after an error. Starting it requires an error callback, so a failed heartbeat cannot be silently swallowed; operators and the Relay must observe connection health explicitly.

## Claim flow

```text
Relay claim (unknown bytes)
  -> exact local delivery wrapper validation
  -> injected TaskEnvelope contract validation
  -> pending_confirmation status
  -> human ApprovalDecision contract validation
  -> grant expiry/scope check
  -> injected executor exactly once
  -> injected RunEvent(s) and OutcomeReceipt transport
```

`createSharedFleetContractValidator` now binds `NodeManifest`, `TaskEnvelope`, `ApprovalDecision`, and `RunEvent` directly to `@hummer/contracts`. The existing v1 outcome-receipt verifier remains an injected authority because OutcomeReceipt is not redefined as a sixth Fleet contract.

## MCP tool facade

The facade exposes exactly the existing `hummer_local` names:

| Tool name | Capability | Node behavior |
| --- | --- | --- |
| `fs_read` | `fs.read` | authorize, then delegate to a trusted local handler |
| `doc_extract` | `doc.extract` | authorize, then delegate to a trusted local handler |
| `workspace_exec` | `workspace.exec` | require scope and explicit confirmation, then delegate |

The facade contains no filesystem, document parser, shell, container, or network implementation. `workspace_exec` must remain behind the HUMMER-owned isolated execution boundary in ADR-012/013; a handler must not be wired until its startup isolation probes pass.

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
