# ADR-044: Enforce the unified role policy at Desktop host boundaries

- Status: Accepted
- Date: 2026-10-07

## Context

ADR-042 defines the canonical five-role tenant policy in `@hummer/contracts`. Desktop previously authenticated tenant tokens but several IPC handlers treated every authenticated member alike. That allowed roles such as auditor to reach task creation and final acceptance, and it left high-risk runtime approvals without a role check.

Desktop cannot safely import the current contracts package at runtime. The Electron build publishes `apps/desktop/dist`, while the private contracts package exports workspace TypeScript source and is not included in the packaged Desktop files. A direct import would compile but leave a production module reference that the packaged application cannot resolve.

## Decision

Desktop uses one runtime adapter, `desktop-role-policy.ts`, mirroring ADR-042. A parity suite executes every role/action cell plus contextual negative cases against the canonical contracts evaluator. Any policy drift fails the Desktop test suite.

The host derives `role`, `actorId`, and both tenant fields exclusively from `IdentityStore.resumeSession(token)`. Renderer input is never used to select the policy actor or tenant; spread inputs are overwritten with the authenticated tenant and actor before persistence.

The following real boundaries now enforce the policy:

- invitation creation (`manage_members`);
- form task intake and confirmation (`create_task`);
- persisted and runtime high-risk approval decisions (`approve_high_risk`);
- session, approval evidence, outcome list, receipt, and receipt export reads (`read_receipt_audit`);
- outcome recording as final acceptance (`accept_result`).

Member participation is derived from the authenticated account that confirmed a WorkOrder intake. It is not inferred from renderer plan JSON or runtime event actor strings. Operator audit access requires the session to be the current session of an authenticated tenant execution node. Auditor and operator are denied final acceptance before the outcome store is called.

Codex file-change approval requests are classified as `write`; opaque command approvals are `other` and therefore fail closed for operator. Claude approval remains unconnected and sends no decision; the role check runs before that explicit fail-closed result.

## Consequences and limitations

- Existing WorkOrders without a confirmed intake do not yet have a trusted participant relation. Member receipt/acceptance access for those records is denied until an authoritative participation fact exists.
- Inbox watcher ingestion remains a system action. A human must pass the authenticated `create_task` check when confirming it.
- This change does not add IPC for policy editing, capability sharing, recording, or tenant destruction. Future handlers must route through the same adapter.
- The adapter is temporary packaging debt. Once contracts publishes runnable JavaScript included in the Electron artifact, Desktop should delete the mirror and import the canonical evaluator directly while retaining the parity tests during migration.
