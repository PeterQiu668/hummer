# Desktop tenant governance runbook

This runbook covers the persistence foundation introduced by migrations v12 and
v13. It does not authorize direct database access from agent-hub and does not
authorize tenant deletion.

## Upgrade and integrity

1. Back up the application data directory using the normal operator procedure.
2. Open HUMMER normally. `openPersistence()` applies v12, backfills the tenant
   chain inside the migration transaction, then applies v13.
3. Confirm schema version 13 and run both the legacy global verifier and the
   tenant verifier for every tenant expected on the device.
4. A failure with `missing_event`, `tenant_position_mismatch`,
   `previous_hash_mismatch`, `hash_mismatch`, or `tenant_head_mismatch` is a
   stop condition. Do not rebuild or overwrite the chain.
5. Confirm the upgraded membership and invitation tables accept only
   owner/admin/member/auditor/operator (invitations exclude owner). Do not grant
   auditor/operator permissions merely because the storage role now exists.

## Chain-head handoff

- Call the application persistence boundary
  `governance.exportChainHead(tenantId, deviceId)`.
- Hand the returned `{device_id,tenant_id,position,hash,at}` object to the
  approved agent-hub adapter for writing under its node report history.
- Before handoff, run `npm run verify:tenant-export -- chain-head ...` as
  documented in `docs/operations/tenant-export-verifier.md`. When advancing the
  stable device projection, pass the previously trusted hash through
  `--expected-current-hash`; rollback, forks, and tenant/device replacement are
  rejected.
- Never let agent-hub open, copy, or query a live `hummer.sqlite3`, `-wal`, or
  `-shm` file.

## Quota procedure

1. Register/confirm the tenant-owned fleet node.
2. Configure all three counters for the UTC day: `tasks`, `tokens`, and
   `cost_cny`. No counter is raised automatically.
3. Submit one idempotent admission before starting a new task. Treat any
   `accepted: false` result as a hard stop.
4. At 80%, surface the durable warning event once. At 100%, the next task
   remains rejected until an authorized operator explicitly changes a limit or
   a new UTC window is configured.

## Audit export procedure

1. Verify the tenant chain.
2. Choose a contiguous tenant range. A destruction-precondition export starts
   at position 1 and ends at the current head.
3. Hash actual export files outside this store, then register normalized
   relative path, byte length, and lowercase SHA-256 for each file.
4. Persist the canonical audit manifest and independently compare its stored
   SHA-256 before publishing the package.
5. Never accept an event, export, path, or file reference from another tenant.

## Lifecycle and destruction

The only supported order is:

`active -> suspended -> active`, or
`active/suspended -> export_required -> destroyed`.

Suspension rejects governance quota admission while retaining governance reads
and audit export. `authorizeTenantDestruction` additionally requires a complete
current export and a structured L3 approval. The method records authorization
and changes status only; it deliberately performs no filesystem or database
deletion. Any future physical deletion remains a separate L3 operation.

## Current integration boundary

The persistence APIs are not yet exposed through desktop IPC/UI in this slice.
Until an authenticated host integration lands, operators must not claim the
end-to-end quota or audit-export acceptance criteria are complete.
