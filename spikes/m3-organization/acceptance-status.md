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

## M5-B status update - 2026-09-10

### Planner boundary and policy gates

- Added runtime-neutral `Planner`, `TemplatePlanner`, and `RuntimePlanner`; both implementations pass the same contract suite.
- Runtime planning reuses the existing RuntimeAdapter method set. No provider or desktop type entered the product domain.
- Codex app-server planning uses protocol-level `turn/start.outputSchema` and a read-only sandbox. A failed prompt-only run was retained as a failed acceptance observation; the successful run was generated at 2026-09-10 03:55:57 (Asia/Shanghai).
- `humanGates` are derived from the current tenant's seven persisted approval policies. Model-authored gates are ignored. Policy lookup failure defaults protected actions to denied.

### Real external runtime evidence

- `spikes/m5b-planner/openai-codex-validation-evidence.json`: five task classes, five distinct understanding arrays, no fallback sentence, five accepted planning outcomes, five valid hash-chain receipts.
- `spikes/m5b-planner/openai-codex-validation-wire.jsonl`: five schema-constrained turn starts and zero command execution, file change, or approval request messages.
- Local screenshots are in `dist/hummer-m5b-plan-{excel,contract,external-send,delete,hiring}.png`; the delete screenshot contains the critical `data.delete*` gate.
- A later complete-wire regression supersedes the earlier file-change-approval interpretation. In `workspace-write`, `apply_patch` is not proven to request approval. The verified boundary is a protected command in `read-only`: the 2026-09-11 02:32:49-02:33:46 (Asia/Shanghai) run contains trajectory sequence 9 `approval_required(shell.command)`, sequence 10 human approval, sequence 11 continued tool execution, and sequence 16 result/turn completion.

### Blocked product-profile evidence

- `DEEPSEEK_API_KEY` was absent from the process environment at verification time. The default `deepseek-standard` E2E was not run and is not claimed.
- The internal validation model is not in the verified CNY price catalog. Planning outcomes and valid receipts exist, but their cost lists are empty and the UI reports that cost is unavailable. The priced planning-cost receipt gate remains blocked until `npm run test:desktop:planner:deepseek` passes with a safely injected key.
- No Feishu, channel adapter, or inbound/outbound messaging work was started.

## M5-C partial status update - 2026-09-11

### P0.1 default DeepSeek planning

- Blocked before provider access because the current process has no `DEEPSEEK_API_KEY`.
- On 2026-09-11, `npm run test:desktop:planner:deepseek`, `npm run test:desktop:credentials`, and `npm run test:desktop:wedge` all stopped at explicit preflight. They did not start Electron, write fallback evidence, or claim DeepSeek compatibility.
- DeepSeek `turn/start.outputSchema` behavior therefore remains unverified. Decision and closure evidence are defined in `docs/decisions/ADR-006-deepseek-structured-planning.md`.

### P0.2 encrypted credential product chain

- Additive migration v6 creates tenant-scoped `engine_credentials`; migrations v1-v5 are unchanged.
- Desktop `safeStorage` encrypts before persistence. The renderer can configure or remove a credential and read only configured/unconfigured status; plaintext is never returned.
- Runtime invocation carries an authenticated lookup reference, not a credential. The main process decrypts immediately before spawn and injects only the child-process environment.
- Focused evidence: 36 unit tests across persistence, vault, profile, redaction, environment and adapter boundaries; three UI tests across settings and unavailable-profile submission. All passed on 2026-09-11.
- The real configure-restart-plan E2E exists at `scripts/e2e-desktop-credentials.mjs` but remains blocked on the same provider key. No mock substitute was used.

### P0.3 internal Windows package

- NSIS artifact generated at `release/m5c/HUMMER-Setup-0.0.0.exe` (104,353,266 bytes; SHA-256 `5A47521EBBFD15999B6AACFA3C4C0E74093083420DE08DD3BD5E46A0BAC36A34`). Authenticode status is `NotSigned`.
- `npm run test:desktop:packaged` passed against the unpacked production artifact: visible renderer loaded through relative assets, native SQLite loaded, tenant creation succeeded through the packaged UI, the workbench exposed the real desktop runtime state, embedded Node was `22.22.0`, and Codex CLI `0.153.4` was recognized.
- This is current-machine package evidence, not a clean-Windows installation result. Clean-machine installation and certificate issuance remain external release gates.
- Codex CLI is not bundled in this internal package. The Apache-2.0 redistribution option and current non-bundling decision are recorded in ADR-007 and `THIRD_PARTY_NOTICES.md`.
- No Feishu or channel work was started.

### P1.1 external-send wedge

- `scripts/e2e-desktop-wedge-external-send.mjs` defines the real acceptance path: encrypted credential configuration, real DeepSeek planning, draft creation with content-addressed evidence, `external.send*` approval and rejection branches, priced outcome recording, receipt export, independent verification, and secret scanning.
- The script is syntax-valid but its real run is blocked at credential preflight. No wedge trajectory or external-runtime evidence is claimed.
- The approved branch means "approved for delivery" only. M5-C intentionally contains no channel implementation and does not claim that any message was delivered. The rejected branch asserts that no delivery marker exists.

### P1.2 self-contained receipt

- `scripts/e2e-desktop-outcome-receipt.mjs` completed through the real Electron persistence host on 2026-09-11 and produced `spikes/m5a-outcome-ledger/verifiable-outcome-receipt.json`.
- Standalone `scripts/verify-receipt.mjs` accepted the original receipt. After the outcome verdict was changed, it rejected the document and identified `/receipt/outcome/verdict`.
- The exported proof contains six domain events and root hash `35548a28057b2e9209e194842b76afcfd27429f59d9859dac0068103ae06f9f1`. It was generated at 2026-09-10 19:09:44 UTC (2026-09-11 03:09:44 Asia/Shanghai). Cost CNY 0.01883 comes from deterministic usage input and the verified DeepSeek catalog. This remains local product-chain evidence, not an external provider call.
- ADR-008 records the exact trust boundary: hashes prove content consistency, while issuer authenticity and non-repudiation still require signing and trusted timestamping.

### P2 deferred backlog

- Tool registry/MCP configuration, DSH ACP, Feishu ChannelAdapter, and automatic updates are recorded in `docs/plans/m5c-deferred-backlog.md` and were not implemented.

### M5-C final regression snapshot

- Passed on 2026-09-11: `npm run typecheck`; `npm run test:unit` (160); `npm run test:ui` (32); `npm run build`; `npm run desktop:build`; `npm run test:e2e`; `npm run test:desktop:persistence`; `npm run test:desktop:identity`; `npm run test:desktop:approval-rejection`; `npm run test:desktop:projects`; `npm run test:desktop:outcome-receipt`; and `npm run test:desktop:packaged`.
- The current external internal-profile evidence also passed the real Codex approval, restart, steer, interrupt, and five-plan runs. Their UTC run windows are recorded in `spikes/codex-runtime/`, `spikes/m3-real-restart/`, and `spikes/m5b-planner/`; they do not prove DeepSeek compatibility.
- `scripts/ops-simulation.mjs` has no FAIL. `scripts/ops-simulation-2.mjs` exits successfully but retains its pre-existing FAIL for a Feishu/enterprise inbound trigger. This work order explicitly prohibits implementing that channel path.
- The three credential-dependent commands remain blocked at explicit preflight: DeepSeek planner, encrypted credential restart, and external-send wedge. Therefore the global “all desktop tests green” gate is not claimed.

## M5-D status update - 2026-09-11

### P0.0 runtime-enforced write gate

- Baseline real Codex probe: `workspace-write` completed an `apply_patch` file change with zero approval requests. Wire and copied output are under `spikes/m5d-write-gate/`; exact timestamps and wire SHA-256 are in ADR-009.
- Post-change real Codex run generated at 2026-09-11T04:15:38.366Z used `read-only`, persisted the native `file.write.patch` approval request, rejected it as the logged-in account, received runtime status `declined`, wrote no file, and verified the hash chain.
- All autonomy levels now use `read-only`. Prompt human-gate text is informational only; enforcement is app-server file-change approval or the main-process controlled action channel.

### P0.1 DeepSeek gate

- At approximately 2026-09-11 12:52 Asia/Shanghai, Process/User/Machine environment scopes all lacked `DEEPSEEK_API_KEY`.
- `test:desktop:planner:deepseek`, `test:desktop:credentials`, and `test:desktop:wedge` each exited 1 at explicit preflight. No provider request, fallback evidence, or mock substitution occurred. ADR-006 remains blocked.

### P1 tool execution

- Additive migration v7 creates tenant-scoped `tool_definitions` and `tool_invocations`; v1-v6 are unchanged.
- `packages/config/src/tool-definitions.json` is the sole authored catalog. Only `fs.read` and `external.send.draft` are plan-valid.
- Real Codex plus product-chain run generated at 2026-09-11T04:31:27.294Z: `spikes/m5d-tool-registry/tool-registry-evidence.json`. `hummer_local/fs_read` was ready, elicitation was accepted by the tenant control plane, the read completed in 4 ms, the receipt included its content-addressed evidence, and chain integrity was `valid=true, checked=19`.
- Local product-chain run generated at 2026-09-11T04:43:48.371Z: `spikes/m5d-external-draft/external-draft-evidence.json`. Rejection wrote no file; approval produced a draft only, recorded the tool and evidence in the receipt, and left `valid=true, checked=12`. No external delivery is claimed.

### P2 internal release

- Built unsigned `release/m5d/HUMMER-Setup-0.5.0-internal.1.exe`: 104,368,997 bytes, SHA-256 `CFA877D47D56F425420B217EB71D902D86F595AA825F7E84DF4BE8915CD61A68`, Authenticode `NotSigned`.
- Current-machine packaged smoke passed. Windows Sandbox is disabled and no separate clean machine was available, so clean-Windows installation remains an external gate.
- Certificate owner, vendor, and target date are not supplied; `docs/release/m5d-windows-internal-release.md` records the unstarted status without inventing values.

### M5-D final regression snapshot

- Latest rejected real-write gate: 2026-09-11T05:16:17.667Z, approval declined, runtime `fileChange` status `declined`, output absent, chain `valid=true, checked=6`.
- Latest accepted real-write gate: 2026-09-11T05:14:38Z to 05:15:12Z, trajectory sequence 6 approval request, sequence 7 named human approval, sequence 8 completed `workspace.patch` with content-addressed evidence.
- Real steer completed with a second file-write approval and changed output; real interrupt returned `status=interrupted`; restart recovery at 2026-09-11T05:26:12.800Z restored five prior events, appended the interrupted state, and verified `valid=true, checked=14`.
- Real MCP `fs.read` regression generated at 2026-09-11T05:27:40.990Z, completed in 3 ms with SHA-256 evidence and `valid=true, checked=19`. The local controlled `external.send.draft` regression retained rejection-without-file and approved-draft receipt behavior with `valid=true, checked=12`.
- Passed: `typecheck`; `test:unit` (176); `test:ui` (33); `build`; `desktop:build`; `test:e2e`; desktop Codex read, approval, steer, interrupt and restart; persistence; identity; approval rejection; projects; outcome receipt; planner internal validation; write gate; tool registry; external draft; packaged smoke; and both operations simulations (the explicitly deferred channel-inbound check is `SKIP`, not a delivery claim).
- Rebuilt unsigned installer: `release/m5d/HUMMER-Setup-0.5.0-internal.1.exe`, 104,368,997 bytes, SHA-256 `CFA877D47D56F425420B217EB71D902D86F595AA825F7E84DF4BE8915CD61A68`, Authenticode `NotSigned`.
- Still blocked: all three DeepSeek credential-backed E2Es and clean-Windows installation. No mock or internal OpenAI result is substituted for either gate.

## M5-E status update - 2026-09-12

### P0 default DeepSeek gate

- Process, User, and Machine environment scopes still have no `DEEPSEEK_API_KEY`, and the default Electron user-data location contains no reusable HUMMER credential database.
- `test:desktop:planner:deepseek`, `test:desktop:credentials`, and `test:desktop:wedge` therefore remain blocked at their explicit credential preflight. This is not evidence for or against DeepSeek `outputSchema`; ADR-006 remains open.
- No mock or `openai-codex-validation` run is substituted for the default product profile.

### P1 local office-document capability

- Additive catalog update exposes exactly three implemented capabilities: `fs.read`, `external.send.draft`, and `doc.extract`. The existing unknown-capability test remains fail-closed.
- Real Codex run generated at `2026-09-11T18:41:59.555Z`: `spikes/m5e-doc-extract/doc-extract-evidence.json` and `doc-extract-wire.jsonl`. It called `hummer_local/doc_extract`, retained worksheet/cell coordinates, persisted SHA-256 evidence, recorded the tool invocation, and verified `valid=true, checked=25`.
- Encrypted, corrupt, oversized, out-of-workspace, and symbolic-link failures are explicit. DOCX and PDF are verified locally by integration tests; only XLSX has external-runtime E2E evidence.

### P2 durable internal order intake

- Additive migration v8 creates tenant-scoped `work_order_intake` and `work_order_inbox`; v1-v7 are unchanged.
- Run generated at `2026-09-11T18:43:35.617Z`: `spikes/m5e-intake/intake-evidence.json` and `intake-wire.jsonl`. A real XLSX file appeared as a pending intake, with zero sessions before confirmation and `valid=true, checked=2`.
- Confirmation created work order `wo_intake_31ab22a26cad2f44a1e168d8`; real Codex planning and `doc.extract` then completed. The draft approval, outcome, receipt, and restart checks are local HUMMER product-chain evidence. Restart restored the intake/session and the final chain was `valid=true, checked=30`.
- No ChannelAdapter or external delivery was implemented.

### P3 release gates

- Electron was upgraded from 38.8.6 to 39.8.10 and safe lockfile audit fixes were applied. Upstream `extract-zip` and ExcelJS `uuid` advisories remain documented; no force downgrade or unverified major upgrade was applied.
- Code-signing remains not applied: owner, vendor, and expected completion date are not assigned. See `docs/release/m5e-windows-internal-release.md`.
- No clean Windows machine is available, so install-to-first-order acceptance remains blocked and unclaimed.

### M5-E final regression snapshot

- Passed: `typecheck`; `test:unit` (187); `test:ui` (35); `build`; `desktop:build`; `test:e2e`; persistence; identity; approval rejection; projects; outcome receipt; internal planner; real Codex app-server, approval, steer, interrupt and restart; write gate; tool registry; external draft; `doc.extract`; intake; and packaged smoke against the M5-E output.
- Both operations simulations completed with no `FAIL`. Their existing `SKIP`, `CHECK`, and `WARN` items remain explicit product-boundary observations, not passes.
- Built unsigned `release/m5e/HUMMER-Setup-0.5.0-internal.1.exe`: 125,123,558 bytes, SHA-256 `8CC246BDA3267C3F439980FB3BCB904CC92FC3EAC7A752BF3ED3C64D325BFB70`, Authenticode `NotSigned`.
- Explicitly blocked: the three DeepSeek credential-backed E2Es and clean-Windows installation. The global all-desktop-green gate is therefore not claimed.

## M5-F status update - 2026-09-13

### P0 `workspace.exec` gate: blocked and retracted

- Real Codex CLI 0.153.4 probe started at `2026-09-13T10:13:53.357Z`. Evidence: `spikes/m5f-workspace-exec/blocked-evidence.json`; complete wire: `spikes/m5f-workspace-exec/runs/2026-09-13T10-13-53-357Z/workspace-exec-wire.jsonl`.
- The order sandbox wrote and hashed an in-sandbox artifact. The `../../escaped.md` probe failed with `PermissionError`, but an outbound HTTPS probe completed with exit code 0 under the `codexsandboxoffline` identity.
- The mandatory no-network gate failed. The fourth capability, migration v9, environment-doctor additions, and runtime changes were retracted. The production catalog remains at three capabilities.
- P1's six workflow E2Es were not created or run because the user-specified P0 gate did not pass. No mock evidence substitutes for them.

### P2 dead-control closure

- All seven reported dead controls were either connected to a real existing flow or converted to non-interactive status text. Assigning work from an employee profile now routes to the workbench with that employee preselected.
- `scripts/audit-dead-controls.mjs` uses the TypeScript AST and fails on native buttons without `onClick`, except legitimate `type="submit"` buttons. It is part of the root `npm test` command.

### P3 DeepSeek local environment loading

- `.env.local` is ignored by Git. The three credential-backed DeepSeek commands use Node's native `--env-file=.env.local`; no `dotenv` dependency was added.
- This checkout has no `.env.local`, so the three real DeepSeek tests remain blocked and were not replaced by mock or internal-profile runs.

### P4 release gate

- Code-signing and clean-Windows status remain unchanged from `docs/release/m5e-windows-internal-release.md`: certificate not applied, ownership/vendor/date unassigned, and no clean Windows host available.
- M5-F is not release-qualified because P0 failed. No M5-F installer is claimed.

### M5-F regression snapshot

- Current-code checks run on 2026-09-13 passed: `typecheck`; dead-control audit; `test:unit` (188); `test:ui` (37); `build`; `desktop:build`; and browser `test:e2e`.
- Local product-chain desktop checks passed: persistence, identity, approval rejection, projects, outcome receipt with independent tamper detection, internal planner, external draft, and packaged smoke.
- Real Codex checks passed separately: app-server execution, approval continuation, steer, interrupt, real-session restart recovery, denied unapproved write, MCP `fs.read`, real XLSX `doc.extract`, and confirmed order intake.
- Both operations simulations exited 0 with no `FAIL`; their existing `SKIP`, `CHECK`, and `WARN` entries remain open observations.
- The three credential-backed DeepSeek checks, the rejected `workspace.exec` E2E, six dependent workflow E2Es, and clean-Windows installation are not green. The global all-desktop/all-workflow gate is not claimed.
- Existing non-blocking runtime diagnostics remain visible: internal OpenAI validation has no verified CNY price, and the basic Codex smoke logged missing intake IPC handlers in that reduced host mode.
