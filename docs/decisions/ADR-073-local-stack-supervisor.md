# ADR-073: Local internal-test stack uses one foreground supervisor

## Status

Accepted on 2026-10-07.

## Context

Relay, Node, and Desktop were individually runnable, but an operator still had
to create three transient credentials, write two configs, start processes in
order, and stop them separately. Persisting those credentials in a launcher or
config would contradict the existing secret boundary. A network administration
endpoint would also create a new control surface solely for local startup.

## Decision

1. Add a foreground `hummer-local-stack` supervisor with strict `run`,
   `status`, and `stop` commands and a Windows `.cmd` shim.
2. The one-time config contains only an existing Desktop tenant/account
   identity and absolute state/workspace paths. It never contains credentials.
3. Each run creates fresh eight-hour control badge, node badge, and task-grant
   issuer values in memory. Existing Relay, Node, and Desktop consumers delete
   their environment entries after bootstrap.
4. Relay and Node run under the supervisor so stop can close their transports
   and SQLite stores. Desktop receives an stdin lifetime pipe and quits normally
   when the supervisor closes it.
5. Status and stop use a per-run local named pipe. No HTTP administration route
   or remote control scope is added.
6. The supervisor claims only an empty state root, rejects a second live owner,
   preserves completed/stale run folders, and never expands the sole production
   executor beyond `fs.read.attest.v1`.

## Consequences

- After one non-secret config is prepared, the local internal-test stack starts
  with one command and stops with one command.
- Identity bootstrap remains explicit: the supervisor refuses to guess or forge
  the Desktop tenant/account. First-time identity provisioning is not solved by
  this slice.
- This remains a single-host loopback workflow, not evidence for TLS, IdP/KMS,
  code signing, a second device, or external users.
