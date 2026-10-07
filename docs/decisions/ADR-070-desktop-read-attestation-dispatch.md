# ADR-070: Author read attestation as an explicit Desktop dispatch contract

- Status: Accepted for Phase 1 hardening
- Date: 2026-10-07
- Scope: Desktop Start Work review and durable Fleet outbox

## Context

ADR-069 enabled one narrow production executor, but Desktop could not author its
`executionPlan` or show the exact resource scope to a human. Treating a natural
language prompt as a file selector would break the executor's central security
property. Bypassing the existing outbox would also reintroduce crash-loss and
payload-drift risks already closed by ADR-066.

The runnable Relay currently accepts task grants provisioned by an offline
operator flow. A Desktop UI must not pretend that typing a grant reference
creates authority, and it must never collect or persist the plaintext token.

## Decision

1. Start Work offers an explicit optional “read file attestation” mode. It
   requires one strict workspace-relative path, an integer byte ceiling between
   1 and 1 MiB, and an opaque pre-provisioned grant reference.
2. The path is never inferred from prompt text, attachment names, targets, or
   expected deliverables. Windows device aliases, trailing dot/space aliases,
   traversal, absolute paths, backslashes, alternate streams, controls, empty
   segments, and unknown fields fail closed before planning.
3. A read plan can select only an online node whose manifest advertises exactly
   the `fs.read` capability. A general runtime probe or other permission string
   is not sufficient.
4. Before confirmation, the human sees the exact path, maximum bytes, grant
   reference, and the promise that file content is not returned. No dispatch
   occurs before that confirmation.
5. Confirmation freezes `executionPlan` and `grantRef` into the same validated
   `TaskEnvelope`. The existing Desktop SQLite outbox persists the canonical
   envelope before network I/O and replays the identical bytes after failure.
6. The outbox deep validator recognizes only the current three-field execution
   plan and requires a grant reference. It continues to reject unknown fields,
   credential material, tenant/actor mismatch, idempotency drift, expiry, and
   oversized payloads.
7. This slice does not create a public task-grant issuer, accept grant tokens in
   the renderer, or enable any general model, CLI, shell, network, write,
   payment, delete, or privilege executor.

## Consequences and limits

- A local operator must still pre-provision the one-use task grant in Relay and
  the Node process. The UI describes this honestly and cannot make an
  unprovisioned reference executable.
- The same path is represented in form state, the human review, TaskEnvelope,
  approval scope, durable grant, and executor. Each layer validates it
  independently so a compromised or stale layer fails closed.
- Capability matching uses the Relay-projected node manifest. It is dispatch
  eligibility, not proof that the file exists or can be opened.
- Packaged second-device, production identity, TLS, installation, and external
  user evidence remain separate gates.

## Verification

- React tests cover valid entry, traversal, device aliases, missing capability,
  exact human review, zero pre-confirm dispatch, and contract-shaped output.
- Desktop integration tests prove the plan and grant reference are committed
  before network, retained across response loss and restart, and rejected when
  malformed or missing their one-use grant.
- Full typecheck, build, contract, Desktop outbox, unit, and UI suites are part
  of the sealed evidence round.
