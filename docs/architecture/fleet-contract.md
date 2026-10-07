# HUMMER Fleet Contract v1.0

Status: frozen for Phase 1. The v1.0 freeze is additive over Phase 0 v0.1; serialized schema versions remain `1`. Semantic changes require an ADR and an explicit version bump.

## Boundary

These contracts connect the HUMMER control plane to independent node agents. HUMMER remains the source of truth for tasks, approvals, results, receipts, and capabilities. A node reports availability and executes a leased task; it cannot confirm its own intake, approve a protected action, extend a grant, or authoritatively choose a tenant.

The authored TypeBox schemas under `packages/contracts/src/fleet/` are the single source for JSON Schema and TypeScript types. Ajv 2020 validates those same objects with strict unknown-field rejection. Standard Schema adapters expose the validation boundary without introducing a second schema library.

All serialized fleet contracts are limited to 65,536 UTF-8 bytes. A UTF-8 BOM and CRLF whitespace are accepted. Malformed UTF-8, an unknown schema name, an unsupported version, or an unknown field is rejected explicitly.

## Contract semantics

`NodeManifest.load.running` is the node's unfinished lease count. A node must not advertise capabilities that its current runtime probes cannot execute. Multi-tenant registration requires explicit authorization outside this contract.

`TaskEnvelope.workOrderTask` preserves `hummer.work-order-task` version 1 without reinterpretation. Relay injects the authenticated `tenantId`, and every received task remains pending until a human confirms it. A duplicate `(tenantId, idempotencyKey)` returns the original dispatch result and appends no event; reuse of that key with different content is an error.

`RunEvent` sequence numbers start at 1 and increase without gaps per WorkOrder. `artifact` payloads require a SHA-256 digest and a workspace-relative path. After `needs_approval`, the node cannot advance until a matching decision arrives. `completed` requires at least one preceding artifact.

`ApprovalRequest` can originate from `system:*`, `employee:*`, or `twin:*`, never from `human:*`. Decisions are immutable human actions: only `human:*` and authenticated `account:*` actor references are accepted. A `system:*` decision is rejected and emits a security alert. Non-approved decisions cannot carry a granted scope.

`CapabilityGrant` is the bounded, task-scoped authorization represented by an opaque badge token at transport time. The contract contains no token or long-term credential. A grant is bound to one tenant, work order, node, and run; its capabilities and relative paths are explicit, `usedCount` cannot exceed `maxUses`, and `revokedAt` makes it unusable even before expiry.

## Machine-checked field tables

`npm run test:contract` compares this table's field set, JSON type, requiredness, and literal/enum values against the TypeBox schemas.

| Contract | Field | Type | Required | Enum |
|---|---|---|---|---|
| NodeManifest | agentVersion | string | yes | - |
| NodeManifest | capabilities | string[] | yes | - |
| NodeManifest | load | object | yes | - |
| NodeManifest | load.cpuPct | number | no | - |
| NodeManifest | load.queued | integer | yes | - |
| NodeManifest | load.running | integer | yes | - |
| NodeManifest | mcp | object | yes | - |
| NodeManifest | mcp.endpoint | string | yes | - |
| NodeManifest | mcp.tools | string[] | yes | - |
| NodeManifest | nodeId | string | yes | - |
| NodeManifest | platform | string | yes | darwin,linux,win32 |
| NodeManifest | runtimes | object[] | yes | - |
| NodeManifest | runtimes[].available | boolean | yes | - |
| NodeManifest | runtimes[].kind | string | yes | claude,cli-other,codex,deepseek,gui-exec |
| NodeManifest | runtimes[].pinnedVersion | string | yes | - |
| NodeManifest | runtimes[].probeError | string | no | - |
| NodeManifest | schema | string | yes | hummer.node-manifest |
| NodeManifest | tenantIds | string[] | yes | - |
| NodeManifest | untrustedNotes | string | no | - |
| NodeManifest | version | integer | yes | 1 |
| TaskEnvelope | approvalPolicyRef | string | yes | - |
| TaskEnvelope | capabilityRef | string | no | - |
| TaskEnvelope | executionPlan | object | no | - |
| TaskEnvelope | executionPlan.kind | string | yes | fs.read.attest.v1 |
| TaskEnvelope | executionPlan.maxBytes | integer | yes | - |
| TaskEnvelope | executionPlan.path | string | yes | - |
| TaskEnvelope | expiresAt | string | yes | - |
| TaskEnvelope | grantRef | string | no | - |
| TaskEnvelope | idempotencyKey | string | yes | - |
| TaskEnvelope | leaseMs | integer | yes | - |
| TaskEnvelope | originRef | string | yes | - |
| TaskEnvelope | schema | string | yes | hummer.task-envelope |
| TaskEnvelope | targetNodeId | string | yes | - |
| TaskEnvelope | targetRuntime | string | yes | claude,cli-other,codex,deepseek,gui-exec |
| TaskEnvelope | tenantId | string | yes | - |
| TaskEnvelope | version | integer | yes | 1 |
| TaskEnvelope | workOrderTask | object | yes | - |
| TaskEnvelope | workOrderTask.assignee | string | no | - |
| TaskEnvelope | workOrderTask.attachmentNames | string[] | no | - |
| TaskEnvelope | workOrderTask.dueAt | string | no | - |
| TaskEnvelope | workOrderTask.expectedDeliverable | string | yes | - |
| TaskEnvelope | workOrderTask.origin | object | no | - |
| TaskEnvelope | workOrderTask.origin.agent | string | no | - |
| TaskEnvelope | workOrderTask.origin.device | string | no | - |
| TaskEnvelope | workOrderTask.origin.system | string | no | - |
| TaskEnvelope | workOrderTask.origin.taskId | string | no | - |
| TaskEnvelope | workOrderTask.prompt | string | no | - |
| TaskEnvelope | workOrderTask.schema | string | yes | hummer.work-order-task |
| TaskEnvelope | workOrderTask.target | string | yes | - |
| TaskEnvelope | workOrderTask.title | string | yes | - |
| TaskEnvelope | workOrderTask.version | integer | yes | 1 |
| RunEvent | actorRef | string | yes | - |
| RunEvent | eventId | string | yes | - |
| RunEvent | idempotencyKey | string | yes | - |
| RunEvent | nodeId | string | yes | - |
| RunEvent | occurredAt | string | yes | - |
| RunEvent | payload | object | yes | - |
| RunEvent | payload.artifactId | string | no | - |
| RunEvent | payload.bytes | integer | no | - |
| RunEvent | payload.code | string | no | - |
| RunEvent | payload.message | string | no | - |
| RunEvent | payload.percent | number | no | - |
| RunEvent | payload.reason | string | no | - |
| RunEvent | payload.relPath | string | no | - |
| RunEvent | payload.requestId | string | no | - |
| RunEvent | payload.retryable | boolean | no | - |
| RunEvent | payload.runId | string | no | - |
| RunEvent | payload.sha256 | string | no | - |
| RunEvent | payload.summary | string | no | - |
| RunEvent | schema | string | yes | hummer.run-event |
| RunEvent | seq | integer | yes | - |
| RunEvent | tenantId | string | yes | - |
| RunEvent | type | string | yes | artifact,cancelled,completed,failed,needs_approval,progress,started |
| RunEvent | version | integer | yes | 1 |
| RunEvent | workOrderId | string | yes | - |
| ApprovalRequest | action | string | yes | - |
| ApprovalRequest | expiresAt | string | yes | - |
| ApprovalRequest | nodeId | string | yes | - |
| ApprovalRequest | redactedPreview | string | yes | - |
| ApprovalRequest | requestId | string | yes | - |
| ApprovalRequest | requestedBy | string | yes | - |
| ApprovalRequest | requestedScope | object | yes | - |
| ApprovalRequest | requestedScope.capabilities | string[] | yes | - |
| ApprovalRequest | requestedScope.maxUses | integer | no | - |
| ApprovalRequest | requestedScope.paths | string[] | no | - |
| ApprovalRequest | riskClass | string | yes | delete,egress,network,privilege,spend,unknown,write |
| ApprovalRequest | runId | string | yes | - |
| ApprovalRequest | schema | string | yes | hummer.approval-request |
| ApprovalRequest | target | string | yes | - |
| ApprovalRequest | tenantId | string | yes | - |
| ApprovalRequest | version | integer | yes | 1 |
| ApprovalRequest | workOrderId | string | yes | - |
| ApprovalDecision | decidedAt | string | yes | - |
| ApprovalDecision | deciderActorRef | string | yes | - |
| ApprovalDecision | decision | string | yes | approved,denied,expired,revoked |
| ApprovalDecision | decisionId | string | yes | - |
| ApprovalDecision | delegatedFrom | string | no | - |
| ApprovalDecision | grantedScope | object | no | - |
| ApprovalDecision | grantedScope.capabilities | string[] | yes | - |
| ApprovalDecision | grantedScope.expiresAt | string | yes | - |
| ApprovalDecision | grantedScope.maxUses | integer | no | - |
| ApprovalDecision | grantedScope.paths | string[] | no | - |
| ApprovalDecision | rationale | string | no | - |
| ApprovalDecision | requestId | string | yes | - |
| ApprovalDecision | schema | string | yes | hummer.approval-decision |
| ApprovalDecision | tenantId | string | yes | - |
| ApprovalDecision | version | integer | yes | 1 |
| CapabilityGrant | capabilities | string[] | yes | - |
| CapabilityGrant | expiresAt | string | yes | - |
| CapabilityGrant | grantId | string | yes | - |
| CapabilityGrant | issuedToRunId | string | yes | - |
| CapabilityGrant | maxUses | integer | yes | - |
| CapabilityGrant | nodeId | string | yes | - |
| CapabilityGrant | paths | string[] | yes | - |
| CapabilityGrant | revokedAt | string | no | - |
| CapabilityGrant | schema | string | yes | hummer.capability-grant |
| CapabilityGrant | tenantId | string | yes | - |
| CapabilityGrant | usedCount | integer | yes | - |
| CapabilityGrant | version | integer | yes | 1 |
| CapabilityGrant | workOrderId | string | yes | - |

## Compatibility rule

Version 1 is additive only within fields explicitly declared optional. A new required field, changed meaning, narrowed enum, or changed authorization rule requires a new contract version and ADR. Unknown fields remain rejected so a future auto-confirm, broader grant, or hidden execution flag cannot be smuggled into an older consumer.
