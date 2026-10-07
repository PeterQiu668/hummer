# ADR-065: Bootstrap runnable Relay and Node daemons without widening trust

- Status: accepted
- Date: 2026-10-07
- Scope: local Relay and Windows Node Agent process entrypoints

## Context

The Fleet core, HTTP/SSE adapter, SQLite store, and Node Agent were executable
through tests and embedders but had no stable long-running process entrypoints.
That made a second-machine trial unnecessarily dependent on test harness code.
At the same time, wiring an arbitrary runtime command as a production executor
would falsely turn runtime discovery into authority to perform side effects.

## Decision

Add two versioned, strict-config CLIs:

- `hummer-relay start --config <absolute-json>` starts the production
  `SQLiteFleetStore -> FleetService -> FastifyFleetTransport` chain.
- `hummer-node run --config <absolute-json>` probes runtimes, registers a
  formal `NodeManifest`, heartbeats every 15-30 seconds, connects SSE, polls,
  claims a formal `TaskEnvelope`, and submits a deterministic redacted
  `ApprovalRequest`.

Both configs reject unknown properties and plaintext bearer fields. Configs
contain environment-variable names only; each process reads the value once and
removes it from its environment. Plain HTTP is loopback-only. Relay binds only
to `127.0.0.1` in this bootstrap slice. Package `bin` metadata is used so npm
creates the Windows `.cmd` shim without checking in a PowerShell shim.

The Node production daemon deliberately injects an unavailable executor and an
unavailable receipt validator. Runtime probe success and the three advertised
MCP names are inventory only. An approved request therefore fails closed with
`executor_unavailable` until an independently reviewed adapter is supplied.

## Evidence and consequences

`npm run test:daemons` starts both real child processes against one ephemeral
loopback port and one SQLite database. It proves registration, heartbeat,
formal enqueue/claim, a bound redacted approval request, and a durable local
approval-request journal record. It also proves there is no executing or
completed record and scans configs, stdout, stderr, SQLite, and the journal for
the three generated bearer values.

This creates a reproducible local beta bootstrap and shortens the path to a
second Windows machine. It does not prove external TLS, production identity,
two-device delivery, JavaScript graceful signal handling on Windows, or any
production runtime execution. Those remain separate acceptance gates.

## Contract and migration impact

No frozen Fleet contract, Desktop migration, Relay schema migration, receipt
schema, or public API route changes. The change adds process/config surfaces,
package bin metadata, documentation, and an integration gate only.
