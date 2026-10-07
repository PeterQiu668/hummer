# ADR-057: Public marketplace Relay and web surface

Status: Accepted for the W10 local surface
Date: 2026-10-07

## Context

ADR-055 established the authoritative local marketplace kernel: verified packages,
system trials, a redacted public projection, reports, human moderation, and reuse
of the trusted install gate. It deliberately left HTTP and browser exposure
pending. The old `Marketplace.tsx` and `src/data/marketplace.ts` contain prototype
people, ratings, prices, and `localStorage` writes. Those values are not product
facts and cannot back W10.

## Decision

The Relay exposes the ADR-055 projection through two anonymous read-only routes:

- `GET /v1/public/capabilities`
- `GET /v1/public/capabilities/:listingId`

An absent marketplace adapter returns `503 public_market_unavailable`; it never
falls back to sample data. A taken-down listing returns `404` and is absent from
browse.

State-changing routes require narrow badges:

- `marketplace.report` records a human member's report. The public receipt omits
  reporter tenant and actor identity, and the report does not change listing
  visibility.
- `marketplace.moderate` is available only under the protected moderation path
  and only to a human member of the configured moderation tenant. A public caller
  cannot invoke takedown.
- `capability.install.evaluate` accepts the complete existing install-gate
  evidence from a trusted host/service. The badge tenant and actor must match the
  target and requester. Approval is authorization evidence only; no remote bundle
  transport or host materialization is claimed.

The existing “能力与连接” page gains an “能力网络” tab backed only by the
configured Remote Relay. It displays provenance summaries, trial and failure
counts, declared permissions, receipt references, and package integrity digests.
With no Relay it is explicitly unavailable; with no trusted installer it is
explicitly read-only. It never reads or writes the legacy marketplace mocks or
`localStorage`.

The browser keeps a small runtime validator for the HTTP projection. It is a
fail-closed transport boundary, not a second domain model or fact source. An
executable consistency test creates a real projection through
`PublicMarketStore`, proves that it passes the browser validator, and proves that
missing, unknown, or sensitive injected fields fail. The native SQLite-backed
package is intentionally not bundled into the browser.

## Consequences

- Local Relay browse/detail/report/moderation/takedown and web rendering are
  executable end to end.
- A report cannot auto-takedown a listing; human moderation remains a separate,
  audited store action.
- 401 and 403 responses are returned to the caller without automatic retry.
- The legacy employee-market prototype remains non-authoritative and is not used
  by the new surface.
- Public deployment, real external installers, ten third-party installs, price,
  orders, settlement, payment, rating, and ranking remain out of scope.

## Verification

`npm run test:public-market-e2e` runs the real-store/Relay/client boundary tests
and the 390px browser surface tests. `npm run test:public-market` remains the
domain and migration gate.
