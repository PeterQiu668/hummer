# ADR-053: local chaos and capacity gates

Status: accepted for W6 local evidence

## Context

The Phase 1 acceptance plan requires `npm run test:chaos` to execute seven
named fault classes and `npm run test:perf` to exercise 10 nodes, 100 tasks,
and 10,000 events. Previously, chaos required one of three explicit modes and
there was no performance command. Passing focused unit tests could therefore
not prove either release gate.

## Decision

1. Running `test:chaos` without a mode executes exactly seven local fault
   checks: process kill, network outage, disk-full boundary, SQLite lock,
   clock jump, expired grant, and runtime version mismatch. Each check executes
   a concrete assertion and at least one rejection/recovery negative case.
2. The existing `--approval-timeout`, `--revoke`, and `--process-kill` modes
   remain stable for focused evidence and older automation.
3. The disk-full check injects `EIO` at the append-before-side-effect journal
   boundary. It does not consume the host disk. The database-lock check uses a
   real file-backed SQLite write lock and proves there is no partial node row.
4. `test:perf` runs the same workload separately on `MemoryFleetStore` and a
   file-backed `SqliteFleetStore`: 10 registered nodes, 100 enqueued/claimed
   tasks, and 10,000 persisted events. It measures individual operation
   latency and enforces heartbeat p95 below 2 seconds, dispatch p95 below 5
   seconds, and event-write p95 below 50 milliseconds.
5. The performance gate reads back all 10,000 events and submits an invalid
   sequence for each backend. Missing events or silent acceptance fail the
   gate.

## Consequences

- W6 can produce machine-readable, reproducible local evidence for the Phase 1
  chaos and capacity requirements.
- These gates deliberately do not prove remote Relay latency, multi-process
  contention, true disk exhaustion, or a two-machine soak. Their JSON output
  carries that limitation and must not be used to turn external gates green.
- File-backed SQLite makes the local capacity measurement sensitive to the
  test machine. The thresholds are generous release safety ceilings, not a
  production sizing forecast.
