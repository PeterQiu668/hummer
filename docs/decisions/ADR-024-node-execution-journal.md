# ADR-024: Node execution uses a durable fail-closed journal

- Status: Accepted for Phase 0
- Date: 2026-10-07
- Milestone: D4 node restart safety

## Context

`HummerNodeAgent` previously kept pending and terminal claim IDs only in process
memory. A process restart forgot both sets. If Relay delivered the same claim
again, the reconstructed node could call the executor a second time.

Relay's lease, idempotency, and approval-consumption records remain necessary,
but they do not make an executor side effect and a later receipt write one
atomic transaction. Calling this distributed exactly-once would be false.

## Decision

1. Every node agent receives an `ExecutionJournal` port. Production-like local
   use is provided by `FileExecutionJournal`; tests may use
   `MemoryExecutionJournal`.
2. The file journal is append-only canonical JSONL. Every record has a strict
   sequence, tenant/node scope, previous-record hash, and SHA-256 record hash.
   Each append opens the file in append mode, writes the complete record, calls
   `fsync`, and closes the handle before execution may continue. A failed append
   poisons that journal instance and fails closed.
3. Before the executor is called, the journal durably records the claim ID,
   delivery ID, WorkOrder ID, tenant, node, TaskEnvelope hash, approval request
   ID/hash, consumed approval decision hash, and an `executing` state. It stores
   no grant token, credential, raw TaskEnvelope, raw approval object, or receipt
   body.
4. After event and receipt submission, the node appends a terminal record with
   the canonical receipt hash before reporting `completed`. Executor or output
   failures append a terminal `failed` record and are never automatically
   retried.
5. Startup verifies the complete chain, canonical encoding, transitions, and
   tenant/node scope. Tampering, a partial final line, an unknown field, or
   cross-scope reuse aborts startup. The implementation never truncates,
   deletes, time-cleans, or automatically repairs a journal.
6. A recovered terminal claim remains a duplicate. Any recovered non-terminal
   claim, including `executing`, is explicitly exposed as `recovery_required`.
   Re-delivery, approval calls, stop calls, and confirmation calls cannot invoke
   the executor for that claim. Recovery requires an operator-controlled future
   procedure; Phase 0 defines no automatic retry or journal rewrite. The later
   operator protocol is defined by ADR-027 and preserves this fail-closed rule.
7. Relay tables, desktop migrations, and the five frozen Fleet wire contracts
   are unchanged.

## Safety property and limitation

This decision provides durable **at-most-once executor invocation per intact
node journal** and fail-closed crash recovery. It does not provide distributed
exactly-once execution.

There is necessarily an in-doubt interval after `executing` is flushed and
before the terminal receipt record is flushed. A crash in that interval cannot
prove whether the external side effect happened, so the node returns
`recovery_required` and does not retry. The journal also assumes one writer for
one tenant/node file; multi-process writer coordination and operator resolution
are outside Phase 0.

## Verification

- Complete an approved delivery, reconstruct the agent from the same file, and
  prove the repeated delivery calls the executor zero times.
- Seed an `executing` record without a terminal record, reconstruct the agent,
  and prove `recovery_required` with zero executor and approval-consumption
  calls.
- Alter a journal byte and prove startup fails without changing the altered
  file.
- Reuse a journal with another tenant or node and prove startup fails.
- Fail the durable `executing` append and prove the executor is never called.
- Inspect the journal and prove it contains hashes and IDs but no grant token,
  raw TaskEnvelope, or approval preview.
