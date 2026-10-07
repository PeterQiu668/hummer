# Phase 2 local surfaces handoff

Date: 2026-10-07  
Branch: `codex/phase0-fleet`  
Integration range: `09bfdb2..694a92c`

## Outcome

This increment connects three previously separate local kernels into honest product surfaces without claiming external acceptance:

1. **Teach it my work** — trusted Desktop IPC/preload and a React control surface for local-only DemoSession start, pause, resume, end, segment deletion, redaction marking, and review export.
2. **Public capability network** — anonymous redacted browse/detail, authenticated report and install authorization, human-only moderation/takedown, and a 390 px-safe Web surface backed by a real local PublicMarketStore projection.
3. **Trusted bundle bridge** — strict eight-file Agent Skills bundles can cross a loopback Relay/Node boundary and materialize only in a marker-controlled synthetic root after an independently bound human approval.

## Trust boundaries

- Production preload does not expose the synthetic DemoSession injector.
- Public browse/detail contains only the redacted projection; reporting and moderation have separate least-privilege scopes.
- A report never auto-takes down a listing. Takedown requires a human member of the moderation tenant.
- Trusted bundles reject unknown fields, duplicate paths, non-canonical base64, hash/root/envelope changes, manifest or receipt mismatch, credentials, raw recording markers, tenant/node mismatch, and approval mismatch.
- Node installation is no-overwrite and atomic. Interruption or rename failure leaves no target or staging residue.
- No deployment, push, real capture, real user directory modification, payment behavior, or agent-hub write occurred.

## Executable evidence

Evidence round: `evidence/round-p2-surfaces-1/`

- Source commit captured: `03eed3c9cc573e746dab04b16eec6ce6cf751f6b`
- Commands: 10 passed, 0 failed, 0 skipped
- Full regression: 95 unit files / 637 tests and 21 UI files / 76 tests
- Typecheck: passed
- Production build: passed
- Evidence root: `b4ccd48753f577ab398880dcb0266a75361c2463faf64ac617047098795fe9cc`
- Previous evidence root: `3709c6b3de25c440e05eef670789e59f84bf842c098521c80823d95c48789923`

Primary gates:

- `npm run test:demo-session-ui`
- `npm run test:public-market-e2e`
- `npm run test:trusted-bundle-bridge`
- `npm test`
- `npm run typecheck`
- `npm run build`

## Known limitations and next acceptance work

This is a local market-test substrate, not Phase 2 completion.

- DemoSession still has no real OS capture adapter, screen/video bytes, raw input, independently completed expert demonstration, or production grounding.
- Relay storage for trusted bundles is an in-memory reference adapter. Public deployment, domain/certificate, production persistence, and internet exposure remain undone.
- Installation evidence is limited to a marker-controlled temporary root on this machine. A second machine and a real user-owned install destination remain untested.
- The required ten external installs, five seed users, twenty real tasks, retention measurement, and payment signal remain external acceptance gates.
- The production bundle currently emits a Vite chunk-size warning around 620 kB; the build succeeds, but code splitting is a later performance task.

## Recommended next slice

Run one supervised two-machine pilot: deploy no public service yet, use a private Relay endpoint, connect one second Windows machine, teach one real low-risk workflow with explicit allowlists, review/redact locally, publish one trusted bundle, approve and install it on the second machine, replay in shadow mode, and preserve the complete evidence chain. Any deployment, certificate/network change, or real install requires the user's L3 confirmation first.
