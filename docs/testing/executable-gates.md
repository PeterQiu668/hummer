# Executable fleet gates

These root commands are evidence adapters over the checked-in Relay and Node Agent tests. They do not manufacture production capabilities.

| Command | Proves locally | Explicit boundary |
|---|---|---|
| `npm run test:fleet -- --idempotency` | duplicate task/event delivery is at-most-once in Memory and SQLite stores | not a cross-machine run |
| `npm run test:fleet -- --soak=100` | first runs the local 100-delivery prerequisite | then exits `2` (`pending`) until true two-machine evidence exists |
| `npm run test:security -- --grants` | tenant, node, scope, expiry, max-use, rotation, revocation, and human-control boundaries fail closed | production IdP and transactional persistence remain seams |
| `npm run test:security -- --token-leak` | canary token is absent from Node client state, errors, injected logs, and the redacted diagnostic pack | no external APM or host-log scan |
| `npm run test:chaos -- --approval-timeout` | deterministic expired approval rejection | virtual Relay clock, not a killed process |
| `npm run test:chaos -- --revoke` | old token fails at the next Registry and Fastify authorization checkpoint | an already-running executor still needs a node-side checkpoint hook |
| `npm run test:chaos -- --process-kill` | forcibly killed Node Agent recovers an `executing` journal as `recovery_required` in a fresh process, with zero executor calls | local supervised process proof; Relay failover and cross-machine recovery remain separate |

Every command writes one JSON object using schema `hummer.executable-gate-result` to stdout. Exit code `0` means the selected proof passed, `1` means a test or invocation failed, and `2` means an acceptance condition is still pending. A `--dry-run` prints the selected evidence plan and executes no assertions.

In the JSON, `assertions` counts passed top-level test cases because the Vitest JSON reporter does not expose individual `expect` calls. `negativeCases` counts the explicit rejection scenarios exercised, including status/backend variants.

`npm run test:gates` validates all dry-run contracts and asserts that unimplemented chaos modes stay non-zero.
