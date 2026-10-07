# Goal completion audit — 2026-10-07

Audited baseline: `6490f3a`  
Current follow-up at audit time: `58c8965`  
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

## Highest-value safe local work

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
