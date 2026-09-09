# M3 Acceptance Status

Generated on 2026-08-28 (Asia/Shanghai). Evidence strength is stated per item.

## Real external runtime evidence

- Codex validation run: 2026-08-28 21:53:46 to 21:54:48. The same wire log contains MCP `node_repl` and `codex_apps` startup status `ready`, command approval request, HUMMER approval response, continued shell commands, and `turn/completed`. Evidence: `spikes/codex-runtime/app-server-approval-wire.jsonl` and `app-server-approval-trajectory.json`.
- Real restart run: completed at 2026-08-28 22:00:23. A real Codex session with native thread `01a048aa-c3bb-7473-8933-acbe938f1cd9` persisted seven events before the App closed. Reopening preserved them, appended sequence 8 with `status=interrupted`, disabled dead-handle controls, and verified the hash chain as `valid=true, checked=8`. Evidence: `spikes/m3-real-restart/restart-evidence.json`, `codex-restart-wire.jsonl`, and `dist/hummer-m3-real-restart.png`.

## Local product-chain evidence

- `apps/desktop/src/persistence/m3-responsibility-chain.test.ts` proves one durable employee ID across hire, work order plan, approval request, approved decision, result package and a valid six-event hash chain.
- `apps/desktop/src/persistence/execution-node-store.test.ts` and `src/components/pages/ExecutionNodesPage.test.tsx` prove host-backed node health, active session projection, permission scope and kill-all command routing.
- `apps/desktop/src/mcp-connector-registry.test.ts` and `src/components/pages/MCPAppsPage.test.tsx` prove that only app-server handshake events can produce an `已验证连接` claim. Catalog entries such as Feishu and DingTalk remain `待接入`.

## Blocked product profiles

- DeepSeek standard: blocked before model execution because `DEEPSEEK_API_KEY` is absent.
- Zhipu enhanced: blocked because Codex CLI 0.150.1 accepts `responses`, while the tested provider path requires `chat-completions`.
- OpenAI flagship API profile: blocked because `OPENAI_API_KEY` is absent and the current Codex login token lacks Responses API scope.
- Claude Code: CLI 2.1.248 is installed but logged out; the real attempt returned `authentication_failed` before any tool or approval event.

Therefore the exact requested end-to-end path using the default DeepSeek product profile is **not complete**. The organization, policy, persistence and result-package chain is verified locally, while the real shell/approval/restart chain is verified with the explicitly non-product `openai-codex-validation` profile. These two evidence classes must not be merged into a production claim.

## M3.5 status update - 2026-08-29

This section supersedes the DeepSeek-key blocker and conclusion above; the other blocked-profile statements remain current.

- The `deepseek-standard` product profile completed a real read, command approval, approved write, result readback, `thread/fork`, second approval, second write and completion run ending at 2026-08-29 00:28:52 (Asia/Shanghai).
- Native source thread: `01a04933-50fc-7793-96cb-759f42c6fbda`; fork thread: `01a04933-a2c5-71d0-aa86-a61356401614`; HUMMER checkpoint sequence: 16.
- Source and fork produced different artifacts, two sessions were persisted, and the domain hash chain verified as `valid=true, checked=50`.
- Evidence: `spikes/deepseek-standard/fork-evidence.json`, `app-server-fork-wire.jsonl`, `app-server-fork-trajectory.json`, `summary-approved.md`, and `branch-summary.md`.
- The secret was process-local and is not stored in argv, logs, trajectories, evidence files, documentation, or source. Repository redaction assertions remain mandatory.
- This proves the DeepSeek runtime, approval and fork path. The organization hire and this runtime session are still separate acceptance runs, so the complete hire-to-result product flow is not yet a single E2E proof.

## W1 status update - 2026-09-10

### Real external runtime compatibility evidence

- Codex CLI 0.150.1 completed the app-server read/approved-write flow with command execution,
  `fileChange`, and `turn/completed`. Evidence: `spikes/codex-runtime/app-server-jsonrpc-wire-0.150.1.jsonl`
  and `app-server-trajectory-0.150.1.json`.
- Codex CLI 0.153.4 completed the same flow on 2026-09-10 at 02:22:31 (Asia/Shanghai), using
  20,411 tokens in 34.52 seconds. The JSON-RPC method set and item-type set matched 0.150.1, so no
  `CodexRuntimeAdapter` event mapping change was required. Evidence:
  `spikes/codex-runtime/app-server-jsonrpc-wire-0.153.4.jsonl` and
  `app-server-trajectory-0.153.4.json`.
- The desktop host now checks `codex --version` and refuses a binary that does not match the
  canonical 0.153.4 pin. This is a compatibility guard, not a silent fallback.

### Local desktop product-chain evidence

- `scripts/e2e-desktop-outcome-receipt.mjs` ran in Electron and produced
  `spikes/m5a-outcome-ledger/outcome-receipt-evidence.json` at 2026-09-10 02:38:11
  (Asia/Shanghai). One authenticated tenant defined an outcome, matched an approval policy,
  approved and accepted it, recorded CNY 0.01883 from real usage fields against the verified price
  catalog, assembled the receipt, passed the secret-shaped-value assertion, and verified the
  domain hash chain as `valid=true, checked=6`.
- This is local product-chain evidence with deterministic usage input. It is not evidence of an
  external provider call and is not described as one.

### Configuration and regression evidence

- `packages/config` is the authored source for engine profiles and runtime pricing. Generated
  desktop/renderer files are checked byte-for-byte by `tests/config-single-source.test.ts`; internal
  profile `openai-codex-validation` remains absent from the customer catalog.
- W1 gate passed: `npm run typecheck`; `npm run test:unit` (127); `npm run test:ui` (26);
  `npm run build`; `npm run desktop:build`; `npm run test:e2e`;
  `npm run test:desktop:persistence`; and `npm run test:desktop:outcome-receipt`.
- `scripts/ops-simulation.mjs` completes with no FAIL or ERROR; browser-only writes are explicit
  SKIP because the browser prototype has no local fact store. `scripts/ops-simulation-2.mjs` retains
  one pre-existing FAIL for inbound channel triggering. That finding is outside W1/M5-B and is not
  changed because this work order explicitly prohibits channel implementation.
