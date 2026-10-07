# ADR-059: DemoSession Desktop control and review surface

- Status: accepted
- Date: 2026-10-07
- Scope: Phase 2 W7 Desktop IPC/preload and renderer control surface

## Context

ADR-051 established a tenant-scoped, local-only DemoSession privacy kernel over synthetic metadata. It deliberately did not provide a product control surface or claim that an operating-system recorder existed. W7 now needs a usable way for an authenticated human to define an application/window allowlist, drive the local state machine, delete a closed segment, and request a redaction-gated review projection without weakening that boundary.

## Decision

Desktop exposes narrow IPC commands for `start`, `get`, `pause`, `resume`, `end`, `delete-segment`, `mark-redacted`, and `export-review`. Every command derives the tenant and `human:*` owner from the authenticated Desktop session; renderer-supplied tenant or actor fields are ignored. Reads and mutations use the same opaque unavailable error for absent, foreign-tenant, and foreign-owner sessions. The existing `DemoSessionStore` remains the only write port.

The renderer adds a restrained “教它做我的活” page. It requires explicit application and window allowlists, displays session state and the segment digest timeline, asks for confirmation before deletion, and exposes a review projection only after the ended session has a named human-review redaction policy. The page permanently states “采集适配器未连接 / 本地内核” and explains that no screen, keyboard text, video, or real operation is being recorded.

Tests may register an IPC-only synthetic metadata injector through the explicit `enableDemoSessionSyntheticInjector` host option. The packaged Desktop bootstrap never supplies that option, and the preload never exposes the injector to the renderer. This keeps state-machine and digest-chain tests executable without creating a fake recording product control.

## Executable gate

`npm run test:demo-session-ui` runs focused Desktop IPC and React tests for:

1. auth-derived tenant and human ownership;
2. production absence of the synthetic injector;
3. app/window allowlist enforcement;
4. paused and ended ingest rejection;
5. unredacted export rejection;
6. cross-tenant mutation rejection;
7. confirmed segment deletion, record purge and digest rechain; and
8. honest renderer disclosures and redaction-first review projection.

## Consequences and limits

- This is a local control and review surface over the ADR-051 kernel.
- It does not capture screen/image/video bytes, raw keystrokes, or real application activity.
- It adds no UIAutomation, CUA, GUI grounding, upload, distillation, replay, public marketplace or remote egress implementation.
- It does not satisfy or claim AC-P2-DIST-01. Connecting a real OS capture adapter requires a later ADR, privacy review and explicit evidence gate.
