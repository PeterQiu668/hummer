# Phase 2 local trust closure handoff

Date: 2026-10-07
Branch: `codex/phase0-fleet`
Code/evidence baseline: `fe9f377`

## Outcome

This slice closes the remaining high-value **local** trust gaps found by the completion audit:

- all seven controlled risk classes now have an exhaustive UI approval/fail-closed matrix;
- a Capability draft now requires an independently verified accepted HUMMER outcome receipt plus the exact artifact bytes and provenance bindings;
- the trusted Desktop path exports a real diagnostic ZIP from compiled main/preload code, scans its exact entries and hashes, and publishes it atomically without overwrite or partial final files.

The integrated evidence round passed 13/13 gates. This remains a credible local Alpha, not completion of Phase 0, Phase 1, or Phase 2.

## Changes

### Seven-risk approval matrix

- `egress`, `write`, `spend`, `delete`, `privilege`, `network`, and `unknown` are exhaustively typed against the canonical contract taxonomy.
- Every class exposes target/runtime, risk, cost, and its approval disposition.
- Six confirmable classes issue zero Relay enqueue calls before a human click and exactly one after it.
- `unknown` and unrecognized future values fail closed with zero decision or enqueue.

### Outcome-bound Capability drafts

- Relay independently recomputes receipt leaf hashes, root hash, canonical domain-event payloads, and hash-chain links.
- An accepted outcome must bind tenant, work order, task, node, session, evidence digest, exact artifact bytes/length/SHA-256, author receipt/evidence references, and provenance.
- Memory validates before mutation; SQLite validates inside the creation transaction.
- Receipt bodies, artifact bytes, paths, names, and customer content are verification inputs only and are not copied into capability records or audit detail.
- ADR-062 records the decision and the unsigned-receipt limitation.

### Packaged diagnostic ZIP

- The settings UI, preload and trusted main-process IPC expose authenticated export.
- The exporter walks no workspace, userData, recording or customer directory; it generates two allowlisted summaries only.
- Publication uses a unique sibling staging file, complete write, fsync/close, read-back production verification, and atomic no-overwrite hard-link publication.
- Secret-bearing input, partial staging write, publish failure and existing-target cases leave no partial final file or staging residue.

## Executable evidence

Pinned runtime: Node `v22.22.2`, Windows `x64`.

Final round: `evidence/round-p2-runtime-surfaces-3/`

- 13/13 gates passed; zero failed; zero skipped.
- Full unit: 100 files / 669 tests.
- Full UI: 22 files / 87 tests.
- Typecheck and production build passed.
- Evidence root: `c1bb895ed234399a431bcb519cc976de52284c8bca893132fc943a0bff8761da`.
- Previous root: `a9567df74445ef2e34ff5952d3c52ee858a3f9b9d1252e05b414ae5f33ee111c`.

The predecessor is the separately sealed compiled diagnostic ZIP round. Its chain already includes the real loopback Web/Relay/Node screenshots, the retained 9/10 SSE fixture failure, and the corrected 10/10 runtime round.

## Acceptance delta

Proven locally:

- `AC-P0-10` — actual diagnostic ZIP plus scan.
- `AC-P1-16` — sealed 390×844 mobile batch/confirmation/error/read-only states.
- `AC-P2-DIST-10` and `AC-P2-14` — exact eight-file export with independent verifier and tamper/forgery negatives.

Technical gaps closed, but literal acceptance still incomplete:

- `AC-P1-13` — production local outcome/receipt paths are bound, but the task is synthetic rather than a real user success.
- `AC-P1-15` — real Web and Node clients share a loopback Relay; Desktop is not in that same gate.
- `AC-P1-24` — validator and local transport are strict; no cross-host install exists.
- `AC-P2-DIST-01` — a real Windows UIAutomation source works, but there is no real expert ten-minute demonstration or full reviewable recording.
- `AC-P1-HITL-01` — the seven-class UI matrix is complete, but the wording requires true-machine negatives.

## Boundaries still pending

- Second physical Windows machine and cross-host delivery.
- Full Desktop dispatch/approve/stop against the same Relay as Web.
- Real expert demonstration, judgment marker, review, distillation, five shadows and second-machine installation.
- Authorized real GUI/CUA replay.
- Installed/signed clean-machine NSIS install, upgrade and rollback.
- Public Relay/TLS/IdP, external installs and public takedown exercise.
- Real users, real tasks, 48-hour reuse, retention and payment signal.

Nine-layer status remains incomplete: L1/L2/L6 are proven; L8 is now locally proven; L3 remains incomplete, L4 has no second machine, L5/L7 are local-only, and L9 has no authorized real GUI/CUA. The all-nine rule therefore still blocks a completion claim.

No push, deployment, real-user capture, real installation change, payment integration, deletion, or agent-hub write was performed.
