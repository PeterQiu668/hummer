# ADR-040: Relay governance facts use a tenant audit chain and verifiable export manifest

- Status: Accepted for W4
- Date: 2026-10-07
- Scope: `apps/relay`

## Context

The legacy `relay_audit` projection records only stop and retry actions. It is
tenant-qualified, but it has no sequence, previous hash, chain head, or export
manifest. Reusing the process-global product/domain-event chain would also make
one tenant's activity visible through another tenant's positions.

Relay needs a governance ledger without becoming the owner of HUMMER product
facts or allowing agent-hub to read a live SQLite/WAL database.

## Decision

1. Relay schema v14 adds `tenant_audit_events`, `tenant_chain_heads`, and
   `audit_exports`. The legacy `relay_audit` table and v11-v13 migrations are
   unchanged.
2. Each tenant has an independent, contiguous position starting at 1. The hash
   material is canonical JSON of tenant, position, action, subject reference,
   optional node, actor, time, redaction-safe metadata, and previous hash.
   SHA-256 produces the event hash.
3. Successful node registration, task/lease, run-event, approval, quota, and
   export mutations append to this chain. Routine heartbeats update liveness but
   are deliberately not chained. Exact idempotent task/event replays return the
   original result and do not append another governance event.
4. Audit entries contain identifiers, decisions, counts, hashes, and safe
   summaries only. They never contain bearer tokens, credentials, raw manifests,
   raw task envelopes, approval bodies, artifact bytes, or receipt bodies.
5. `tenant_chain_heads` is updated in the same Memory operation or SQLite
   transaction as its audit event. Memory and SQLite use identical hash
   construction and must produce identical hashes for identical facts.
6. Audit exports are tenant-qualified immutable metadata records. Their v1
   manifest fixes the position range, event count, first previous hash, final
   chain hash, SHA-256 of the selected entries, and creation time. The manifest
   itself is hashed; its hash derives the opaque export ID.
7. Creating an export appends `audit.exported` after fixing the exported range,
   so an export never contains itself. A foreign export ID and an unknown export
   ID both return the same tenant-local not-found result.
8. Fastify exposes chain, audit, and export reads only behind `audit.read`; export
   creation requires `audit.export`. Tenant identity always comes from the
   authenticated badge.
9. The chain-head HTTP result can be transformed by the authorized agent-hub
   adapter into `{ device_id, tenant_id, position, hash, at }`. Relay does not
   write Git, node reports, or agent-hub files and agent-hub must not open the
   Relay SQLite database.

## Migration boundary

Relay schema v14 is local to the dedicated Relay database. Desktop migration
v12/v13 uses a different database and version registry; the equal numbers do
not describe shared migrations. Opening a Relay v13 database appends v14 tables
and marker while preserving legacy audit rows.

## Verification

- Run identical facts through Memory and SQLite and compare every audit event
  and chain head byte-for-byte.
- Create two tenants and prove each begins at position 1 and cannot read the
  other's audit, head, or export reference.
- Verify full chains and export manifests; change any selected event and make
  verification fail.
- Close and reopen SQLite and prove the same head, quota counters, and export
  manifest remain.
- Open a synthetic v13 database and prove migration markers become
  `11,12,13,14` while a legacy audit row is unchanged.
