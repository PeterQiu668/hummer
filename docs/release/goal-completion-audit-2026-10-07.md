# Goal completion audit — 2026-10-07

Audited baseline: `6490f3a`
Implementation checkpoint under audit: `6ce9dac`
Normative source: `HUMMER×AgentHub_内测底座_Codex目标模式主提示词_v1.1.md`

## Decision

The repository is a credible local Alpha substrate. It is **not** evidence that Phase 0, Phase 1, or Phase 2 is complete. The strongest remaining risk is not unit-test quality; it is that several primary user stories have only synthetic, loopback, or single-machine evidence.

## Requirement status

| Scope | Proven | Incomplete | Contradicted by current evidence | Missing |
|---|---:|---:|---:|---:|
| Phase 0 (`AC-P0-01…12`) | 4 | 4 | 2 | 2 |
| Phase 1 (`AC-P1-01…24`) | 15 | 4 | 1 | 4 |
| Phase 2 (`DIST-01…10`, `P2-11…14`) at `6490f3a` | 9 | 1 | 2 | 2 |

`a8aab12` and `58c8965` add a dependency-free capability-export verifier plus byte-tamper and forged-inner-receipt negatives. `DIST-10` and `P2-14` remain unproven until that gate is included in a new immutable evidence round.

## Proven local boundaries

- Contract validation, unknown-field/version/size rejection, receipt tamper rejection, and correct Git bloodline.
- Grant least privilege, token non-leakage, approval timeout, revocation checkpoint, seven local fault classes, tenant isolation, per-tenant chains, quotas, and independently verified tenant exports.
- Capability permission gate, read-only sharing, required provenance/permission/trial fields, abandoned-3D/dead-control audits, deterministic replay, five-shadow promotion gate, regression failure gate, and exact failed-step reporting.
- DemoSession pause/delete/rechain and unredacted-egress rejection.
- Local public marketplace browse/report/human takedown/install denial and strict local trusted-bundle bridge.

## Incomplete or contradicted requirements

### True-machine and external acceptance

- `test:fleet --soak=100` returns exit `2`: no second physical machine, so P0-03/04 and P1-02 are not complete.
- No two clean-machine install timing, 3/5 external installs, 20 real tasks, 48-hour reuse, payment signal, or ten third-party capability installs.
- Same-machine temporary-root installation is not cross-host evidence.

### Product paths

- The current Web gate uses a Playwright HTTPS route mock rather than a real loopback Fastify Relay shared by production clients.
- The seven risk classes are visible, but only unknown risk has a complete UI-level fail-closed proof; the required seven-class approval-before-execution matrix is absent.
- Mobile 390×844 assertions pass, but the screenshots were emitted to ignored `dist/` and are not sealed.
- Diagnostic ZIP logic passes locally, but packaged Electron export plus actual ZIP scanning is not yet sealed.

### Capability provenance

- Capability registry tests use synthetic event identifiers (`evi-1`, `event-artifact`, `event-completed`) rather than deriving a draft from an independently verified successful HUMMER task receipt.
- The `6490f3a` evidence round did not contain an independent capability-export verifier. The follow-up verifier must be sealed before changing the status.

### Expert demonstration

- No production OS capture adapter or independently completed expert recording exists at the audited baseline.
- Whitelist/pause/delete protections are proven at the store/IPC boundary, not against a real OS event source.
- Distillation uses structured synthetic records; there is no real ten-minute expert demonstration.
- Replay is deterministic and side-effect-free; there is no real GUI/CUA replay path.

## Nine-layer test conclusion

L1, L2, and L6 are proven. L5 and L7 are proven only for local deterministic injection/capacity. L3 is incomplete, L4 is contradicted by the lack of a second machine, L8 lacks real capture, and L9 lacks real GUI/CUA. The goal's rule that all nine layers are required therefore prevents a completion claim.

## Highest-value safe local work at the audited baseline

The items below were subsequently completed by the post-audit slices described later in this document. They are retained as audit history, not as current next actions.

1. Real loopback Fastify Relay + Node + Web production-client E2E, with sealed 390 px screenshots.
2. Windows UIAutomation metadata capture against an explicitly allowlisted, non-sensitive fixture window; no screenshot/video/raw-key capture.
3. Durable SQLite trusted-bundle store with restart, immutability, lock, and partial-write negatives.
4. New evidence round containing the independent capability verifier and the three items above.
5. Bind capability draft creation to an independently verified real HUMMER outcome receipt instead of fixture event IDs.
6. Wire packaged Electron diagnostic export and scan the actual ZIP.

## Work requiring user/external coordination

- Second Windows machine, private/production Relay configuration, certificates or network changes.
- Real expert recording, real user-owned install directory, external users, real tasks, retention observation, and payment signal.
- Public deployment, ten external installs, and a public takedown exercise.
- Real GUI/CUA side effects and signed clean-machine NSIS upgrade/rollback.

These requirements must remain pending until their own external evidence exists; local tests must not be used as substitutes.

## Post-audit delta

The follow-up through `03505e4` plus the later packaged-diagnostic slice closes five local evidence gaps without changing the overall decision:

- a real loopback Fastify Relay is now exercised by the production Web and Node clients against one store, and four 390×844 screenshots are sealed;
- a bounded production Windows UIAutomation adapter is proven against a non-sensitive local WinForms fixture, with pause/allowlist/window-loss zero-write negatives;
- the trusted-bundle Relay has a restart-safe immutable SQLite adapter with lock and injected-write-failure negatives;
- the dependency-free capability-export verifier is included in a sealed evidence round.
- the Desktop settings/preload/main path exports a real create-only diagnostic
  ZIP from generated summaries, and a compiled-bundle gate scans its exact
  entries and SHA-256 values while proving secret rejection and no partial file.

The first follow-up chain head was `evidence/round-p2-runtime-surfaces-2/manifest.json`, root `949ad6e2228d094e5462ba07d40e08b649c8deb1a0a57e5a793a8c1853578d9c`. A preceding 9/10 failed round is retained in the chain.

The later trust-closure slice adds the exhaustive seven-risk UI matrix, accepted-outcome and exact-artifact binding for Capability drafts, and atomic compiled Electron diagnostic ZIP export. `evidence/round-p2-runtime-surfaces-3/manifest.json` is now the chain head, root `c1bb895ed234399a431bcb519cc976de52284c8bca893132fc943a0bff8761da`, with 13/13 gates, 100 unit files / 669 tests, 22 UI files / 87 tests, typecheck and build passing.

This proves `AC-P0-10`, `AC-P1-16`, `AC-P2-DIST-10`, and `AC-P2-14` locally. It closes technical gaps under `AC-P1-13`, `AC-P1-15`, `AC-P1-24`, `AC-P2-DIST-01`, and the seven-risk UI portion of `AC-P1-HITL-01`, but their literal real-task, Desktop-shared-Relay, cross-host, real-expert, or true-machine conditions remain incomplete. Phase completion remains blocked by the true-machine, real-expert, packaged-installer/native-dialog automation, external-install, retention, and payment requirements listed above.

### Same-Relay Desktop/Web follow-up

The later `13e3b19` slice replaces the prior “Desktop is absent” finding for
the local gate. A built Electron main/preload, a Browser, the production Node
HTTP/SSE client, and one real loopback Fastify Relay now complete dispatch,
approve, deny, and stop against the same store. The Node executes the approved
task exactly once, rejects the denied task with zero new execution, receives
the stop over SSE, and rejects a stop against a completed task with HTTP 409.

The sealed chain head is
`evidence/round-p1-desktop-web-hitl-final/manifest.json`, root
`eb4e523dcd5accf8418aaf5c5b16830cbff967c90aa9e042dac19e122a5b7626`.
This closes the **local single-host** Desktop-shared-Relay technical gap under
`AC-P1-15` and the local “no settings page” dispatch/approve/stop path under
`AC-P0-05`. Their literal external/two-machine acceptance remains incomplete.

## Current closeout addendum

The local checkpoint through `6ce9dac` closes the remaining authorized technical-preparation work without claiming external acceptance:

- Phase 3 migration v17, author declaration/revocation, independent human verification, positive-integer CNY dry-run offers, install-bound orders, immutable equal debit/credit settlement, and zero-balance reconciliation are implemented.
- Payment-provider dependencies, payment credentials, real collection, custody, payout, refund, invoice, tax, KYC/AML, and provider networking remain absent and prohibited.
- `AC-P3-01` through `AC-P3-03` have local executable evidence. `AC-P3-04` has a formally delivered decision pack, but that means “submitted for L3 decision,” not approved.
- The private Alpha stage-0 record is now a strict machine-checked contract. It rejects missing approval, placeholders, unknown or secret-bearing fields, same-device claims, non-HTTPS Relay URLs, expired certificates, over-eight-hour or over-scoped badges, unsafe transfer channels, unsafe canaries, production data, unsafe executors, public exposure, deletion, and real payment.
- The unfilled template intentionally returns `status: blocked` and exit code 2. A passing record does not authenticate the approver and authorizes nothing by itself.

The latest evidence chain head is `evidence/round-private-alpha-preflight-rerun-1/manifest.json`, root `cde65bbf389e3e501a88cb9b6d3234baae3180731f8c6473cbea81e70adc4635`. It includes typecheck, build, 65 contract assertions/46 negatives, 13 preflight assertions/21 negatives, the expected blocked-template exit 2, both security modes, Relay 210/210, and root unit 749/749. The preceding failed capture is retained at root `67c6c28202fd49de1b3520c2c8a5bdefd215c4e1eaa545aff3034ea20297b265`.

No further local test can prove the remaining literal requirements. Completion still requires external state and human authority: a second Windows machine, approved private TLS/network configuration, a real non-developer operator and expert, real install timing and tasks, retention/reuse observation, external installs and takedown, and any payment signal or real-commerce decision. Until those exist, the project remains `待推进` and the full goal must not be marked complete.
