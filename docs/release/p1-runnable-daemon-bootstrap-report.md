# ROUND P1-runnable-daemon-bootstrap | 2026-10-07 | branch `codex/phase0-fleet`

## Outcome

HUMMER now has runnable local `hummer-relay` and `hummer-node` process
entrypoints. A real two-child-process gate proves the SQLite Relay and Node
Agent can register, heartbeat, dispatch, claim, and stop at a redacted human
approval request without inventing execution success.

## Implementation

- Relay accepts a strict v1 JSON config, loopback bind, absolute SQLite path,
  and environment-variable references for scoped badges.
- Node accepts a strict v1 JSON config, probes the four runtime classes,
  registers a formal manifest, starts heartbeat/SSE/poll loops, claims one
  formal envelope, and appends the bound approval request to Relay.
- Both processes consume credential environment entries and never print token
  values. Non-loopback plaintext HTTP, missing credentials, unknown config
  fields, and invalid versions fail closed.
- The production daemon has no runtime executor adapter. Even after approval it
  returns `executor_unavailable`; it cannot produce a receipt or completion.
- `npm run test:daemons` starts the real CLIs as child processes and scans all
  local persistence/output surfaces for generated bearer canaries.

## Verification

- `npm run check -w @hummer/node-agent` -> exit 0; 68/68 tests.
- `npm run build:cli -w @hummer/relay` -> exit 0.
- focused Relay CLI/config tests -> exit 0; 2 files/13 tests.
- `npm run typecheck` -> exit 0.
- `npm run build` -> exit 0; existing large-chunk warning only.
- `npm run test:unit` -> exit 0; 105 files/713 tests.
- `npm run test:ui -- --maxWorkers=1` -> exit 0; 23 files/91 tests.
- `npm run test:daemons` -> exit 0; 15 integration assertions.

## Evidence

- `evidence/round-p1-daemon-integration-final2/manifest.json`
- root hash: `9fd97e3dd48193a6b19afbe1abd067b89d5d0284aad03898411da9bef61f2ef7`
- predecessor:
  `2aa6d0578d2110d1cddda9c1c6830f5ee1aca109fc0014d6bce6a72c8ed48283`
- The first failed assertion and first unsealed passing run are retained under
  `F:\AgentWorkspace\10_Working\hummer\codex\retained-daemon-attempts-20261007`.
  The failure was a test vocabulary mismatch: the durable journal correctly
  records `approval_request_recorded`, not the UI state name
  `pending_confirmation`. No product behavior changed to make the rerun pass.

## Contract impact and limits

No contract or database migration changed. D2 and D3 now have runnable local
process entrypoints, but their true-machine acceptance conditions remain open:
the evidence uses one Windows host and loopback; there is no production IdP,
TLS endpoint, production executor, real MCP handler binding, second physical
node, or 100-task cross-machine soak. Windows process termination in the gate
does not prove JavaScript signal callbacks ran.

No push, deployment, payment, production database mutation, network change, or
external side effect was performed.
