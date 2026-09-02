# ADR-003: Approval rejection is an auditable terminal decision

Date: 2026-09-01
Status: Accepted

## Decision

A protected action is not complete when the runtime merely stops. The policy decision and the runtime resolution form one audit record, scoped to the authenticated tenant.

- The requested action, requester, estimated cost, matched policy, and required approver are preserved in the approval projection.
- A human rejection appends `approval.rejected` to the immutable domain-event chain. It is distinct from a runtime error and from a policy denial caused by an invalid approver or budget.
- When the runtime later emits `approval_resolved`, its payload is merged under `runtimeResolution`; it must not overwrite the policy decision payload.
- The workbench shows the requester, required approver, matched policy, and actual supplied estimate. Missing runtime usage remains `未提供`; the UI does not invent a cost.
- Evidence is read through authenticated Electron IPC. The renderer cannot select another tenant or supply the approver identity.

## Consequences

The workbench can now render an explicit terminal state, `已被拒绝`, with an evidence detail view that includes the event type, decision maker, policy, required approver, action, and hash.

This is local Electron proof only. It does not add a cloud audit service, remote approval routing, or a new authorization model.

## Acceptance evidence

- `apps/desktop/src/persistence/approval-policy-store.test.ts` covers policy rejection followed by a runtime `approval_resolved` event and asserts that the original evidence survives with a valid hash chain.
- `src/components/pages/WorkbenchPage.test.tsx` covers the approval card and the evidence detail interaction.
- `scripts/e2e-desktop-approval-rejection.mjs` runs the packaged Electron host: create a local tenant, reject `crm.write`, render `approval.rejected`, and verify the chain. Its generated record is `spikes/m4-approval-rejection/rejection-evidence.json`.

The six exposed no-op controls present at the start of M4-B were either removed or routed to existing settings. No inactive button is retained as a placeholder for future scope.