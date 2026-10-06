# Executable fleet gates

These root commands are evidence adapters over the checked-in Relay and Node Agent tests. They do not manufacture production capabilities.

| Command | Proves locally | Explicit boundary |
|---|---|---|
| `npm run test:fleet -- --idempotency` | duplicate task/event delivery is at-most-once in Memory and SQLite stores | not a cross-machine run |
| `npm run test:fleet -- --soak=100` | first runs the local 100-delivery prerequisite | then exits `2` (`pending`) until true two-machine evidence exists |
| `npm run test:security -- --grants` | tenant, node, scope, expiry, max-use, rotation, revocation, and human-control boundaries fail closed | production IdP and transactional persistence remain seams |
| `npm run test:security -- --token-leak` | canary token is absent from Node client state, errors, injected logs, and the redacted diagnostic pack | no external APM or host-log scan |
| `npm run test:chaos` | seven local fault classes execute: real process kill, bounded network reconnect exhaustion, durable-journal EIO, real SQLite write lock, backward/forward clock jumps, expired task grant, and incompatible Codex version | deterministic local injections; not a production or cross-machine chaos claim; disk-full is injected as EIO rather than filling the host volume |
| `npm run test:chaos -- --approval-timeout` | deterministic expired approval rejection | virtual Relay clock, not a killed process |
| `npm run test:chaos -- --revoke` | old token fails at the next Registry and Fastify authorization checkpoint | an already-running executor still needs a node-side checkpoint hook |
| `npm run test:chaos -- --process-kill` | forcibly killed Node Agent recovers an `executing` journal as `recovery_required` in a fresh process, with zero executor calls | local supervised process proof; Relay failover and cross-machine recovery remain separate |
| `npm run test:perf` | runs 10 nodes, 100 tasks, and 10,000 persisted events against Memory and file-backed SQLite; reports heartbeat, dispatch, and event-write p95; rejects an invalid sequence and proves exact event counts | deterministic single-process capacity floor, not remote Relay, multi-process, or two-machine performance |

Every command writes one JSON object using schema `hummer.executable-gate-result` to stdout. Exit code `0` means the selected proof passed, `1` means a test or invocation failed, and `2` means an acceptance condition is still pending. A `--dry-run` prints the selected evidence plan and executes no assertions.

In the JSON, `assertions` counts passed top-level test cases because the Vitest JSON reporter does not expose individual `expect` calls. `negativeCases` counts the explicit rejection scenarios exercised, including status/backend variants.

`npm run test:gates` validates the dry-run contracts, including exactly seven
checks in the default chaos plan and both local performance backends.

The performance ceiling is intentionally identical to the product requirement:
heartbeat p95 `< 2,000 ms`, dispatch p95 `< 5,000 ms`, and event-write p95
`< 50 ms`. The JSON result includes the measured values and exact persisted
event count for each backend. A green local result must not be cited as
AC-P1-02 or any true two-machine result.
