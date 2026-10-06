# Relay tenant governance operations

## Boundary

Relay governance is tenant-scoped operational metadata. HUMMER still owns
WorkOrders, receipts, artifacts, and product audit facts. The Relay database is
dedicated to Relay and must never point at desktop `hummer.sqlite3`.

Every HTTP route below requires a bearer badge with the exact scope shown.
Tenant identity is taken from that badge. There is no anonymous governance or
management endpoint.

| Route | Scope | Purpose |
| --- | --- | --- |
| `PUT /v1/governance/nodes/:nodeId/quotas/:day` | `quota.manage` | Set one or more daily limits; human/account control badges only |
| `POST /v1/governance/nodes/:nodeId/usage` | `quota.record` | Add positive `tokens` / `costCny` deltas; badge must be bound to the node |
| `GET /v1/governance/nodes/:nodeId/quotas/:day` | `quota.read` | Read tenant-local counters |
| `GET /v1/governance/chain-head` | `audit.read` | Read the authenticated tenant's current head |
| `GET /v1/governance/audit?rangeFrom=&rangeTo=` | `audit.read` | Read a contiguous tenant-local audit range |
| `POST /v1/governance/audit-exports` | `audit.export` | Freeze export metadata for the requested or current full range |
| `GET /v1/governance/audit-exports/:exportId` | `audit.read` | Read one tenant-local export manifest |

Quota configuration body:

```json
{
  "limits": { "tasks": 100, "tokens": 500000, "costCny": 200 }
}
```

Usage body:

```json
{ "tokens": 1240, "costCny": 0.82 }
```

The day path is `YYYY-MM-DD` in UTC. Counters continue measuring when their
limit is null. At 80% the audit chain receives one warning. Once any metric is
at 100%, the next non-duplicate enqueue returns HTTP 429 with
`quota_exceeded`; the rejected attempt is itself chained.

## Chain verification and anchoring

`verifyTenantAuditChain` verifies a complete tenant chain. An export response
contains an immutable v1 manifest and can be checked with
`verifyTenantAuditExport` plus the selected event range.

For external agent-hub anchoring, an authorized adapter reads the chain-head
route and writes this projection to its own node report:

```json
{
  "device_id": "node-main",
  "tenant_id": "tenant-a",
  "position": 42,
  "hash": "<64 lowercase hex characters>",
  "at": "2026-10-07T00:00:00.000Z"
}
```

Relay does not choose the device branch or write Git. Never give agent-hub
direct access to `relay.sqlite3`, its `-wal`, or `-shm` files.

## Migration and rollback

Relay v14 only appends `tenant_audit_events`, `tenant_chain_heads`,
`quota_counters`, and `audit_exports`, plus append-only triggers. It does not
change v11-v13 bytes or desktop migrations. Back up the dedicated Relay database
before opening it with v14. Rollback is application rollback plus restoring that
backup; do not drop v14 tables or edit chain rows in place.

## Postgres/RLS

Status: **pending, not tested**. No Postgres environment was available for this
increment. SQLite tenant predicates and Memory tests are not substitutes for
real RLS evidence.

## Checks

```powershell
npm.cmd run test:governance -w @hummer/relay
npm.cmd run typecheck -w @hummer/relay
npm.cmd test -w @hummer/relay
```
