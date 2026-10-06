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
4. Persist `registry.snapshot()` transactionally before acknowledging issuance.
5. Deliver the non-enumerable `issued.token` once over the authenticated
   provisioning channel. Ordinary `JSON.stringify(issued)` emits only the safe
   grant record, but direct token access remains secret handling.
6. Discard the plaintext value from control-plane memory. Do not stringify,
   log, trace, capture, or include the `IssuedCapabilityGrant` wrapper in a
   receipt.

The safe object for logs, UI, audit, evidence, and diagnostics is
`issued.grant` or `registry.get(grantId)`. It contains `tokenRef` but no token or
digest. The durable snapshot contains a SHA-256 digest, never the token.

## Rotation and revocation

Rotation:

1. Call `registry.rotate(oldGrantId, narrowerReplacement)`.
2. Persist the new complete snapshot transactionally.
3. Deliver the replacement token once.
4. The old token now returns generic 401 at its next Relay request.

Revocation:

1. Call `registry.revoke(grantId)`.
2. Persist the new complete snapshot transactionally.
3. Do not publish the token or digest in the audit event; record only
   `grantId`/`tokenRef`, actor, timestamp, and reason in the owning control
   plane.
4. The next Relay request fails. Long-running execution must also check
   revocation at node-agent checkpoints; that W3 hook is not implemented here.

Repeated revocation is idempotent. Unknown grant identifiers fail explicitly.

## Restart and restore

Persist only `registry.snapshot()`. On startup, pass the parsed records as
`initialRecords`. Restore fails closed on unknown fields, non-SHA-256 digests,
duplicate grants/digests, invalid scope/path data, or inconsistent
`status`/`usedCount` combinations. Do not silently skip a bad row and continue.

The embedding host is responsible for atomic snapshot replacement or a future
transactional database adapter. Until that host wiring exists, do not claim
durable production revocation.

## HTTP behavior

Fastify performs one atomic `authorize` call per request:

- missing/malformed bearer header: generic 401;
- unknown, expired, revoked, rotated, or exhausted grant: generic 401;
- known grant without the required capability: 403 `scope_denied`, no use spent;
- successful check: `usedCount` increments before ingress is invoked.

SSE is notification-only and never authorizes execution. A reconnect always
reauthorizes. Grant revocation does not turn an already-open SSE notification
stream into execution authority.

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
