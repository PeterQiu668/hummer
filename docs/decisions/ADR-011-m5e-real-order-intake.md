# ADR-011: Local document extraction and real-order intake boundary

- Status: Accepted with external gates open
- Date: 2026-09-12
- Milestone: M5-E

## Context

M5-D proved a controlled read capability and an approved draft-writing capability, but it could not open common office documents and had no durable internal entry point for incoming work. A real order therefore still had to be converted to plain text and manually copied into the composer.

## Decision

1. The M5-E capability catalog contains exactly three implemented capabilities: `fs.read`, `external.send.draft`, and `doc.extract`. Unknown capability IDs continue to fail closed.
2. `doc.extract` is a low-risk, local-only built-in capability exposed by the trusted `hummer_local` stdio MCP server. It supports XLSX, DOCX, and PDF without sending document bytes to a provider. XLSX output retains worksheet names and cell coordinates.
3. Document access reuses the controlled workspace guard: canonical path containment, symbolic-link rejection, extension allow-list, regular-file checks, and a 25 MiB limit. Encrypted, corrupt, unsupported, oversized, out-of-workspace, and symbolic-link inputs fail explicitly.
4. Successful source documents are stored in the local evidence store by SHA-256. Runtime tool events are projected into `tool_invocations` and the domain hash chain before the UI consumes them.
5. Additive migration v8 creates `work_order_intake` and `work_order_inbox`; migrations v1-v7 are unchanged. An intake is tenant-scoped, idempotent by `(tenant_id, source, external_ref)`, and starts in `pending`.
6. Both folder and form entry use the runtime-neutral `intake(source, externalRef, payload)` domain operation. Confirmation creates the existing work-order projection and then reuses the existing planner, approval, execution, outcome, and receipt path. No unconfirmed intake starts a runtime session.
7. The embedded Codex runtime disables personal `memories` and `apps`, in addition to the existing plugin disables. This was added after a planning-only run inherited the operator's global memory feature, attempted to patch `MEMORY.md`, and disconnected before completion. `codex features list` on 2026-09-12 verified both feature names before the flags were added.
8. Folder intake is local only. No ChannelAdapter, Feishu, WeCom, WeChat, OAuth, arbitrary customer MCP endpoint, or automatic update is introduced.

## Evidence

### Real external runtime plus local document execution

- Run generated at `2026-09-11T18:41:59.555Z`: `spikes/m5e-doc-extract/doc-extract-evidence.json`.
- Wire: `spikes/m5e-doc-extract/doc-extract-wire.jsonl`.
- Codex emitted a real MCP call to `hummer_local/doc_extract`. HUMMER extracted worksheet `九月订单`, including cell addresses and the values `华东系统集成`, `128000`, and `2026-09-30`.
- The tool invocation produced `evidence://sha256/f54bfd87ec35099fe819001fdefaca98d1fe1ed6818878bc169b2ed87ae2ec30`; chain integrity was `valid=true, checked=25`.
- The same evidence file records explicit local failures for encrypted, corrupt, oversized, out-of-workspace, and symbolic-link inputs. DOCX and PDF parsing are covered by local integration tests, not by this external-runtime run.

### Real order intake, mixed proof classes

- Run generated at `2026-09-11T18:43:35.617Z`: `spikes/m5e-intake/intake-evidence.json`.
- Wire: `spikes/m5e-intake/intake-wire.jsonl`.
- Before confirmation, intake `intake_18b54cab42cdc687b77af059b0370a3c` was pending, the tenant had zero sessions, and the chain was valid.
- After confirmation, real Codex planning and `doc.extract` ran for work order `wo_intake_31ab22a26cad2f44a1e168d8`. The approved draft, outcome, receipt, and restart checks are local HUMMER product-chain evidence. They are not evidence of external delivery.
- Restart restored the intake and session, and the final chain was `valid=true, checked=30`.

## Open gates

- The current machine has no process, user, or machine `DEEPSEEK_API_KEY`, and no reusable HUMMER encrypted credential database. The three DeepSeek E2Es remain blocked at explicit preflight. No internal OpenAI result is substituted for them.
- No clean Windows machine or enabled Windows Sandbox is available. Installation from zero dependencies through one completed order remains unverified.
- The internal installer remains unsigned because a legal owner, certificate vendor, and target date have not been assigned.
- Dependency audit after upgrading Electron to 39.8.10 leaves upstream advisories in Electron's development-time `extract-zip` and ExcelJS's `uuid`. HUMMER does not invoke the affected archive extraction or UUID v3/v5 buffer APIs, but public release still requires dependency/legal review.

## Consequences

- HUMMER can now accept a local file order, hold it for human confirmation, extract a real office document, and preserve the resulting work order and receipt across restart.
- The proof does not establish the default DeepSeek profile, external message delivery, or clean-machine readiness.
- Additional office capabilities must not enter the catalog until they have the same guarded implementation, invocation ledger, evidence addressing, and real E2E proof.

## M5-F amendment: rejected `workspace.exec` proposal - 2026-09-13

This amendment records a rejected extension; it does not change the accepted M5-E boundary above.

M5-F proposed a fourth capability, `workspace.exec`, with `workspace-write` inside an order-specific directory and no network access. The implementation was tested against Codex CLI 0.153.4 on Windows before registration. The final run started at `2026-09-13T10:13:53.357Z`; its summary is `spikes/m5f-workspace-exec/blocked-evidence.json` and its complete app-server wire log is `spikes/m5f-workspace-exec/runs/2026-09-13T10-13-53-357Z/workspace-exec-wire.jsonl`.

The real probe established all three of these facts:

1. A child process ran as `h4-480\codexsandboxoffline` and successfully created `inside.txt` in the order workspace.
2. A requested write to `../../escaped.md` failed with `PermissionError`; no escaped file was created.
3. A Python `urllib.request.urlopen('https://example.com')` command completed with exit code 0 despite the managed profile using limited network mode with no allowed domains.

The same network escape had already reproduced with `unified_exec` enabled and disabled, with `network_proxy` disabled and enabled, and with ordinary and elevated Windows sandbox selection. The final run therefore fails the M5-F no-network acceptance gate. Public upstream reports describe related [Windows sandbox bypass](https://github.com/openai/codex/issues/14367) and [single-command network-control](https://github.com/openai/codex/issues/33688) failures, but those reports are supporting context rather than proof; the local wire log is the decision evidence. The policy was configured against the documented [app-server protocol](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md) and its [sandbox permission schema](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/v2/permissions.rs).

Decision: do not register or ship `workspace.exec`, do not add migration v9, and do not begin the six office-workflow E2Es. The catalog remains exactly the three M5-E capabilities. A future proposal must first prove denied outbound traffic in a fresh real-runtime probe, using a control outside the model prompt and outside the affected app-server path.
