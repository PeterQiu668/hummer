# ADR-021: Abandon the 3D office product lineage

- Status: Accepted; dependency cleanup executed 2026-10-07
- Date: 2026-10-07
- Milestone: D1

## Context

The repository still carries presentation dependencies and paths from an abandoned 3D-office prototype. The current product goal is a restrained enterprise control plane: one task entry, clear plans and approvals, fleet state, trustworthy results, and verifiable receipts. Preserving an alternate 3D navigation lineage increases bundle weight and creates dead controls without improving that loop.

## Decision

1. The 3D office is not a product surface, fallback experience, hidden route, experiment flag, or compatibility requirement for HUMMER Phase 0 and later phases.
2. The default first screen has one task entry. Fleet, approval, result, receipt, and settings views are reachable from that product loop; a 3D world is not.
3. `three`, `@react-three/fiber`, `@react-three/drei`, and 3D-only assets/components are removal candidates once a path and import audit proves they have no remaining non-3D consumer.
4. Cleanup must remove routes, imports, controls, tests, and dependencies together. Hiding a control with CSS, leaving an unreachable route, or suppressing `audit:dead-controls` is not removal.
5. Historical evidence and migrations are not rewritten or deleted. This ADR changes the forward product lineage only.
6. Reintroducing a 3D office requires a new ADR with a validated user need, measurable acceptance criteria, bundle/runtime cost, accessibility plan, and proof that it does not fragment the single-entry workflow.

## Consequences

- Product and fleet work no longer need to preserve 3D component APIs or visual navigation.
- Bundle reduction and dependency removal can proceed as a focused UI-owned change.
- The original contract-only decision did not alter UI paths or packages. The subsequent UI-owned cleanup slice removed only the four proven 3D roots and added a regression audit; no product behavior changed.

## Verification

The implementation owner must show an import/route search with zero live 3D paths, a focused before/after dependency diff, `npm run audit:dead-controls`, `npm run typecheck`, and `npm run build`. Historical evidence files must remain byte-identical.

## Implementation evidence (2026-10-07)

Baseline: `49a11c67ed38f569b2ca5b6b66c7ac7af5dd41bb` on `codex/phase0-3d-cleanup-agent`.

### Live-path and dependency audit

- `rg` over `src`, `apps`, `packages`, `tests`, and `scripts` returned no import of `@react-three/drei`, `@react-three/fiber`, or `three`; no `OfficeStage3D`, `Office3D`, `components/office`, or `/office` route reference; and no matching live-source path.
- Before cleanup, `npm ls @react-three/drei @react-three/fiber three @types/three --all` showed one isolated 3D dependency tree rooted only at the four direct declarations.
- Removed root dependencies: `@react-three/drei`, `@react-three/fiber`, `three`, and `@types/three`.
- `package-lock.json` contains no remaining package entry or dependency declaration for those four names after `npm install --package-lock-only --ignore-scripts`.
- `scripts/audit-abandoned-3d-lineage.mjs` now rejects any reintroduced root dependency, live module reference, 3D-office source path or identifier, or `/office` route. The audit was first observed failing on all four old declarations, then passing after removal. It is part of `npm test` as `audit:abandoned-3d`.

### Explicitly retained dependencies

- `framer-motion` remains because it has nine live imports in the current React UI.
- `gsap` and `reactflow` remain. Neither is a 3D-specific package, neither is named by this ADR's accepted removal set, and this focused slice does not claim the broader product-lineage proof required to remove them.

### Footprint and bundle result

| Measurement | Before | After | Change |
|---|---:|---:|---:|
| npm audited package count after clean install | 746 | 687 | -59 |
| `package-lock.json` bytes | 380,709 | 354,736 | -25,973 (-6.82%) |
| `node_modules` files | 31,493 | 25,221 | -6,272 (-19.92%) |
| `node_modules` bytes | 527,142,134 | 385,549,603 | -141,592,531 (-26.86%; 135.03 MiB) |
| Vite JS bundle | 557,919 bytes | 557,919 bytes | unchanged |
| Vite JS gzip | 170.80 kB | 170.80 kB | unchanged |

The unchanged bundle hash (`index-COVoSNix.js`) proves the abandoned packages were already unreachable from the production graph; the measurable gain is install and lockfile footprint rather than shipped JavaScript.

### Gates and preservation

- `npm run audit:dead-controls`: passed.
- `npm run audit:abandoned-3d`: passed.
- `npm run typecheck`: passed.
- `npm run build`: passed; 1,993 modules transformed.
- `npm test`: passed; 59 unit files / 261 unit tests and 15 UI files / 46 UI tests.
- `git diff --exit-code 49a11c6 -- evidence`: passed, so historical evidence remains byte-identical to the baseline.
