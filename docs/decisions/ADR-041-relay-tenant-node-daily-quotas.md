# ADR-041: Relay enforces tenant-node daily quotas before enqueue

- Status: Accepted for W4
- Date: 2026-10-07
- Scope: `apps/relay`

## Context

Task, token, and cost use must be attributable to one tenant and node in one UTC
day. Notification alone is insufficient: a node already at its limit must not
receive another task. At the same time, accounting must not break idempotent
replay or trust a caller-supplied tenant.

## Decision

1. Relay schema v14 adds `quota_counters` keyed by
   `(tenant_id, node_id, day, metric)`. Metrics are `tasks`, `tokens`, and
   `costCny`; `day` is a UTC calendar date.
2. Counters exist even when no limit is configured. A null limit means measured
   but unlimited. Configuration preserves already-used value.
3. A newly inserted task increments `tasks`. An exact idempotent replay does not
   increment it. Nodes report positive token/cost deltas through a separately
   authorized usage operation; they cannot configure their own limits.
4. The first transition to at least 80% appends one `quota.warning` event for
   that counter. Raising a limit below the warning threshold rearms the warning.
5. Before inserting a non-duplicate task, Relay checks all three counters for
   the target tenant/node/day. If any configured counter has `used >= limit`,
   Relay appends `quota.exceeded`, returns `quota_exceeded`, and inserts no task.
   Limits are never raised automatically.
6. Quota configuration requires a human/account control session and the
   `quota.manage` badge scope. Usage writes require a node-bound badge with
   `quota.record`. Reads require `quota.read`. Fastify derives tenant identity
   from the badge; body/path data never selects another tenant.
7. A quota node reference must exist in the authenticated tenant. A foreign
   node and an unknown node return the same generic `node_unknown` result.
8. Memory and SQLite implement the same validation, threshold, audit, and
   rejection behavior.

## Postgres RLS status

Postgres/RLS remains **pending**. This worktree has no provisioned Postgres
instance, identity mapping, migration runner, or RLS test environment. No mock,
SQLite predicate, or unit test is reported as Postgres/RLS evidence. A future
spike must test real policies with at least two database roles and cross-tenant
negative queries before that gate can become green.

## Verification

- At a task limit of five, accept five tasks, emit one warning, and reject the
  sixth without inserting it.
- Reach token and cost limits independently and reject the next task.
- Prove exact duplicate enqueue does not consume quota twice.
- Prove warning and rejection facts are present in the tenant audit chain.
- Run all cases against Memory and SQLite and through authenticated Fastify
  routes.
