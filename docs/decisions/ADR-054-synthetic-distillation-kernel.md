# ADR-054: Synthetic W8 grounding and distillation kernel

- Status: accepted
- Date: 2026-10-07
- Scope: Phase 2 W8 local kernel only

## Context

ADR-051 established a local `DemoSession` privacy boundary, and ADR-052 added a
side-effect-free replay kernel. HUMMER still needs the W8 seam between those
layers: evidence-bound GUI grounding, a reviewable dual-track capability draft,
and a correction lifecycle that cannot silently guess, rewrite history, or
invent trial evidence.

The current milestone has no real accessibility-tree reader, screenshot model,
ten-minute expert recording, or abstraction LLM. Using hand-written fixtures as
proof of those capabilities would violate the product's evidence rules.

## Decision

Create an isolated `@hummer/distillation` package. It changes no shared contract
semantics and accepts only records whose schema explicitly marks them as
synthetic structured fixtures.

### Replaceable, fail-closed grounding

`GuiGroundingAdapter` is a port rather than a model-specific implementation. A
successful result must identify exactly one element, name its matching method,
bind itself to the exact source record and evidence reference, and meet a
configured confidence threshold. Adapter failure, exceptions, ambiguity, low
confidence, malformed results, and evidence mismatches produce a
`needs-human` result and no partial draft.

This kernel never chooses a likely element when the adapter cannot establish
the binding. A real Windows UIAutomation or GUI-model adapter is later work.

### Dual-track author draft

An ended, valid `DemoSessionV1` plus a complete set of active-segment records is
compiled into:

- capability and bounded-behavior tracks;
- the exact source list;
- grounded actions; and
- at least one explicit `needs-human` judgment annotation.

The output uses the existing `CapabilityPackageAuthorInput` contract. That
contract is the human-authored portion of `CapabilityPackageV1`; a final
`CapabilityPackageV1` also requires a system-derived `trialRecord`. W8 must not
fabricate a trial record, so the result remains `draft` and
`needs-human-review` until W9 supplies real execution evidence.

### Bounded correction and append-only rollback

Natural-language correction is limited to two documented grammars: replacing
one exact capability-track item, or appending one
`{scene, wrong, correct}` behavior record. Unbounded prose is rejected rather
than interpreted speculatively.

Each proposal is bound to tenant, package ID, base version, and base digest. A
proposal digest detects alteration. Applying a valid proposal increments the
package version and links it to the prior digest. Rollback never mutates or
deletes history; it appends a new version containing an earlier reviewable
state and records the target in the audit trail.

## Executable gate

`npm run test:distillation` proves the synthetic kernel and includes negative
cases for:

1. grounding failure, ambiguity, low confidence, and evidence mismatch;
2. a missing provenance source;
3. no human-judgment annotation;
4. unknown record fields;
5. altered and cross-package corrections;
6. invalid rollback targets; and
7. unbounded correction prose.

## Consequences and explicit limitations

- No real screen/AX capture or real GUI grounding model is implemented.
- No real ten-minute expert demonstration is processed.
- No claim is made about LLM abstraction quality, GUI accuracy, or fidelity to
  an expert.
- The kernel does not produce a trusted `trialRecord`, verified status, signed
  receipt, public listing, or installable package.
- `AC-P2-DIST-05` remains **not complete**. It requires a real ten-minute
  demonstration that a human reviews and that includes at least one genuine
  human-judgment annotation.
