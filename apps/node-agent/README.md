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
  "version": 1,
  "nodeId": "node-office-1",
  "tenantId": "tenant-example",
  "relayBaseUrl": "https://relay.example.invalid/",
  "badgeTokenEnv": "HUMMER_RELAY_BADGE",
  "grantTokenEnv": "HUMMER_NODE_GRANT",
  "grantExpiresAt": "2026-12-31T00:00:00.000Z",
  "grantScopes": ["node.heartbeat", "task.claim", "approval.request", "task.execute"],
  "journalPath": "C:\\Hummer\\state\\execution.jsonl",
  "heartbeatIntervalMs": 20000,
  "pollIntervalMs": 1000,
  "approvalTtlMs": 300000,
  "runtime": { "provider": "codex" },
  "capabilities": ["fs.read", "doc.extract", "workspace.exec"],
  "mcp": { "endpoint": "stdio://hummer-local", "tools": ["fs_read", "doc_extract", "workspace_exec"] },
  "approval": { "riskClass": "unknown" }
}
```

The credential fields name environment variables; token values must never be
written to the config. The process reads each token once and deletes that
environment entry immediately. Plain HTTP Relay URLs are accepted only on
loopback.

This daemon intentionally does **not** claim to execute production tasks yet.
It registers a formal `NodeManifest`, heartbeats, receives work, and creates a
deterministically bound `ApprovalRequest`. If a request is approved, execution
fails closed with `executor_unavailable` until a production runtime adapter and
OutcomeReceipt validator are explicitly injected. Runtime probes and MCP
metadata are inventory, not proof that a safe executor exists.
