# ROUND P1-desktop-fleet-outbox | 2026-10-07 | branch `codex/phase0-fleet`

Implementation commit: `2d78a2e59374cecbdf2e9357ee78140f06407b83`

## 1. Goal

Advance the reliability prerequisite for AC-P1-02 and AC-P1-07: a Desktop
dispatch that was committed locally must not disappear when the sending
process crashes, and a response-lost retry must converge without creating a
second logical Relay task. This round does not claim the two-machine 100-task
AC-P1-02 acceptance criterion is complete.

## 2. Changes

- Added Desktop migration v16 and `FleetDispatchOutboxStore` with immutable
  canonical payloads, tenant-scoped idempotency, retained terminal history,
  bounded payloads, and response binding.
- Routed only the Desktop `StartWorkFlow` Relay enqueue through the durable
  outbox. Startup plus a 15-second loop replay transient pending rows.
- Added fail-closed expiry/permanent-failure terminalization, active membership
  replay filtering, nested renderer-token rejection, and process-local
  single-flight delivery.
- Added real SQLite response-loss/reopen integration coverage and a child
  process force-kill recovery gate.
- Added `npm run test:desktop:outbox` and a machine-generated evidence capture.
- No files were deleted. The abandoned repository-root worktree, historical
  evidence, generated configuration, Web client, intake confirmation flow,
  and agent-hub source were not modified.

## 3. Gate record

- `npm run test:desktop:outbox` -> exit 0. Desktop build passed; 5 focused test
  files / 37 tests passed; 1/1 process-kill test passed.
- `npm run typecheck` -> exit 0.
- `npm run build` -> exit 0. Existing Vite chunk-size warning only.
- `npm run test:unit` -> exit 0; 107 files / 723 tests passed.
- `npm run test:ui -- --maxWorkers=1` -> exit 0; 23 files / 91 tests passed.
- Required negative cases passed: idempotency drift, inactive/cross-tenant
  actor, unknown and oversized payloads, malformed nested work task, renderer
  token in payload, mismatched Relay success response, expired replay, and
  terminal-state mutation all fail closed.

## 4. Evidence

- `evidence/round-p1-desktop-fleet-outbox/gate.json`
- `evidence/round-p1-desktop-fleet-outbox/manifest.json`
- root hash:
  `d8751bdf9980bcac214d115e19fb033bbef092fc1fe7fae4f28c8c19a2f14c21`
- predecessor:
  `9fd97e3dd48193a6b19afbe1abd067b89d5d0284aad03898411da9bef61f2ef7`
- Manifest `gitCommit` is the implementation commit above; the evidence and
  this report are added by the following documentation commit.

## 5. Incomplete, degraded, or intentionally excluded

- AC-P1-02 remains open: no second physical machine and no 100-task soak were
  run in this round.
- Web/mobile still use direct Relay HTTP and do not have this durable outbox.
- Intake confirmation/local runtime execution is outside this dispatch path.
- The kill gate terminates a dedicated persistence child, not a packaged
  Electron process.
- The outbox insert is its own atomic SQLite transaction; it is not atomic with
  a separate local WorkOrder/confirmation fact.
- Delivery is at-least-once, not transport exactly-once. Logical convergence
  depends on Relay's existing `(tenant, idempotencyKey)` contract.
- No push, deployment, production database mutation, network/certificate
  change, payment, or external side effect was performed.

## 6. Contract, migration, and architecture impact

- API/Fleet contract semantics: unchanged.
- ADR: ADR-066.
- Desktop migration: v16 appended; v1-v15 unchanged.
- Relay migration/schema: unchanged.
- The current technology selection remains valid; no §5.2 assumption changed.

## 7. Next action

Add the reviewed production executor adapter behind the Node Agent's existing
fail-closed `executor_unavailable` seam, then prove one approved low-risk task
can execute and emit a verifiable receipt without weakening revoke and expiry
checkpoints.
