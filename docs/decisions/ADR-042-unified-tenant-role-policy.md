# ADR-042: Unified tenant role policy contract

- Status: Accepted
- Date: 2026-10-07

## Context

HUMMER needs one portable role vocabulary before Desktop, Relay, or other adapters enforce permissions. The W4 matrix defines `owner`, `admin`, `member`, `auditor`, and `operator`, but several permissions depend on authenticated request context rather than role alone. A flat role-to-action lookup would over-grant members and operators and could not express the lifecycle requirement that tenant destruction follows a verified export and L3 approval.

## Decision

The contracts package exports a strict TypeBox request union and the pure `evaluateTenantRolePolicy(unknown)` evaluator. Every request carries the authenticated actor, actor tenant, target tenant, action, and the exact context required by that action. Every object rejects additional properties. Unknown roles, actions, fields, missing context, malformed input, and cross-tenant requests return a deny decision without throwing.

The nine actions are:

`manage_members`, `change_policy`, `approve_high_risk`, `create_task`, `read_receipt_audit`, `export_capability`, `start_recording`, `destroy_tenant`, and `accept_result`.

Context-sensitive rules are:

- A member may use the approval surface only for a low-risk request they initiated. The action name is retained from the required contract even though this member case is explicitly not a high-risk approval.
- A member may read receipts/audit only for work they participated in, export only their capability, record only themselves, and accept only a result for work they participated in.
- An operator may approve only `egress` or `write` and may read only node-related receipts/audit.
- An auditor may read all receipt/audit data and export a capability only in `read_only` mode.
- Only an owner may destroy a tenant, and only when both L3 approval and a verified prior export are present.
- Auditor and operator are categorically denied final result acceptance.

The exported Standard Schema wrapper enables boundary adapters to validate the identical request shape. This ADR does not authorize trusting renderer-supplied roles or tenant IDs: callers must populate the contract from authenticated backend state.

## Evidence

`policy.test.ts` executes all 45 role/action cells and explicit negative cases for each contextual restriction, cross-tenant use, unknown values, additional fields, missing context, and malformed inputs. The tests also assert the permanent auditor/operator final-acceptance denial.

## Consequences

- Product adapters can share one fail-closed contract without duplicating policy tables.
- Deny reasons are stable machine-readable values suitable for audit events without disclosing tenant data.
- This change defines the contract only. It deliberately does not connect Desktop IPC, Relay HTTP, or any other enforcement surface; those integrations must separately derive trusted actor context and call the evaluator.
