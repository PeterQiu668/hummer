# ADR-063: Keep Desktop Relay authority in the Electron main process

- Status: accepted
- Date: 2026-10-07
- Scope: Desktop-to-Relay control plane

## Context

The browser client can receive an in-memory Relay badge from its deployment
boundary, but copying that pattern into the Electron renderer would expose a
long-lived control credential to page JavaScript and to any compromised
renderer dependency. The Desktop also has its own authenticated identity
session, so a Relay badge bound to a different tenant or actor must be rejected
before a task, approval decision, or stop request can mutate remote state.

## Decision

The Relay URL, opaque badge, expected tenant, and expected human/account actor
are trusted Electron-main configuration. Packaged Desktop reads them from
`HUMMER_RELAY_BASE_URL`, `HUMMER_RELAY_BADGE_TOKEN`,
`HUMMER_RELAY_TENANT_ID`, and `HUMMER_RELAY_ACTOR_REF`; tests and supervised
hosts may inject the same four values explicitly. The badge environment entry
is deleted immediately after bootstrap reads it so runtime child processes do
not inherit it.

The preload exposes only typed task operations. It never exposes the Relay URL
or badge. Every operation passes the existing Desktop identity-session token to
main, where the token is resolved to the active tenant and named account actor.
Both must exactly match the trusted Relay configuration before any network
request.

The Relay adds an authenticated `GET /v1/control/session` projection guarded by
the existing `node.read` scope. It returns only the badge tenant and actor. Main
calls it before every Relay operation and requires an exact match, preventing a
wrong-tenant badge from producing side effects before a response-level tenant
check can run. Task, node, approval, and nested envelope/request responses are
also checked for the expected tenant before they cross preload.

Renderer approval input is limited to request id, `approved`/`denied`, and an
optional rationale. For approval, main retrieves the pending request, verifies
its binding and expiry, and derives the granted capabilities, paths, max uses,
and expiry from the requested scope. Renderer code cannot provide or widen a
grant. The decision tenant and decider actor come only from trusted main state;
the Relay independently checks both against badge claims.

Relay endpoints accept HTTPS only. Plain HTTP is permitted only for
`localhost`, `127.0.0.1`, or `[::1]` development endpoints. Badge values are
private fields, never logged or returned, are redacted from Relay failures, and
cause an otherwise successful response to be rejected if echoed.

## Contract impact

This adds one authenticated Relay projection and a Desktop preload port. It does
not change any `@hummer/contracts` schema, database migration, receipt version,
or v1-v10 historical migration byte. Existing browser Relay injection remains
unchanged.

## Consequences and limits

- Desktop can now use the same real Relay as Web without placing its badge in
  renderer memory, local storage, logs, screenshots, or runtime child process
  environments.
- The configured control badge must include `node.read`, `task.enqueue`,
  `task.read`, `task.stop`, `approval.read`, and `approval.decide` for the full
  port.
- Configuration is currently one trusted tenant/account binding per Desktop
  process. Switching to another tenant or account requires a supervised restart
  with a separately issued badge.
- This change supplies the production port and focused tests. It does not prove
  a packaged two-process Electron run, a second physical machine, production
  TLS/IdP provisioning, public deployment, or a real external task.
