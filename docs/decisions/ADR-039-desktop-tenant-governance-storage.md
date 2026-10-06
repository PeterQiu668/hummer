# ADR-039: Desktop tenant governance storage is fail-closed and tenant-explicit

Date: 2026-10-07
Status: Accepted
Scope: W4 desktop settings, audit exports, quotas, and lifecycle foundation

## Context

W4 requires tenant settings, independently verifiable audit manifests,
per-node/day quotas, and lifecycle states. These controls must not accept a bare
foreign reference, silently increase a budget, or perform tenant deletion from
the persistence layer.

## Decision

1. V12 adds tenant-keyed canonical JSON `tenant_settings` and storage guards for
   lifecycle states `active`, `suspended`, `export_required`, and `destroyed`.
2. V13 adds `audit_exports`, `quota_counters`, and `quota_admissions`. V13 is
   additive and v1-v11 remain unchanged.
3. An audit manifest explicitly names one tenant and a contiguous range of that
   tenant's verified chain. Event references are derived from that range; if a
   caller supplies references they must match it exactly. Foreign and unknown
   references have the same failure. Every manifest file has a normalized
   relative path, SHA-256 digest, and byte length. The canonical manifest itself
   is SHA-256 addressed.
4. Audit export reads and verification always require `tenantId`. A globally
   occupied export ID cannot be used from another tenant and reveals no owner.
5. Quota counters are keyed by tenant, fleet node, UTC day, and metric:
   `tasks`, `tokens`, or `cost_cny`. The node must already belong to the tenant.
6. A quota admission supplies all three increments and an idempotency key. All
   configured counters change atomically or none do. Replaying identical input
   returns the durable result; changing input under the same key is rejected.
7. Crossing 80% appends one `quota.warning` per counter/day. Once a counter is
   at its limit, the next positive admission returns `quota_exceeded`, leaves
   counters unchanged, and appends `quota.rejected` to the tenant chain.
   Missing quota configuration and non-active tenant state also fail closed and
   are recorded as rejected admissions.
8. Suspension and reactivation are explicit logged transitions. Destruction is
   a storage state only: it requires `export_required`, a complete audit export
   through the current tenant head, and a structured L3 authorization record.
   It sets `destroyed` and appends `tenant.destroy_authorized` with
   `destructiveDeleteExecuted: false`; it never deletes data.
9. Membership and invitation storage accepts `auditor` and `operator` in
   addition to the existing roles. Only owner/admin can create invitations;
   member/auditor/operator are explicitly rejected. This migration supplies the
   durable role vocabulary only. Their complete receipt/approval/task permission
   matrix still requires the later authenticated host surfaces.

## Evidence

`[TEN-W4-GOVERNANCE]` tests use two real tenants to prove:

- manifests contain only the requested tenant's event references and reject a
  foreign tenant event or export ID like an unknown one;
- file and manifest hashes are deterministic;
- node references cannot cross tenants;
- v11 owner/member rows survive the role-table rebuild, all five membership
  roles can be created through invitation acceptance, and invalid roles are
  rejected by the database;
- 80% warnings occur once, an admission at the configured limit is durable,
  the next task is rejected in-chain, and idempotent replay does not increment
  counters or append events again; and
- a suspended tenant cannot pass quota admission, and destruction cannot be
  authorized before both a complete export and structured L3 approval.

## Limits

- This branch deliberately does not modify persistence-host, preload, UI,
  runtime hosts, root scripts, or Relay. Therefore quota admission and lifecycle
  state are not yet wired into every task-creation surface; AC-P1-10 is proven
  at the persistence API but not yet end-to-end.
- Audit manifests register file hashes supplied by the export assembler. The
  future host/package boundary must hash actual file bytes and independently
  verify them before publishing a package; AC-P1-11 is not claimed complete by
  this storage slice alone.
- L3 records are structurally required and durably logged, but their authority
  must ultimately be established by the authenticated host approval flow.
