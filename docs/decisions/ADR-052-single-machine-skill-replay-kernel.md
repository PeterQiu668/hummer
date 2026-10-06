# ADR-052: Single-machine skill replay kernel and promotion evidence

- Status: accepted
- Date: 2026-10-07

## Context

Capability packages already carry system-recorded `SkillTrial` facts, a
`regressionSuiteRef`, and an install gate. They do not yet have an executable
replay or regression kernel. Accepting a caller-provided `regressionPassed`
boolean is not enough to prove that a suite ran, and a failure without a step
reference is not actionable.

W9 needs a small, honest local kernel before any GUI or public-market work. It
must not pretend that synthetic adapters are a real expert recording, GUI/CUA
execution, or external installation.

## Decision

Create `@hummer/skill-replay` as an isolated package. It does not change the
shared capability contract. It consumes `CapabilityPackageV1` and emits
contract-valid `SkillTrialSystemRecordInput` records.

### Compiled plans and adapters

A compiled plan is bound to one package ID, version, and digest. Steps have
stable IDs, explicit dependencies, and a named adapter. Plans reject duplicate
steps, missing/forward dependencies, package mismatches, and missing adapters.

The W9 kernel only accepts adapters that declare both `deterministic: true` and
`sideEffects: "none"`. This makes local shadow/replay tests meaningful without
claiming a real desktop or CUA integration. Adding an external-effect adapter
requires a later ADR and host approval boundary.

Step input is derived only from the immutable case input, immutable step input,
and prior step outputs. The replay digest excludes run IDs and timestamps so
the same plan and input can be compared across runs. A failed adapter produces
a failed system trial whose `failureStepRef` is the exact compiled step ID.

### Live-mode approval

Shadow mode never needs approval because the accepted adapters have no external
side effects. Live mode requires a complete approval record, not a bare boolean.
The approval must be `approved`, decided by a `human:*` actor, and bound to the
same tenant, package digest, plan digest, and `capability.live-replay` action.
The resulting system trial carries that approval reference.

This validates the approval boundary only. It is not evidence of real GUI/CUA
execution.

### Regression and promotion

A regression suite is bound to the exact package and compiled plan. Every case
has immutable input and an expected output digest. The kernel executes every
case in shadow mode and derives a report and evidence digest from the case
results. Promotion does not accept a `passed` parameter.

Promotion is approved only when:

1. at least five unique contract-valid shadow trials are present;
2. every trial is bound to the exact package and succeeded;
3. the regression report is internally digest-valid, bound to the package and
   plan, contains at least one case, and every case passed.

On approval, the existing contract helper derives the aggregate `TrialRecord`.
The kernel returns a decision; it does not mutate package status or publish a
capability.

## Consequences and limitations

- `npm run test:skill-replay` is the executable W9 local gate.
- Replay failures are attributable to a compiled step.
- Regression evidence is derived from executed cases instead of an unstructured
  caller boolean.
- No screen capture, accessibility tree, GUI grounding, CUA, external write,
  public marketplace, payment, settlement, or real expert-fidelity claim is
  introduced.
- Real adapters, host persistence, signed receipts, and multi-machine replay
  remain later integration work.
