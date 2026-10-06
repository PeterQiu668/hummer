# ADR-038: Desktop keeps the legacy global event chain and adds an independent chain per tenant

Date: 2026-10-07
Status: Accepted
Scope: W4 desktop persistence migrations and tenant integrity

## Context

The original `domain_events` ledger is one global append-only hash chain. It is
still part of existing receipts and cannot be rewritten. The earlier
tenant-specific verifier recalculated event hashes but had no tenant-local
positions, previous hashes, or durable head, so deleting or reordering a
tenant's events could escape tenant verification.

W4 also requires upgrades from an already deployed v11 database without
changing migration definitions v1-v11.

## Decision

1. Migration v12 is appended as `w4_tenant_governance_and_dual_chain`. Migration
   definitions v1-v11 remain byte-for-byte unchanged and have a frozen test
   fingerprint.
2. V12 safely rebuilds `memberships` and `invitations` so their role checks add
   `auditor` and `operator`, copying every existing row before replacing the old
   tables and recreating their indexes. Existing owner/admin/member rows retain
   their IDs and bytes. Invalid roles remain rejected by SQLite.
3. `domain_events.position`, `previous_hash`, and `hash` remain the legacy global
   chain. Their calculation and stored bytes do not change.
4. V12 adds `tenant_event_chain` with a contiguous tenant-local position,
   tenant-local previous hash, and hash for each event. It also adds
   `tenant_chain_heads` with one durable `(position, hash, updated_at)` head per
   tenant.
5. The tenant hash covers the complete canonical event content, tenant-local
   position, and tenant-local previous hash. It intentionally excludes the
   legacy global hash so activity in tenant B cannot alter tenant A's head.
6. Appending an event writes the global event, tenant-chain row, and tenant head
   in one SQLite transaction. Idempotent event replay fails closed if its
   tenant-chain row is missing.
7. During a v11-to-v12 upgrade, the migration `up` function reads legacy events
   in their existing global order and backfills each tenant's independent chain
   inside the migration transaction. It does not update any legacy event row.
8. Tenant verification checks canonical payload bytes, every tenant-local
   position and previous hash, each tenant hash, unchained/missing events, and
   the durable head. Event deletion, tenant-local reordering, payload tampering,
   and head mismatch therefore fail verification.
9. The global verifier remains available for legacy receipts and administrator
   diagnostics. A foreign tenant's corruption does not make another tenant's
   tenant verifier fail.
10. `exportChainHead(tenantId, deviceId)` returns only
   `{device_id, tenant_id, position, hash, at}`. Agent-hub must receive that
   object through an application boundary and must never open the SQLite/WAL
   files.

## Evidence

`[TEN-W4-GOVERNANCE]` tests:

- freeze the v1-v11 migration fingerprint;
- construct a real v11 database with a legacy event, upgrade it to v13, and
  prove existing membership/invitation rows survive and both global and tenant
  verification still pass;
- accept all five membership roles after upgrade while SQLite still rejects an
  invalid invitation role;
- interleave two tenants and prove the legacy chain remains global while tenant
  heads advance independently; and
- manually delete an event, reorder tenant positions, and mutate canonical
  payload bytes, proving only the damaged tenant verifier fails.

## Limits

An attacker who can rewrite the complete database can also recalculate a local
head. Detection against that attacker depends on publishing the exported head
to an independently controlled Git/NAS history. This change exposes the safe
export object but, by scope, does not add the host IPC or agent-hub writer.
