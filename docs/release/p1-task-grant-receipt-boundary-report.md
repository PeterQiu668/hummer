# P1 task-grant and node-receipt boundary report

- Branch: `codex/phase0-fleet`
- Implementation commit: `dd0262556c32873070a5ed0b1c71130338d3a8e1`
- Evidence round: `round-p1-task-grant-receipt-boundary`
- Status: passed locally; not pushed or deployed

## Outcome

The Node Agent now requires three independent facts before a future executor
can run: an authenticated node badge, a human-approved persisted decision, and
the exact one-use task grant referenced by the leased `TaskEnvelope`. The task
grant is consumed once and checked without additional consumption at later
authorization checkpoints.

A successful OutcomeReceipt is verified with the shared
`@hummer/outcome-receipts` package and persisted in a node-owned, tenant/node
marked, create-only receipt root before the terminal `completed` RunEvent is
sent. Receipt persistence failure prevents completion.

The production runtime executor is still deliberately unavailable. This round
closes authorization and receipt-storage prerequisites; it does not enable
Codex, Claude, shell, filesystem, network, write, spend, delete, or privilege
execution.

## Security properties exercised

- Node identity and task authority use separate credentials and headers.
- Relay derives task-grant scope from its leased task and persisted approval,
  never from caller-provided tenant, WorkOrder, run, capability, or path data.
- Both approval and task grant must explicitly be `maxUses: 1`.
- Missing, wrong, reflected, foreign, multi-use, revoked, expired, or expanded
  authority fails closed before executor invocation.
- Receipt verification recomputes leaf hashes, root hash, and the disclosed
  domain-event chain and accepted-outcome binding.
- Receipt roots reject mismatched tenant/node markers and symbolic-link roots
  or markers; receipts use canonical JSON, a 2 MiB cap, create-only writes,
  restrictive file mode, and file `fsync`.
- A receipt is stored before a terminal completion event can leave the node.

## Verification

The sealed gate ran these commands with exit code 0 under Node v22.22.2:

| Command | Result |
| --- | --- |
| `npm run typecheck` | passed |
| `npm run build:cli -w @hummer/relay` | passed |
| `npm run test:grants -w @hummer/relay` | 2 files, 37 tests passed |
| `npm test -w @hummer/node-agent` | 79 tests passed |
| `npm test -w @hummer/relay` | 18 files, 194 tests passed |
| `npm run test:daemons` | 15-assertion real Relay/Node child-process gate passed |

Additional pre-seal regression checks also passed:

- `npm run build`
- `npm run test:unit`: 107 files, 726 tests
- `npm run test:ui -- --maxWorkers=1`: 23 files, 91 tests

The build retained the existing Vite warning for a minified chunk above 500
kB; it did not fail the build.

## Evidence chain

- Gate: `evidence/round-p1-task-grant-receipt-boundary/gate.json`
- Manifest: `evidence/round-p1-task-grant-receipt-boundary/manifest.json`
- Gate SHA-256: `3bf78529564e217eeb267ab806b05f31fc4201b63aef3dc9861d43a658ecea6d`
- Manifest root: `e1dd1c701ef10d6a5d77fdccc00f0815e47d304d1d64bea11818e255165d5940`
- Predecessor root: `d8751bdf9980bcac214d115e19fb033bbef092fc1fe7fae4f28c8c19a2f14c21`

## Remaining limits

1. Relay CLI does not yet load or durably update task-grant snapshots.
   Consume, revoke, and exhaustion are process-atomic but not restart-durable.
2. The safe production executor adapter is intentionally absent and returns
   `executor_unavailable`.
3. Receipts prove internal hash consistency, not signer identity, trusted time,
   or third-party non-repudiation.
4. The daemon gate uses two real child processes over loopback on one Windows
   machine, not two external devices.
5. Node daemon config migrated from version 1 to version 2 and now requires a
   separate absolute `receiptRoot` in addition to `journalPath`.

## Next safe slice

Add crash-safe Relay task-grant snapshot provisioning and durable mutation
before implementing the first narrow `fs.read` attestation executor. The
executor must remain disabled until restart-safe consume/revoke semantics are
proven.
