# HUMMER Node Agent

`hummer-node` probes local runtimes or starts the fail-closed Node Agent daemon.

```powershell
hummer-node probe
hummer-node run --config C:\absolute\path\node-agent.json
```

The daemon config is strict JSON (`additionalProperties: false` semantics):

```json
{
  "schema": "hummer.node-agent-config",
  "version": 4,
  "nodeId": "node-office-1",
  "tenantId": "tenant-example",
  "relayBaseUrl": "https://relay.example.invalid/",
  "badgeTokenEnv": "HUMMER_RELAY_BADGE",
  "grantExpiresAt": "2026-12-31T00:00:00.000Z",
  "grantScopes": ["node.heartbeat", "task.claim", "approval.request", "task.execute"],
  "journalPath": "C:\\Hummer\\state\\execution.jsonl",
  "receiptRoot": "C:\\Hummer\\state\\receipts",
  "workspaceRoot": "C:\\Hummer\\workspace",
  "heartbeatIntervalMs": 20000,
  "pollIntervalMs": 1000,
  "approvalTtlMs": 300000,
  "runtime": { "provider": "codex" },
  "capabilities": ["fs.read"],
  "mcp": { "endpoint": "stdio://hummer-local", "tools": ["fs_read"] },
  "approval": { "riskClass": "unknown" }
}
```

The badge field names an environment variable; its value must never be written
to the config. The process reads it once and deletes that environment entry
immediately. Plain HTTP Relay URLs are accepted only on loopback.

The per-task bearer is requested only after the bound human approval and kept
only in the active execution object. There is no configured fallback task
token: a transport without Relay issuance fails closed before execution.

The only production executor enabled by this daemon is `fs.read.attest.v1`.
It reads one explicitly planned relative file below `workspaceRoot`, only after
a human approval and one-use task grant bind both `task.execute` and `fs.read`
to that exact path. It emits only the relative path, byte count, and SHA-256;
file content is never returned or logged. Symlinks/reparse points, hard links,
path traversal, absolute paths, aliases, files over 1 MiB, and changing files
fail closed. Every other task type still fails with `unsupported_execution_plan`.
Portable OutcomeReceipt verification and node-owned, create-only receipt
persistence remain mandatory before a run can become terminally completed.
