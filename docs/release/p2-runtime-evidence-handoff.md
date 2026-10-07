# Phase 2 local runtime evidence handoff

Date: 2026-10-07  
Branch: `codex/phase0-fleet`  
Integrated evidence commit: `03505e4`

## Outcome

This slice replaces three important local simulations with executable boundaries:

- the browser gate now uses a real Fastify Relay listening on random loopback, the production browser client, and the production Node Relay client against one shared store;
- a real Windows UIAutomation adapter reads bounded accessibility metadata from an explicitly selected process and exact allowlisted fixture window;
- trusted capability bundles can use an immutable SQLite Relay store and survive restart without losing the approved gate evidence.

It also adds and seals a dependency-free verifier for the exact eight-file Agent Skills export. These changes strengthen the local Alpha; they do **not** complete Phase 0, Phase 1, or Phase 2.

## Integrated commits

- `a8aab12` — independent capability export verifier.
- `58c8965` — forged inner-receipt negative after recomputing outer hashes.
- `bcc6b13` — durable SQLite trusted-bundle Relay store (ADR-060).
- `19f66f9` — real loopback Web/Relay/Node browser gate and sealed 390 px screenshots.
- `c71d54f` — bounded production Windows UIAutomation metadata path (ADR-061).
- `60dcfc6` — remove real-wall-clock expiry from the ordinary SSE fixture while retaining explicit expiry cases.

## Executable receipt

Pinned runtime: Node `v22.22.2`, Windows `x64`.

Final round `evidence/round-p2-runtime-surfaces-2/` passed 10/10 gates:

- Windows UIAutomation: 32 assertions, 18 negative cases; a self-built WinForms fixture exposed four local nodes.
- Durable trusted bundle: 8 assertions, 20 negative cases.
- Independent capability verifier: 8 assertions, 23 negative cases.
- DemoSession, public marketplace, privacy and contract gates passed.
- Full test: 97 unit files / 657 tests and 21 UI files / 77 tests passed.
- Root typecheck passed.
- Production build passed (2,385 transformed modules); the existing chunk-size warning remains non-blocking.

Evidence chain:

| Round | Result | Root hash | Previous root |
|---|---|---|---|
| `round-p2-surfaces-1` | passed | `b4ccd48753f577ab398880dcb0266a75361c2463faf64ac617047098795fe9cc` | `3709c6b3de25c440e05eef670789e59f84bf842c098521c80823d95c48789923` |
| `round-p1-real-web-relay-e2e-integration-20261007a` | passed | `2a4799d335f3858f9dd081c7136511dd598255833bd4da7f2712e2c03d50479c` | `b4ccd48753f577ab398880dcb0266a75361c2463faf64ac617047098795fe9cc` |
| `round-p2-runtime-surfaces-1` | failed 9/10 and retained | `971cdb5a89f811a695a27dd33395e9fd35f32ea39f09291358b42500456985d1` | `2a4799d335f3858f9dd081c7136511dd598255833bd4da7f2712e2c03d50479c` |
| `round-p2-runtime-surfaces-2` | passed 10/10 | `949ad6e2228d094e5462ba07d40e08b649c8deb1a0a57e5a793a8c1853578d9c` | `971cdb5a89f811a695a27dd33395e9fd35f32ea39f09291358b42500456985d1` |

The retained failed round exposed a fixture defect: ordinary SSE badge expiry was fixed to `2026-10-07T01:00:00Z`, while stream expiry correctly used the real wall clock. At 01:03Z the stream closed after `connected`. Expiry-specific tests still use explicit expired timestamps; the corrected target test passed ten consecutive runs before the successful full round.

## Safety and contract boundaries

- No public contract schema or historical migration was changed.
- UIAutomation stores role and automation id only; descendant accessible names are stripped because editable names can mirror typed text.
- No screenshot, video, raw keyboard text, input hook, customer recording, upload, public deployment, real install, payment code, push, or agent-hub write occurred.
- The SQLite adapter is a local reference, not HA/backup/encryption/Postgres/RLS evidence.
- The Web gate is loopback with synthetic identity and static test badges, not TLS, production IdP, public deployment, or two-machine evidence.

## Acceptance still pending

- A second physical Windows machine and real cross-host delivery.
- A real expert demonstration, distillation acceptance, and authorized GUI/CUA replay.
- Capability draft creation from an independently verified successful HUMMER task receipt rather than fixture event identifiers.
- Installed-app/native save-dialog automation for diagnostic export (the later
  compiled Electron main/preload gate now covers the production export service
  and actual ZIP scan without installing NSIS).
- Clean-machine signed installer/upgrade/rollback proof.
- External users, real tasks, retention, external capability installs, public takedown, and payment signal.

## Recommended next local slice

Bind capability draft creation to an independently verified HUMMER outcome receipt without copying customer content. Preserve the current fail-closed rule: an invalid receipt, failed task, missing artifact, tenant mismatch, or provenance mismatch must create no draft. External-machine, installed-app/native-dialog, and market gates require user coordination and must remain pending.
