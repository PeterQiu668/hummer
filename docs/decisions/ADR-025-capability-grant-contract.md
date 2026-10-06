# ADR-025: Freeze the task-scoped capability grant contract

- Status: Accepted
- Date: 2026-10-07
- Phase: P1-W2

## Context

Phase 0 used opaque, statically provisioned badge tokens to prove the Relay authentication boundary. W2 requires a durable authorization object for issuing, rotating, consuming, expiring, and revoking task-scoped grants without putting bearer-token material in contracts, logs, evidence, or storage.

## Decision

Add `hummer.capability-grant` version 1 to the TypeBox/Ajv/Standard Schema contract source. A grant is bound to exactly one tenant, work order, node, and run. It carries only explicit capabilities, workspace-relative paths, expiry, maximum uses, consumed uses, and optional revocation time. Bearer-token plaintext is deliberately not a contract field.

The W2 Fleet contract documentation is frozen as v1.0. This is an additive contract freeze: existing serialized contract versions remain version 1, existing Phase 0 payloads remain valid, and unknown fields remain rejected. Runtime enforcement must reject a grant when it is expired, revoked, bound to another subject, outside its declared scope, or exhausted.

`usedCount <= maxUses` is a semantic invariant enforced by the shared validator because JSON Schema 2020-12 cannot compare sibling numeric fields portably without a non-standard extension.

## Consequences

- Relay implementations may persist grant metadata and token fingerprints, never plaintext bearer tokens.
- Nodes receive an opaque token and cannot broaden or renew the associated grant.
- Rotation creates a replacement authorization and revokes the previous one; it does not mutate audit history.
- Any future required field or changed authorization meaning requires a new contract version and ADR.
