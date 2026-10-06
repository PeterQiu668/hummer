# ADR-051: DemoSession local privacy kernel

- Status: accepted
- Date: 2026-10-07
- Scope: Phase 2 W7 contract and Desktop persistence only

## Context

Phase 2 needs a trustworthy recording boundary before HUMMER can integrate an
operating-system recorder, GUI grounding, distillation, or replay. The W5
capability contracts already carry `demoSessionIds`, source boundaries and
redaction declarations, but they do not prove that collection respected those
boundaries. Treating those declarations as collection evidence would turn an
author claim into a privacy decision.

This milestone therefore implements only a local privacy kernel over synthetic
accessibility, input-event and keyframe metadata. It does not capture a screen,
store image/video bytes, upload data, distil a capability, or claim that an
expert can complete a real recording flow without developer assistance.

## Decision

### Strict DemoSession v1 contract

`DemoSession` is a versioned TypeBox contract validated through AJV and exposed
through Standard Schema. The expert must be a `human:*` actor. `localOnly` is a
literal `true`, not a mutable boolean. The contract rejects unknown fields,
unsupported capture modes, invalid time ranges, broken segment digest chains,
duplicate segment ids and deleted segments without a deletion audit entry.

The W7 kernel supports only `ax-tree+keyframes` and `events-only`. Full-video
capture remains outside this milestone.

### Local capture state machine

Desktop migration v14 appends tenant-qualified `demo_sessions`,
`demo_session_segments` and `demo_session_records` tables. Migrations v1-v13
remain byte-for-byte unchanged. `DesktopPersistence.demoSessions` is the only
write port for this state.

The state machine is:

```
start -> capturing -> pause -> paused -> resume -> capturing -> end -> ended
```

Only an active tenant member represented by the session's `human:*` actor may
start or mutate the session. Ingest is accepted only while capturing and only
when both application and window pass the session source allowlist. Paused or
out-of-bound events return an explicit rejection and write no record.

Ingest accepts structured metadata only:

- accessibility-node metadata;
- bounded input-event metadata without raw keystroke text; and
- keyframe metadata containing dimensions, changed-region count and a digest,
  but no image bytes or path.

Every accepted record contributes to a segment digest chain. Segment deletion
physically removes its metadata records, leaves an auditable tombstone, and
recomputes the deleted segment plus every later digest. State changes append
tenant-scoped domain events.

### Egress is fail-closed

A session starts with `redactionApplied=false`. The only egress projection is
available after the session ends and a named redaction policy is recorded.
Unredacted sessions are rejected. The projection contains the validated
session contract and never contains capture records or raw bytes.

Tenant-qualified reads return the same unavailable result for absent and
foreign sessions.

## Executable gate

`npm run test:privacy` covers, with synthetic data only:

1. non-human start rejection;
2. source-allowlist rejection with zero persisted records;
3. paused ingest rejection with zero persisted records;
4. segment tombstone, physical record purge, digest rechain and deletion audit;
5. unredacted egress rejection; and
6. cross-tenant read and mutation rejection.

## Consequences and explicit limits

- This establishes AC-P2-DIST-02, -03 and -04 at the local privacy-kernel
  boundary only.
- It does **not** satisfy AC-P2-DIST-01 or -05. There is no real recorder UI,
  Windows UIAutomation adapter, screenshot/video capture, GUI grounding,
  distillation, real expert demonstration, upload path or public package.
- Physical deletion in this milestone is exercised only against synthetic
  records in a test-created temporary database. No real user recording is
  opened, copied, uploaded or deleted.
- Adding an OS capture adapter, changing allowlist semantics, or moving any
  recording byte off-device requires a later ADR and the applicable human
  approval gate.
