# ADR-014: Structured task files for folder intake

- Status: Accepted for internal validation
- Date: 2026-10-06
- Milestone: M5-I

## Context

ADR-011 introduced folder intake: a file dropped into a tenant's inbox becomes a `pending` work order. The file is treated as an attachment only. Title, assignee, and due date are fixed (`处理新订单：<file>`, `自动推荐`, `null`), and the file content reaches the planner as a pre-read summary.

That is correct for customer documents, but not for an upstream orchestrator. agent-hub (the multi-device collaboration base described in `agent-hub/HUMMER-INTERFACE.md`) needs to hand HUMMER a task whose fields are already known. Without a structured entry, every such task needs manual rewriting before confirmation, and the origin of the task is lost.

## Decision

1. A file whose name ends in `.hummer-task.json` (case-insensitive) is parsed as a structured task instead of being pre-read. Every other file keeps the ADR-011 path unchanged.
2. The file must declare `schema: "hummer.work-order-task"` and `version: 1`. Allowed fields are `title`, `target`, `expectedDeliverable` (required) and `assignee`, `dueAt`, `attachmentNames`, `prompt`, `origin` (optional). Unknown fields are rejected so that a future field such as an auto-confirm flag cannot be smuggled in silently.
3. Parsing produces the same `WorkOrderIntakePayload` shape as the form entry and applies the same defaults (`assignee = 自动推荐`, `dueAt = null`, a generated prompt). `dueAt` is normalized to UTC ISO 8601. `origin` accepts only `system`, `device`, `agent`, `taskId` strings for traceability.
4. Attachment names must be workspace-relative; absolute paths and `..` segments are rejected early. Names remain references only; any later read still passes `workspace-file-guard`.
5. Files are limited to 64 KiB. A UTF-8 byte order mark is accepted because common Windows tools write one.
6. **The intake is always `pending`.** A structured file cannot start a runtime session, cannot pre-approve anything, and goes through the existing confirmation, planner, approval, execution, outcome, and receipt path.
7. An invalid structured file is not dropped. It becomes a visible `pending` intake with `executable: false` and a `preReadError` explaining the reason. `WorkOrderIntakeStore.confirm` already refuses non-executable intakes.
8. No contract, migration, IPC channel, or UI change is required. The raw file bytes are stored as evidence, and `work_order_intake.received` is appended to the hash chain as before.

## Evidence

- Unit: `apps/desktop/src/structured-task-file.test.ts` (16 cases: field mapping, defaults, BOM, ten explicit rejection reasons, size limit, pending-only storage, invalid intake cannot be confirmed, chain integrity).
- End-to-end: `npm run test:desktop:structured-intake` → `spikes/m5i-structured-intake/structured-intake-evidence.json` and `structured-intake.png`. A real Electron inbox received one valid and one broken task written atomically (`.part` then rename). The valid task kept its assignee, UTC due date, and origin device; the broken task was visible with its reason and confirmation was rejected; zero runtime sessions existed before confirmation; chain integrity was valid.

## Consequences

- agent-hub (or any orchestrator) can dispatch work with known fields while humans keep the final confirmation.
- Output delivery and receipt anchoring (proposed P2 in the interface draft) are explicitly out of scope for this ADR.
