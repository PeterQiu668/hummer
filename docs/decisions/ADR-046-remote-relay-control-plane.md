# ADR-046: Browser control clients use the authenticated Relay boundary

- Status: Accepted for W5
- Date: 2026-10-07
- Scope: Relay read control plane and browser client

## Context

The web console needs a small remote view of fleet nodes, tasks, and pending
approval requests, plus mobile task dispatch. Creating a second service or
teaching a browser to access Relay storage would duplicate authority and break
the existing Fastify/FleetTransport boundary. The previous execution-node
browser branch also silently fell back to prototype behavior, so deployment
configuration errors looked like an empty feature rather than an absent remote
connection.

## Decision

1. Existing Relay Fastify serves the authenticated control plane. It exposes
   tenant-local list/get routes for nodes, tasks, and approval requests. No new
   listener, anonymous route, schema version, or persistence owner is added.
2. Read routes require the least-privilege `node.read`, `task.read`, or
   `approval.read` badge scope. Tenant identity comes only from the authorized
   badge. Query fields, including `tenantId`, are rejected instead of overriding
   that identity.
3. Every store list method takes an explicit `tenantId`. Memory and SQLite
   filter before returning records and keep liveness/lease recovery behavior
   equivalent to the corresponding tenant-qualified get operation.
4. A foreign identifier and an unknown identifier both return the same generic
   `control_resource_not_found` 404 response. Lists return only records in the
   authenticated tenant.
5. The browser fetch client is constructed with an explicit Relay base URL and
   an in-memory badge provider. It does not read or write local storage and does
   not log badge material. HTTP errors expose status and safe Relay error fields,
   never the bearer value. Remote URLs must use HTTPS; plaintext HTTP is accepted
   only for `localhost`, `127.0.0.1`, or `[::1]` development endpoints.
6. Mobile batch enqueue reuses `POST /v1/tasks/enqueue`. Each input is submitted
   exactly once and receives an indexed success or failure result. The client
   performs no automatic retries, including for 401 and 403 responses.
7. The execution-node client keeps the Electron IPC path unchanged and gives it
   precedence. A browser Relay path exists only after explicit configuration;
   without it the port remains unavailable. Remote execution-node control is
   read-only, so `killAll` fails closed.

## Consequences

- Web/mobile callers can inspect and dispatch through one existing authority
  boundary without direct database access.
- Badge provisioning and UI wiring remain deployment concerns; this change does
  not persist a badge, add UI, add CapabilityGrant management, or add payments.
- List endpoints are deliberately unpaginated for the W5 minimum control plane.
  Pagination requires a later contract decision before fleet scale.
- No attempt is made to hide ordinary network latency; the guarantee here is
  identical status/body for foreign and unknown references, not constant-time
  HTTP behavior.

## Verification

- Run the same list/get isolation contract against Memory and SQLite.
- Verify Fastify rejects caller tenant override and returns identical foreign
  and unknown responses for every resource type.
- Verify browser read requests use an in-memory bearer without localStorage or
  logging, and batch enqueue calls each item once while preserving partial
  401/403 failures.
- Run Relay tests/typecheck and root unit tests/typecheck/build.
