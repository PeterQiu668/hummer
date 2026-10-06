# ADR-048: Relay capability registry and trusted evaluation boundary

- Status: accepted
- Date: 2026-10-07
- Scope: `apps/relay/src/**`, Relay schema 15

## Context

ADR-045 defines capability contracts but deliberately does not authenticate the
authors of trial or install-gate evidence. W5 needs a tenant-qualified registry
that makes version history, trial aggregation, read-only sharing, and install
decisions authoritative across both in-memory and SQLite Relay deployments.

## Decision

Relay schema 15 adds `capability_packages`, `capability_trials`,
`capability_shares`, and `capability_install_decisions`. Existing schema 11-14
is unchanged. Package identity is `(tenant_id, package_id, package_version)`.
SQLite creates a version only inside one transaction after loading and checking
the complete history; the unique primary key is the final CAS. Immutable package
content and every trial/share/decision have update/delete guards. Trial-derived
status and aggregate fields may advance, but a shared snapshot accepts no later
trial.

A draft is admitted only when its source task is completed and every
`evidenceRef`, plus `receiptRef`, resolves to an event from that same task. The
explicit artifact and completed event references must have the corresponding
event types. This prevents a valid completed task from laundering unrelated
evidence identifiers.

Trial recording requires both the dedicated `capability.trial.record` scope and
the authenticated `system:skill-trial` principal on a registered node. Relay
binds tenant, node, package version, package digest, and globally tenant-unique
trial ID before aggregating. Five unique successful shadow runs and a passing
regression are required before sharing.

Cross-tenant sharing is a read-only snapshot. Relay derives invitation evidence
from an active identity-provider tenant grant carried by the authenticated badge;
the request cannot supply an arbitrary invitation. The target tenant can list,
get, and request trusted install evaluation, but cannot modify, version, copy, or
re-share the source package. Catalog records for the target are projected from
the embedded immutable share package, never from later source-table state.

Install evaluation requires the dedicated scope and exact
`system:capability-install-gate` principal. That service submits the complete
contract evidence, including failed evidence. Relay does not manufacture
successful checks. Submitted share ID, target, package digest, and share digest
must exactly match the persisted share. Relay then binds current store time,
recomputes `requestDigest`, evaluates, and appends the decision. Cross-tenant
invitation expiry therefore cannot be bypassed with an old `evaluatedAt`.

All HTTP tenant context comes from the badge. Foreign and unknown package/share
references return the same tenant-local not-found response.

## Consequences

- This phase stores metadata and decisions only. It does not install files,
  publish a public marketplace, price capabilities, or process payment.
- The identity provider remains responsible for issuing and expiring cross-tenant
  grants; Relay only consumes authenticated badge claims.
- Real static/provenance/receipt verification runs outside Relay and must use the
  trusted install-gate service identity. Relay preserves and evaluates its
  evidence but cannot truthfully recreate those checks from hashes alone.
