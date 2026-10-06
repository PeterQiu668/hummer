# ADR-033: Tenant references and filesystem artifacts require the same ownership boundary

- Status: Accepted as P0 isolation repair
- Date: 2026-10-07
- Scope: desktop outcome/cost receipts, artifact egress, controlled writes,
  workspace jobs, diagnostics, and temporary execution storage

## Context

Tenant predicates on result-list queries are insufficient when a tenant-owned
record can retain a foreign reference or when a filesystem path is shared. The
P0c audit found four concrete gaps:

- outcome and cost records accepted session, work-order, approval, evidence,
  and outcome references without proving that they belonged to the same tenant
  and session;
- workspace execution jobs accepted a tenant alongside an unrelated session or
  work order;
- egress read a source file before proving that its bytes had previously been
  captured as evidence for the requesting tenant and session; and
- controlled writes from different tenants shared the same physical workspace
  path, allowing one tenant to detect another tenant's filename through the
  overwrite refusal.

Diagnostics also hashed top-level tenant/node references but did not
automatically remove the same references or absolute host paths when embedded
in messages and relative file labels. Container-volume cleanup failures were
silently ignored, making residual temporary data invisible to operators.

## Decision

1. Recording an outcome requires an existing session owned by the tenant.
   Optional work-order, approval, and evidence references must match that same
   tenant/session. Recording a cost requires an owned session, and a linked
   outcome must use that exact session. Receipt assembly independently checks
   that outcome, definition, costs, tools, and approval all share the requested
   tenant/session before serializing any field.
2. Workspace job persistence requires `(tenant_id, session_id, work_order_id)`
   to match one persisted session before inserting either the job or its domain
   event.
3. Egress requires an approved action for the tenant/session, a source
   directory whose canonical basename is the session's work-order ID, and a
   source digest already present as evidence for that tenant/session. Files are
   not copied and no delivery record is created when any binding is absent.
4. Controlled writes resolve under
   `.hummer/tenants/<sha256(tenantId)>` beneath the configured workspace. Every
   intermediate directory is checked for symbolic links before use. The
   caller-facing relative path remains unchanged.
5. Diagnostic packs automatically redact the current tenant reference, node
   reference, Windows/UNC absolute paths, and common Unix absolute host paths
   from status, diagnostics, event messages, and file labels. Structural path
   validation happens before redaction so an absolute or forbidden input cannot
   become acceptable merely because it was redacted.
6. Container volume removal errors are propagated rather than silently
   discarded. This does not guarantee cleanup succeeds, but it prevents a
   residual volume from being reported as a successful completed operation.
7. No persistence migration, host IPC contract, quota, dual chain, or product
   feature is added by this repair.

## Verified non-findings

- Outcome, definition, cost, egress-list, approval, tool-invocation, and receipt
  reads already use tenant predicates. The receipt builder also replaces every
  foreign global-chain event body with an opaque position/hash bridge.
- `requireWorkspaceFile` and workspace snapshot import/export reject traversal
  and symbolic links and enforce byte/file limits.
- Workspace execution broker leases are random, revocable, and bind execution
  to the lease's work-order ID. Work-order directories are distinct and cannot
  collide through path traversal.
- Self-check directories use random names and are removed in `finally`.

## Verification

The stable `[TEN-P0C-DESKTOP-SIDE-CHANNELS]` suite uses two real tenants and
proves that:

- foreign and unknown session/job references have indistinguishable failures;
- foreign approval, evidence, and outcome references cannot enter receipts or
  cost records;
- two tenants can write the same relative filename without observing or
  overwriting each other;
- unowned artifact bytes cannot be exported, while the same bytes become
  exportable after tenant/session evidence capture;
- diagnostic output contains neither raw tenant/node references nor absolute
  host paths; and
- identical artifact names under different work-order directories remain
  physically isolated.

## Limits

- The execution workspace directory is keyed by the globally unique work-order
  ID. Authentication and lease issuance remain host responsibilities; this ADR
  does not change runtime IPC or broker contracts.
- Content ownership is proven by tenant/session evidence plus SHA-256. Two
  tenants that independently own identical bytes may both export those bytes;
  this is intentional and reveals no tenant-specific content.
