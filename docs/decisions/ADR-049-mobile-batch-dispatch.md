# ADR-049: Web start-work dispatch requires explicit in-memory Relay configuration

- Status: Accepted for W5
- Date: 2026-10-07
- Scope: Browser start-work and mobile batch dispatch

## Context

ADR-046 added an authenticated browser client for the existing Relay Fastify
boundary, but the production “开始做” flow still accepted confirmation when no
dispatch adapter existed. That could present a pending UI intent as progress
without sending a task. Mobile operators also need to send several independent
tasks without widening Relay or inventing a second backend.

The browser cannot safely derive a Relay badge from query parameters, build-time
environment variables, local storage, or application logs. Electron already has
its own IPC-backed node and injected dispatch ports and must retain precedence.

## Decision

1. A web deployment injects `window.hummerRemoteRelayDeployment` before the app
   bootstraps, providing only a Relay base URL and a badge-provider function. The
   bootstrap consumes and clears that one-shot property before rendering, then
   keeps the configuration and badge provider in module memory. Direct callers
   may use the equivalent `configureRemoteRelayDeployment` API. HUMMER does not infer either
   value from the page URL, `localStorage`, browser identity token, or logging.
2. The configuration constructs one `RemoteRelayClient`, connects its read-only
   node adapter, and exposes start-work and batch-dispatch ports. Removing the
   configuration removes those ports. There is no prototype-success fallback.
3. `WorkbenchPage` prefers an explicitly supplied dispatch port and preserves
   Electron IPC. It resolves browser Remote Relay ports only when
   `window.hummerDesktop` is absent. No Relay backend, listener, route, database,
   migration, CapabilityGrant, or tenancy gate changes are made.
4. Single-task start-work confirmation is disabled when no dispatch port exists.
   A successful state appears only after `/v1/tasks/enqueue` returns successfully;
   failures restore the pending plan and show the safe error.
5. The mobile batch panel contains 2–20 rows. Every row requires a target,
   expected deliverable, and online target node. The selected node fixes the
   target runtime; callers cannot type an arbitrary runtime.
6. Editing, adding, or removing a row clears the confirmation. Dispatch requires
   a new explicit checkbox confirmation, and an in-flight latch rejects repeated
   clicks.
7. Each row becomes an independent shared `hummer.task-envelope` v1 record with
   tenant, node, runtime, idempotency key, expiry, default-deny approval policy,
   and `hummer.work-order-task` v1 payload. The existing Relay enqueue endpoint is
   called once per row.
8. Results remain indexed per row. Successes and failures are both visible;
   401/403 failures are not retried or converted into success. Badge text is not
   included in results, persistence, URLs, or logs.

## Consequences

- An unconfigured browser is explicitly read-only for both single and batch
  dispatch while retaining planning/review behavior.
- A partially accepted batch stays partial. The operator can inspect every row;
  there is no automatic whole-batch replay that could duplicate successful work.
- Batch state is ephemeral UI state. Refreshing the page does not persist drafts,
  confirmation, badge, or results.
- The first W5 panel intentionally has no CSV import, scheduling, payment,
  CapabilityGrant administration, or cross-tenant selection.

## Verification

- RTL renders and operates the panel at a 390px viewport.
- Tests cover absent configuration, shared-envelope validation, partial 403
  failure, and double-click suppression.
- A Workbench integration test proves explicit Remote Relay configuration sends
  the confirmed start-work envelope exactly once.
- Root unit/UI suites, typecheck, build, dead-control audit, and abandoned-3D
  audit must pass before merge.
