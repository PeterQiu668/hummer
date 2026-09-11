# ADR-009: Runtime-enforced file write gate

- Status: Accepted
- Date: 2026-09-11
- Milestone: M5-D P0.0

## Context

HUMMER previously passed human gates to Codex as prompt text while granting `workspace-write` for L2 and L3 plans. Prompt text is not a control plane. The default policy declares `file.write*` high risk, but the execution process could still apply a patch without a HUMMER approval record.

## Real probe

The baseline probe used Codex CLI 0.153.4 with app-server JSON-RPC, the internal OpenAI validation profile, and `sandbox=workspace-write`. The execution prompt required reading `input.txt` and creating `summary.md` with `apply_patch`.

- Run window: 2026-09-11T03:42:01.431Z to 2026-09-11T03:42:40.290Z.
- Raw wire: `spikes/m5d-write-gate/probe-workspace-write-wire.jsonl` (290 JSONL records; SHA-256 `d0a7f93c27581a10c6a888dcc3e9ac9ecfde1c8d9856595ff5f396e4724d8f57`).
- Unapproved output copy: `spikes/m5d-write-gate/probe-unapproved-output.md`.
- At 2026-09-11T03:42:30.462Z app-server emitted `item/started` for a `fileChange` adding `summary.md`.
- At 2026-09-11T03:42:30.753Z it emitted `item/completed` with `status=completed`.
- The full wire contains zero `requestApproval` messages.
- The turn completed normally at 2026-09-11T03:42:40.290Z and the file existed before any HUMMER decision.

Conclusion: with this verified version and configuration, `workspace-write` does not force an approval before `apply_patch` file changes.

## Decision

1. Every Codex execution launched by HUMMER uses `read-only`, including L2 and L3 plans.
2. Codex CLI 0.153.4's app-server protocol is the mandatory action-level gate for Codex file changes. A real post-change probe must show `item/fileChange/requestApproval` before any completed `fileChange`.
3. HUMMER maps that native request to `file.write.patch`, applies the tenant approval policy, and returns `accept` or `decline` only after the named account decision is persisted.
4. Built-in HUMMER tools that do not run through Codex use a separate main-process controlled action channel. That channel validates the same tenant/session/action/requester approval tuple, rejects workspace escapes, symbolic links and overwrites, stores bytes under `evidence://sha256/<digest>`, and appends a hash-chained event.
5. `Human gates` remain in the model prompt as notice only. Enforcement is provided by the read-only sandbox plus app-server file-change approval protocol, or by a HUMMER controlled action channel for built-in tools.

## Verification

`scripts/e2e-desktop-write-gate.mjs` drives a real Codex app-server run in `read-only`, persists and rejects the exact thread-scoped native `file.write.patch` request, and asserts that no successful `fileChange` and no target file exist. Its post-change evidence is written under `spikes/m5d-write-gate/` and must not be conflated with the baseline probe above.

The latest accepted rejection regression was generated at 2026-09-11T05:16:17.667Z. Approval `01a08ee4-efe5-7cf3-9115-4ec3cbe480e7:0` was declined by the authenticated account, Codex reported `patch rejected by user`, the native file-change item ended as `declined`, the target file did not exist, and the tenant hash chain was `valid=true, checked=6`. Evidence: `spikes/m5d-write-gate/write-gate-evidence.json` and `read-only-write-gate-wire.jsonl`.

The complementary approval regression ran from 2026-09-11T05:14:38Z to 05:15:12Z. Its trajectory records `file.write.patch` approval at sequence 6, the human decision at sequence 7, and completed `workspace.patch` with content-addressed evidence at sequence 8. This confirms that the same read-only protocol gate both blocks unapproved mutation and resumes after an accepted decision. Evidence: `spikes/codex-runtime/app-server-approval-trajectory.json` and `app-server-approval-wire.jsonl`.

## Consequences

- Existing scenarios that expected Codex to write directly after native command approval must migrate to a HUMMER controlled capability.
- L3 autonomy no longer implies filesystem write authority.
- The controlled action channel is intentionally separate from `RuntimeAdapter`; adapters describe execution events, while HUMMER owns enterprise authorization and state changes.
