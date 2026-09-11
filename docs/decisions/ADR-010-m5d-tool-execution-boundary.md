# ADR-010: Tenant tool registry and controlled execution boundary

- Status: Accepted with external-provider gate open
- Date: 2026-09-11
- Milestone: M5-D P1

## Context

Earlier plans could name capabilities that had no implementation. MCP state was observed after Codex startup, but HUMMER did not actively configure a server, authorize its tool request, persist invocations, or include tool facts in outcome receipts.

## Decision

1. Migration v7 adds tenant-scoped `tool_definitions` and append-only `tool_invocations`. Migrations v1-v6 remain unchanged.
2. `packages/config/src/tool-definitions.json` is the authored capability catalog. Generated renderer and desktop copies are build artifacts checked by tests.
3. M5-D exposes exactly two implemented capabilities: `fs.read` and `external.send.draft`. Planning fails closed when a model returns any other capability ID.
4. `fs.read` is a local stdio MCP server actively passed to Codex app-server. It restricts reads to the selected workspace, rejects symbolic-link escape, limits payload size, and emits a content hash.
5. Codex can interrupt an MCP call with `mcpServer/elicitation/request`. HUMMER accepts this request only when the exact `hummer_local/fs_read` tool is tenant-registered, connection-verified, and low risk. Unknown, unverified, or higher-risk requests are declined.
6. `external.send.draft` is a main-process built-in tool. It requires an approved `external.send*` policy decision for the same tenant, session, action, and requester. It creates a new local draft through the controlled-write channel and never sends or delivers content.
7. Every completed, failed, or declined invocation is recorded in `tool_invocations` and the domain hash chain. Outcome receipts include capability ID, duration, result, and evidence references.

The app-server elicitation response shape is based on the official Codex app-server documentation, verified on 2026-09-11: https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md

## Evidence

### Real external runtime plus local product chain

- Run generated at 2026-09-11T04:31:27.294Z: `spikes/m5d-tool-registry/tool-registry-evidence.json`.
- Wire: `spikes/m5d-tool-registry/tool-registry-wire.jsonl`.
- Codex emitted a real `mcpToolCall` for `hummer_local/fs_read`; HUMMER returned an accepted elicitation response; the call completed in 4 ms.
- The read produced `evidence://sha256/3f07e277db4d75abf4ce00d87312e9aa38e8b728b7699cdfdf49debfc647fcb6`; the receipt contained the invocation; chain integrity was `valid=true, checked=19`.

### Local product chain only

- Run generated at 2026-09-11T04:43:48.371Z: `spikes/m5d-external-draft/external-draft-evidence.json`.
- The rejected branch created no file and recorded a declined invocation.
- The approved branch created only `drafts/approved-customer-update.md`, produced content-addressed evidence, appeared in the outcome receipt, and left chain integrity `valid=true, checked=12`.
- This evidence does not claim a provider call or external delivery.

## Consequences

- An MCP startup status alone is not business authorization. Registry state and risk policy remain HUMMER responsibilities.
- Arbitrary customer MCP endpoints, OAuth, and secret-backed MCP configuration are not delivered by M5-D. The shipped connection is the trusted local read-only server.
- Channel delivery remains explicitly out of scope. `external.send.draft` proves controlled draft creation only.
