# ADR-036: Node agent is single-tenant and preflights execution output

- Status: Accepted for W4 P0 remediation
- Date: 2026-10-07
- Scope: `apps/node-agent`

## Context

`HummerNodeAgent` is configured with one node ID, one tenant ID, and one
node-scoped grant. The journal and in-memory claim state were already scoped to
that pair, but three outbound surfaces did not enforce the same boundary after
shared-contract validation:

1. a valid NodeManifest could advertise a foreign tenant or multiple tenants;
2. a valid RunEvent could name a foreign tenant, node, or WorkOrder; and
3. a valid OutcomeReceipt could name or embed a foreign tenant or WorkOrder.

The receipt check also has to happen before sending preceding events. Otherwise
a rejected receipt could still leave a partial foreign or misbound event stream.
Shared schema validation proves shape, not authorization for the active local
execution.

## Decision

1. The current node-agent mode is strictly single-tenant. Every heartbeat
   manifest must name the configured node and exactly the configured tenant.
   Foreign, empty, or multi-tenant manifests fail locally before transport.
2. Multi-tenant node execution is not enabled by this ADR. Supporting it later
   requires an explicit authorization contract and tenant-partitioned journal,
   claim cache, recovery state, workspace roots, and per-task capability grant.
3. The configured grant remains bound to the agent's tenant and node. Accepted
   TaskEnvelopes, approval requests and decisions continue to require that same
   tenant/node/WorkOrder execution lineage.
4. After executor output passes shared-contract validation, the node preflights
   the entire batch before sending anything. Every RunEvent must match the
   active tenant, node, and WorkOrder. The OutcomeReceipt must match the active
   tenant and WorkOrder, and every nested `tenantId` fact in the validated
   receipt must match the active tenant.
5. Only after all events and the receipt pass preflight may the node submit the
   events and then the receipt. A mismatch submits neither.
6. Scope failures use stable generic codes and messages. They do not include
   the supplied foreign tenant, node, WorkOrder, claim, token, or artifact
   reference.
7. One agent instance owns one claim cache and one tenant/node journal scope.
   Reopening a file journal under another tenant or node continues to fail with
   the same generic `journal_scope_mismatch` result. Journals store identifiers
   and hashes, not grant tokens, raw envelopes, receipt bodies, or workspace
   paths.
8. `apps/node-agent` currently contains no filesystem workspace implementation;
   its MCP facade delegates to injected trusted handlers. This remediation does
   not invent a workspace feature or imply cross-tenant workspace safety. A
   future implementation must establish tenant-owned roots and task-grant path
   checks before multi-tenant mode can be enabled.
9. Relay, desktop, root scripts, wire schemas, and database schemas are
   unchanged.

## Safety properties and limitations

- A default node cannot advertise multiple tenants or emit output for another
  tenant, node, or WorkOrder through the node-agent transport.
- A bad receipt cannot cause an otherwise valid preceding event to be sent.
- Same-process agents have separate local caches and grants, but sharing a
  process is not an authorization mechanism; each instance is still exactly
  one tenant/node principal.
- Shared validators and injected executors/handlers remain trusted ports. The
  node adds binding checks after validation, but this ADR does not attest to
  filesystem isolation outside `apps/node-agent`.
- The current grant is node-scoped, not a new per-task capability-grant format.
  Per-task grants are a prerequisite for any future explicit multi-tenant mode.

## Verification

The stable marker is `[TEN-P0F-NODE-AGENT-BOUNDARY]`.

- Accept an exact single-tenant manifest; reject foreign, multi-tenant, and
  wrong-node manifests before a heartbeat is sent.
- Reject a foreign RunEvent before any event or receipt is sent.
- Reject a foreign primary receipt binding and an embedded foreign tenant fact
  before any event or receipt is sent.
- Run two tenant agents with colliding local claim IDs and prove their caches,
  journals, grants, and transport contexts remain independent.
- Restart a file journal under another tenant and another node; prove both fail
  with the same generic error and the journal contains no token, raw envelope,
  artifact path, or receipt body.

Run:

```powershell
npm.cmd run test:tenancy -w @hummer/node-agent
npm.cmd run typecheck -w @hummer/node-agent
npm.cmd test -w @hummer/node-agent
```
