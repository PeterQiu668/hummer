# ADR-005: Runtime-backed planning boundary

- Status: Accepted with one blocked product-profile gate
- Date: 2026-09-10
- Milestone: M5-B

## Context

The workbench previously drafted every plan through `PLAN_TEMPLATES` and `FALLBACK_PLAN`. That was a useful browser prototype fallback, but it did not prove that HUMMER understood a user's task. Planning must use a real model when a runtime is available, remain runtime-neutral in the product domain, and fail closed when either structured output or enterprise policy lookup fails.

## Decision

1. The product domain owns a small `Planner` contract with `draft(request): Promise<SessionPlan>`.
2. `RuntimePlanner` drives an existing `RuntimeAdapter` planning-only turn. It does not import Codex, Electron, SQLite, Claude, or Harness types.
3. `TemplatePlanner` remains the explicit browser/runtime failure fallback. Its plans carry the visible label `演示计划 · 未经模型生成`; fallback planning writes no cost entry.
4. A planning turn is read-only and carries a runtime-neutral `responseSchema`. The Codex adapter maps it to Codex app-server `turn/start.outputSchema`. Any tool event, approval request, interrupted status, timeout, or invalid result rejects the real plan and invokes the marked fallback.
5. Model-authored `humanGates` are ignored. Candidate action IDs are checked against the current tenant's seven approval policies. High and critical matches become the plan's gates. If policy lookup is unavailable, protected actions receive a default-deny gate.
6. A valid runtime plan is recorded as an accepted `planning.session-plan` outcome. Token cost, when usage and a verified price exist, is linked to that outcome with `pricing_source = planning`, so the existing outcome receipt is the read model. No migration is required; migrations v1-v5 remain unchanged.
7. The `RuntimeAdapter` method set remains unchanged. Planning uses `startSession`, `subscribe`, and `stop`; the generic response schema is part of `SessionPlan`, not a provider SDK type.

## Evidence and limits

The first internal run on 2026-09-10 failed honestly: one turn ignored the requested shape and the retry was interrupted by the 120-second timeout. Its complete wire log showed app-server was still streaming and that prompt-only JSON instructions were insufficient. Codex CLI 0.153.4 locally generated protocol schemas expose `turn/start.outputSchema`; adding that field was therefore evidence-led rather than a timeout increase.

The successful internal validation was generated at 2026-09-10 03:55:57 Asia/Shanghai:

- `spikes/m5b-planner/openai-codex-validation-evidence.json`
- `spikes/m5b-planner/openai-codex-validation-wire.jsonl`
- `dist/hummer-m5b-plan-{excel,contract,external-send,delete,hiring}.png`

It produced five distinct plans in five attempts, five `turn/start` requests with `outputSchema`, zero command/file-change/approval side effects, and five accepted planning outcomes. Every outcome built a receipt with `chainIntegrity.valid = true`.

A separate Codex execution regression completed at 2026-09-10 04:14:34 Asia/Shanghai. After runtime planning, it read `input.txt`, surfaced the 0.153.4 file-change approval, accepted that approval through the workbench, emitted `workspace.patch`, wrote `spikes/codex-runtime/summary.md`, and reached `turn.completed`. Its evidence is `spikes/codex-runtime/app-server-jsonrpc-wire.jsonl` and `app-server-trajectory.json`. The host now treats `stop()` after a completed turn as cleanup instead of sending a second interrupt.

This is real external-runtime evidence using the internal `openai-codex-validation` profile. It is not DeepSeek product-profile evidence. At verification time neither `DEEPSEEK_API_KEY` nor `OPENAI_API_KEY` was present in the process environment. The internal model has no verified CNY price in HUMMER's product catalog, so no planning cost was recorded and the UI correctly says that cost is unavailable. M5-B acceptance item (d), priced DeepSeek planning cost in a receipt, remains blocked until the key is supplied through the environment and `npm run test:desktop:planner:deepseek` passes.

## Consequences

- Browser-only mode stays useful without pretending to use a model.
- Runtime implementations can participate in planning without a second adapter interface.
- Enterprise approval policy, not model prose, controls dangerous-action gates.
- Structured-output compatibility is now a concrete runtime capability requirement.
- No channel, Feishu, or messaging integration is introduced by this milestone.
