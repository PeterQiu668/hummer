# ADR-021: Abandon the 3D office product lineage

- Status: Accepted; UI dependency cleanup tracked separately
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
- This contract-agent commit does not alter UI paths or remove packages outside its declared ownership. Therefore dependency cleanup and `audit:dead-controls` evidence are not claimed complete here.

## Verification

The implementation owner must show an import/route search with zero live 3D paths, a focused before/after dependency diff, `npm run audit:dead-controls`, `npm run typecheck`, and `npm run build`. Historical evidence files must remain byte-identical.
