# CapabilityGrant operations

## Boundary

`CapabilityGrantRegistry` issues the short-lived task badges described in
ADR-026. It is called behind an authenticated identity/control plane; it is not
an unauthenticated HTTP endpoint. Fastify receives only the
`BadgeTokenAuthenticator` interface, so issuance policy stays outside the
delivery adapter and `FleetTransport` remains unchanged.

Every grant binds:

- tenant, WorkOrder, node, and run;
- an explicit subset of Relay capabilities and paths;
- an inclusive expiry boundary;
- a finite `maxUses` counter.

The delegating authority must contain every requested value and must remain
valid beyond the requested grant. Rotation is constrained by the old grant's
remaining uses; it cannot reset the budget.

## Safe issuance sequence

1. Authenticate the human/account control-plane session.
2. Resolve its current authority into `CapabilityGrantAuthority`. Never accept
   this object directly from an untrusted request body.
3. Call `registry.issue(authority, request)`.
4. Persist `registry.snapshot(tenantId)` transactionally before acknowledging
   issuance. Never combine tenants into one unscoped snapshot.
5. Deliver the non-enumerable `issued.token` once over the authenticated
   provisioning channel. Ordinary `JSON.stringify(issued)` emits only the safe
   grant record, but direct token access remains secret handling.
6. Discard the plaintext value from control-plane memory. Do not stringify,
   log, trace, capture, or include the `IssuedCapabilityGrant` wrapper in a
   receipt.

The safe object for logs, UI, audit, evidence, and diagnostics is
`issued.grant` or `registry.get(tenantId, grantId)`. It contains `tokenRef` but
no token or digest. The durable snapshot contains a SHA-256 digest, never the
token. A wrong-tenant lookup and an unknown grant both return `null`.

## Rotation and revocation

Rotation:

1. Call `registry.rotate(tenantId, oldGrantId, narrowerReplacement)`.
2. Persist the new complete snapshot transactionally.
3. Deliver the replacement token once.
4. The old token now returns generic 401 at its next Relay request.

Revocation:

1. Call `registry.revoke(tenantId, grantId)`.
2. Persist the new complete snapshot transactionally.
3. Do not publish the token or digest in the audit event; record only
   `grantId`/`tokenRef`, actor, timestamp, and reason in the owning control
   plane.
4. The next Relay request fails. Long-running execution also checks authority
   through the Node Agent `authorization.checkpoint()` port. Runtime adapters
   must call it immediately before each high-risk side effect; the Node Agent
   additionally calls it before execution, each returned event, the receipt,
   and completion.

Repeated revocation is idempotent. Unknown and wrong-tenant identifiers fail
with the same generic `grant_not_found` error so the registry is not an
existence oracle.

## Restart and restore

Persist only `registry.snapshot(tenantId)`. On startup, pass the owning tenant
as `initialTenantId` together with the parsed `initialRecords`. Restore rejects
a missing tenant context or any record belonging to another tenant, and also
fails closed on unknown fields, non-SHA-256 digests, duplicate grants/digests,
invalid scope/path data, or inconsistent `status`/`usedCount` combinations. Do
not silently skip a bad row and continue.

All management reads and writes are tenant-scoped:

- `get(tenantId, grantId)`;
- `list(tenantId)`;
- `snapshot(tenantId)`;
- `rotate(tenantId, grantId, replacement)`;
- `revoke(tenantId, grantId)`.

The same `grantId` may exist in different tenants. Callers must obtain
`tenantId` from the authenticated control-plane session, never from an
untrusted route parameter or request body alone.

The embedding host is responsible for atomic snapshot replacement or a future
transactional database adapter. Until that host wiring exists, do not claim
durable production revocation.

## HTTP behavior

Fastify performs one atomic `authorize` call per request:

- missing/malformed bearer header: generic 401;
- unknown, expired, revoked, rotated, or exhausted grant: generic 401;
- known grant without the required capability: 403 `scope_denied`, no use spent;
- successful check: `usedCount` increments before ingress is invoked.

Task execution uses the stricter dual-credential flow from ADR-067. The node
badge authenticates the HTTP caller. The task grant is accepted only at the
bound task's `consume` and `checkpoint` routes. Relay derives tenant, node,
WorkOrder, run, grant reference, approved capabilities, and approved paths from
the leased task and persisted approval records. Both the approval and task
grant must explicitly be single-use (`maxUses: 1`). `consume` spends that use;
later checkpoints spend none and require evidence that the same bound grant
was already consumed. A missing task-grant authority returns 503 rather than
falling back to the node badge. The in-memory registry remains a focused test
and issuer primitive. Runnable Relay config version 3 opens the SQLite-backed
authority from `taskGrantDatabasePath` and reads a separate high-entropy issuer
secret from `taskGrantIssuerSecretEnv`, deleting that environment entry
immediately. Only after the persisted decision is an approved human decision
may the exact target node call the task-token route. Relay deterministically
derives the bound one-use token, commits only its digest, and returns the
plaintext token to that node. Consume, expiry, exhaustion, and revocation
commit before the route returns and survive restart; deterministic reissuance
cannot reset them. Digest-only `grant-import` remains a recovery/compatibility
path rather than a prerequisite for Desktop dispatch.

SSE is notification-only and never authorizes execution. A reconnect always
reauthorizes. Grant revocation does not turn an already-open SSE notification
stream into execution authority.

Approval withdrawal after an `approved` decision is a separate lifecycle from
badge/grant revocation. Relay records an append-only approval revocation and
publishes a tenant/node-scoped `approval.revoked` hint. The node still queries
the authoritative approval state at its next checkpoint, so a missed SSE frame
cannot preserve execution authority.

## Verification and leak check

```powershell
npm.cmd run typecheck -w @hummer/relay
npm.cmd run test:grants -w @hummer/relay
npm.cmd run test -w @hummer/relay
```

In production diagnostics, scan for configured bearer prefixes and the exact
one-time token value before exporting. A digest match is permitted only inside
the protected issuer persistence; public diagnostics should contain opaque
`grant:*` references instead.
