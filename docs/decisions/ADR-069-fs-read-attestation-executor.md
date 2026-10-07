# ADR-069: Enable only a bounded read-attestation executor

- Status: Accepted for Phase 1 hardening
- Date: 2026-10-07
- Milestone: First production-safe Node executor

## Context

ADR-067 and ADR-068 made human approval, one-use task authority, revocation
checkpoints, and receipt persistence enforceable, but the runnable Node daemon
still rejected every approved task with `executor_unavailable`. Enabling a
general CLI, shell, model, network, or write adapter would enlarge the risk
surface before the fleet boundary has real-device evidence. The first executor
therefore needs to be useful, deterministic, and narrow enough to audit.

Natural-language `workOrderTask.target` is untrusted prose and cannot safely
select a local file. A path must be an explicit machine contract carried from
dispatch through approval and the one-use grant.

## Decision

1. `TaskEnvelope` version 1 receives one additive optional `executionPlan`.
   Its only accepted kind is `fs.read.attest.v1`, with one strict portable
   relative path and an integer `maxBytes` capped at 1 MiB. Tasks without that
   plan remain non-executable.
2. Node daemon config version 3 requires an absolute `workspaceRoot`, separate
   from the execution journal and receipt store. The daemon advertises exactly
   `fs.read`; runtime probes and MCP names remain inventory, not authority.
3. A read plan produces an approval request for exactly `task.execute` plus
   `fs.read`, one path, and `maxUses: 1`. The executor independently requires
   the same exact human-approved scope and a `TaskEnvelope.grantRef`; Relay's
   durable authority must consume the matching one-use grant before execution.
4. The executor never infers a path from task title, target, prompt, attachment
   name, or expected deliverable. It rejects absolute paths, traversal,
   backslashes, alternate data stream syntax, control characters, empty path
   segments, trailing slash/dot/space aliases, and Windows device names.
5. Before opening, every path component is checked for symbolic links or
   reparse points. The resolved target must remain under the real workspace
   root and match its non-aliased lexical path. The target must be a regular
   file with exactly one hard link. Pre-open and opened file identity must
   match; size and timestamps must remain stable through the read.
6. Reads are performed in 64 KiB chunks. Approval and task-grant authorization
   are checkpointed before open and before every chunk. Revocation, expiry, or
   Relay stop returns no partial outcome.
7. Output contains only relative path, byte count, SHA-256, run metadata, and a
   verifiable OutcomeReceipt. File bytes are never put in logs, events,
   journal, receipts, or either Relay SQLite database. The receipt binds the
   attestation metadata in both its accepted domain event and tool record.
8. Codex, Claude, DeepSeek, arbitrary CLI, shell, network, write, spend,
   delete, and privilege execution remain disabled.

## Consequences and limits

- Existing Node daemon config version 2 does not auto-upgrade. Operators must
  create a real `workspaceRoot`, move receipt/journal state outside it, set
  version 3, and advertise only `fs.read`.
- The executor proves the bytes read from one locally opened file and binds the
  digest to HUMMER's internal approval and receipt chain. It does not prove
  external signer identity, trusted time, remote storage identity, or that the
  file remained unchanged after the read.
- Rejecting hard links and aliases is intentionally conservative. Some valid
  local files will require copying into the governed workspace before they can
  be attested.
- A task grant becomes exhausted before the first file open. Failed or revoked
  runs do not automatically refund that one-use authority.

## Verification

- Contract tests reject unknown plan fields, unsafe paths, and reads over the
  1 MiB ceiling.
- Executor tests cover missing plan/grant, mismatched scope, traversal,
  absolute and Windows-special paths, oversize files, hard links, junctions,
  and mid-read revocation.
- A real loopback HTTP integration uses `SqliteFleetStore`,
  `SqliteTaskGrantAuthority`, and `NodeAgentDaemon` to complete one approved
  read, persist the receipt before terminal completion, exhaust the grant once,
  and prove that file bytes and the task token are absent from logs, journal,
  receipts, and SQLite/WAL files.
