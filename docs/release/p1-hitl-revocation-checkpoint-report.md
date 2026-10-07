# ROUND P1-HITL-revocation-checkpoint | 2026-10-07 | branch `codex/phase0-fleet`

## Outcome

AC-P1-HITL-02 and AC-P1-HITL-04 now have executable local evidence for an
already-running two-step executor. Approval expiry and post-approval
revocation both stop at the next explicit checkpoint. The second side effect,
later RunEvents, receipt, and completed state remain absent.

## Implementation

- Relay keeps the original approval decision immutable and appends a separate
  revocation fact.
- Memory and SQLite v16 use atomic terminal-state arbitration; revoke wins only
  while the task is active, and late completion fails closed.
- Node executors receive `authorization.signal` and
  `authorization.checkpoint()`; Relay truth is mandatory at every checkpoint.
- Tenant/node-scoped `approval.revoked` SSE accelerates cancellation but is not
  an authority source.
- Web and Desktop controls expose one-click revoke. Desktop credentials remain
  in the Electron main process, and the scope sentence is derived from the
  stored grant rather than renderer-authored text.
- `test:chaos --approval-timeout` and `test:chaos --revoke` now exercise active
  executors instead of only static decision/token rejection.

## Verification

- `npm run test:chaos -- --approval-timeout` -> exit 0; 3 assertions, 4
  negative cases.
- `npm run test:chaos -- --revoke` -> exit 0; 4 assertions, 8 negative cases.
- `npm run test:chaos` -> exit 0; all seven injected fault classes, 10/10
  negative cases.
- Node Agent -> 63/63 tests; Relay -> 16 files/178 tests.
- Root unit -> 103 files/700 tests; UI -> 23 files/91 tests. The first parallel
  UI run exhausted worker startup time; the single-worker rerun passed without
  assertion changes.
- `npm run typecheck` and `npm run build` -> exit 0; build retains the existing
  large-chunk warning.
- `npm run test:web-e2e` -> exit 0; 37 assertions, 7 negative cases.
- `npm run test:desktop:hitl-matrix -- --round=round-p1-auth-revoke-checkpoint-final`
  -> exit 0; 21 assertions and four screenshots.

## Evidence

- `evidence/round-p1-auth-revoke-checkpoint-final/manifest.json`
- root hash: `9984a2faaf98bcc4ab0408f807456a6f24e9714c81ab4552d11b1ab85aad2c4d`
- predecessor:
  `5c72281f4a6b381ef26f86e8d29d527c70a08ddb09ea58360cf3eeb794ed9da5`
- `evidence/round-p1-auth-revoke-chaos/manifest.json`
- chaos root hash: `2aa6d0578d2110d1cddda9c1c6830f5ee1aca109fc0014d6bce6a72c8ed48283`
- chaos predecessor:
  `9984a2faaf98bcc4ab0408f807456a6f24e9714c81ab4552d11b1ab85aad2c4d`
- The initial Desktop attempt failed because an `--ignore-scripts` dependency
  refresh removed the Electron binary. That attempt was retained under
  `F:\AgentWorkspace\10_Working\hummer\codex\retained-hitl-attempts-20261007`;
  Electron 39.8.10 was restored from another local worktree with the identical
  package version before the passing rerun.

## Contract impact and limits

Relay gets additive revocation/authorization ports and SQLite schema v16. No
frozen fleet contract, receipt schema, Desktop historical migration, or public
API contract is rewritten. Evidence is one Windows host, loopback Fastify,
Memory/SQLite, static test badges, and a synthetic executor; it is not the
required production IdP, TLS deployment, clean NSIS installation, real expert
workflow, or two-physical-machine proof.

No push, deployment, payment, production database mutation, or external side
effect was performed.
