# ADR-068: Persist task-grant authority before acknowledging execution

- Status: Accepted for Phase 1 hardening
- Date: 2026-10-07
- Milestone: Relay restart-safe execution authorization

## Context

ADR-067 separated node identity, human approval, and the one-use task grant,
but the injected `CapabilityGrantRegistry` retained consume, revoke, expiry,
and exhaustion state only in memory. A Relay crash after returning a successful
consume could reload an older active snapshot and authorize the same execution
again. A production executor must not rely on process-local use accounting.

## Decision

1. Relay config version 2 requires a separate absolute
   `taskGrantDatabasePath`. It may not equal the fleet database path.
2. The runnable Relay uses `SqliteTaskGrantAuthority` for the task-grant
   consume/checkpoint routes. The SQLite database uses WAL, FULL synchronous
   commits, a five-second busy timeout, unique token digests, and a one-use
   table constraint.
3. `consume` validates token digest, tenant, grant reference, WorkOrder, node,
   run, capabilities, paths, expiry, and `maxUses: 1` inside one SQLite
   transaction. The exhausted state commits before HTTP success is returned.
4. `checkpoint` never increments usage. It accepts an already consumed,
   exhausted grant for the same binding while still rejecting revocation,
   rotation, expiry, foreign scope, or a never-consumed grant.
5. Revocation and expiry mutate the same durable record. Store startup validates
   every row through the existing strict grant contract and fails closed on
   invalid persisted state.
6. Provisioning is offline and digest-only. `hummer-relay grant-import` accepts
   a strict snapshot containing no plaintext bearer. Re-import is add-only and
   idempotent for identical immutable records; it never rewinds durable mutable
   state and rejects digest or binding conflicts.
7. Fleet task/approval state and task-grant state remain separate SQLite files.
   The HTTP route reads persisted Fleet context and performs the grant mutation
   before replying; no cross-database transaction is claimed.

## Consequences and limits

- A completed grant consume remains exhausted after Relay close, crash, or
  restart, and a durable revocation remains effective.
- The original high-entropy task token remains only with the node/issuer; Relay
  persists its SHA-256 digest and redaction-safe binding metadata.
- Snapshot import is a local provisioning primitive, not a public issuance API,
  identity provider, key-management service, or remote control plane.
- The separate Fleet and grant databases cannot provide a single atomic commit
  across task leasing, approval, and grant consumption. Route derivation and
  idempotent terminal facts mitigate replay, but this ADR does not claim a
  distributed transaction.
- The production executor remains `executor_unavailable` until a separately
  reviewed narrow adapter is implemented.

## Verification

- SQLite close/reopen preserves consume, exhaustion, checkpoint, expiry, and
  revocation state.
- Concurrent consume attempts produce exactly one winner.
- Re-import after consumption does not reset `usedCount` or status.
- A real Fastify route backed by persisted Fleet and grant databases rejects a
  second consume after restart, accepts the bound checkpoint, and rejects that
  checkpoint after durable revocation and another restart.
- CLI import works without loading badge environment secrets and never prints
  the task token or database path.
