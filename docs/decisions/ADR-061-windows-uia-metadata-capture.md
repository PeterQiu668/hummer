# ADR-061: Local Windows UIAutomation metadata capture

- Status: accepted
- Date: 2026-10-07
- Scope: Phase 2 W7 Desktop capture adapter, persistence bridge, IPC/preload and local control surface

## Context

ADR-051 established the local-only DemoSession privacy kernel and ADR-059 added
its human control surface, but both intentionally stopped before operating-system
capture. The next narrow product step is to let a Windows user capture bounded
accessibility metadata from an explicitly selected window without introducing a
screen recorder, keyboard logger, upload path or renderer-controlled test seam.

## Decision

Desktop adds a one-shot Windows UIAutomation adapter implemented with the
Windows inbox .NET UIAutomation assemblies invoked by Windows PowerShell. Every
request must provide all three authorities:

1. a positive, explicit operating-system process id;
2. a case-sensitive exact top-level window title; and
3. the authenticated DemoSession's existing `sourceBoundary`.

The adapter first checks that the requested exact title is in the current
session boundary. The operating system must then return exactly one top-level
window for the PID and title. Its real process name, title and accessibility
nodes are validated again against the same boundary. The adapter accepts at
most 128 nodes and writes only role and automation id into `ax-node` records.
It deliberately does not read descendant accessible names because editable
controls may expose typed text through that property. Unknown fields, malformed
text, empty results, source changes and non-Windows hosts fail closed.

No screenshot API, video API, global input hook, raw keyboard value collection,
clipboard reader, file reader, network client or upload path is present. The
probe receives only PID and title in its child-process environment and runs
locally with a bounded timeout and output limit.

`DemoSessionUiaCaptureService` writes accepted nodes only through
`DesktopPersistence.demoSessions`. A new store-level batch method re-reads
status and boundary inside one SQLite transaction so pause/end or validation
failure cannot leave a partial snapshot. The authenticated IPC resolves tenant
and human ownership before any OS probe. Production preload exposes only the
real one-shot capture command; the ADR-059 synthetic injector remains test-only
and absent from preload.

The renderer requires the human to type the PID and exact title and permanently
discloses that collection is local UIAutomation metadata only. A self-built
WinForms fixture contains only synthetic strings and exercises the real Windows
API without customer data.

## Executable gate

`npm run test:windows-uia-capture` emits a machine-readable
`hummer.executable-gate-result` and verifies:

1. strict PID/title/boundary request and OS-result validation;
2. authenticated owner/session IPC binding and production preload exposure;
3. zero writes for paused, wrong-window, outside-application and cross-session requests;
4. one-shot UI controls and privacy disclosures;
5. Desktop production TypeScript compilation; and
6. a real Windows UIAutomation read of a locally launched WinForms fixture,
   followed by a disappeared-window rejection with no additional records.

## Consequences and limits

- This replaces the ADR-059 “adapter not connected” limitation with a real,
  local, metadata-only Windows adapter.
- The fixture proves the operating-system bridge and part of the no-developer-
  tools product path; it is not a real expert demonstration or customer trial.
- It does not capture image/video bytes, raw keyboard text or input events and
  does not perform upload, distillation, GUI replay or cross-machine transfer.
- It does not by itself satisfy AC-P2-DIST-01 end to end. A real expert's
  ten-minute demonstration, privacy review and acceptance evidence remain
  separate gates.
