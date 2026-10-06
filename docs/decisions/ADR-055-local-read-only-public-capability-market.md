# ADR-055: Local read-only public capability marketplace kernel

Status: Accepted for the W10 local kernel
Date: 2026-10-07

## Context

W5 provides tenant-bound read-only sharing and a fail-closed capability install
gate. W10 needs a public discovery surface, but it must not turn the old
`Marketplace.tsx`/`localStorage` mock into a product fact, invent marketplace
trust, or cross the Phase 3 boundary into price, orders, settlement, or payment.

Public discovery also creates two new risks. First, the complete capability
package contains tenant and device identifiers that must not be exposed in a
public feed. Second, a report must not become an automatic takedown mechanism:
the moderation action is a distinct human decision with an audit record.

## Decision

Migration v15 is additive. Migrations v1-v14 are unchanged. It introduces:

- `capability_packages`, containing a strict, contract-valid shared package and
  its existing package digest as the integrity summary;
- `skill_trials`, containing only system-recorded trial facts bound to the
  exact package tenant, identity, version, and digest;
- `listings`, containing a redacted public projection rather than the complete
   package. Free-form failure notes are exposed only as counted, hashed records,
   not raw author text;
- `marketplace_reports` and `marketplace_moderation_actions`, separating a
  report from a human takedown decision;
- `marketplace_install_attempts`, recording the result of the existing trusted
  install gate.

The local `@hummer/public-market` package owns the domain and SQLite store and
depends directly on the authoritative `@hummer/contracts` package. The desktop
layer owns only migration v15; it does not import the marketplace package or a
workspace TypeScript export at runtime. This avoids a hand-copied contract and
keeps the shared capability schemas as the single source of truth.

`PublicMarketStore` applies these rules:

1. Registration requires an actual active human membership in the source
   tenant, a `shared` package, five or more successful shadow trials, no failed
   trial, a passing regression, and an aggregate reproduced from the exact
   persisted system trial records.
2. Publishing is source-tenant-only. Public reads expose title, goal, a hashed
   publisher reference, summarized provenance/source boundary, aggregate trial
   and failure records, declared permissions, receipt reference, and package
   integrity digest. They do not expose tenant IDs, expert actor IDs, node/device
   IDs, demo-session IDs, evidence IDs, source paths, or raw trial records.
3. Install authorization calls the existing
   `createCapabilityInstallGateDecision`. The gate must be bound to the exact
   persisted package and target tenant. A permission expansion is denied and
   recorded. An approved decision is authorization evidence only; it does not
   claim remote bundle transport or host materialization.
4. A reporter must be an active human member of the reporter tenant. Reporting
   leaves the listing public. Only an active human member of the configured
   marketplace moderation tenant can create a takedown action. A taken-down
   listing cannot be browsed, authorized for installation, deleted, or
   republished.
5. Authorization failures are opaque and identical for wrong-tenant and forged
   actors so callers cannot use write paths to discover tenant-owned resources.

The package digest is explicitly an existing integrity summary, not a digital
signature or legal identity assertion.

## Consequences

- AC-P2-11 and AC-P2-12 now have an executable local domain/persistence path,
  including a mandatory negative permission case and report-to-human-takedown
  rehearsal.
- Public HTTP exposure, production moderation operations, public UI, remote
  installer transport, and ten real third-party installs are still pending.
- The old mock marketplace remains non-authoritative and is not read or written
  by this kernel.
- No price, order, rating, ranking, settlement, or payment object is introduced.

## Verification

`npm run test:public-market` executes the v15 upgrade, membership and tenancy
negative cases, redaction assertions, exact-package install gate, over-permission
denial, non-automatic report handling, human takedown, and post-takedown browse
and install denial.
