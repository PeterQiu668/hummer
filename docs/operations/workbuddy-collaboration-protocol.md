# WorkBuddy Collaboration Protocol

Status: operational draft for HUMMER Wave 0 and Wave 1.
Owner: Codex is the architecture owner, integration gatekeeper, and release approver. WorkBuddy agents are scoped implementers.

This document is the handoff bridge between Codex and WorkBuddy. It is intentionally executable: every agent must have a bounded ticket, an isolated branch/worktree, a contract version, and a reproducible handoff.

## 1. Authority and non-negotiable rules

- Codex owns product scope, shared contracts, architecture decisions, integration order, and milestone acceptance.
- WorkBuddy agents may implement an approved ticket. They may not enlarge product scope, redefine public contracts, merge branches, or silently repair another agent's domain.
- `WorkOrder`, append-only `DomainEvent`, `Approval`, `Evidence`, `ResultPackage`, and `RuntimeAdapter` are the Wave 1 shared language.
- Chat messages, Zustand state, screenshots, and mock cards are projections or presentation data. They are not the source of truth.
- Every state-changing command must be idempotent, version-checked, tenant-scoped, and represented by an event.
- High-risk writes are blocked until a human approval is recorded. Approval is not proof that the protected action completed.
- No real customer data, external write, long-lived credential, payment action, outbound message, or uncontrolled browser automation is allowed in Wave 1.
- Do not hide failed checks. A ticket with a failed required check is `BLOCKED`, not `DONE`.

## 2. Copy this into WorkBuddy before launching agents

```text
You are the implementation swarm for the HUMMER repository.

Codex is the architecture owner and integration gatekeeper. WorkBuddy agents implement only approved, bounded tickets. Before any edit, read:
- AGENTS.md
- docs/architecture/mvp-contract.md
- docs/architecture/domain-model.md
- docs/architecture/api-contract.yaml
- docs/decisions/ADR-001-mvp-boundary.md
- docs/plans/mvp-swarm-plan.md
- docs/operations/workbuddy-collaboration-protocol.md

Current objective:
Implement one trusted, deterministic Wave 1 loop:
boss creates a WorkOrder -> one digital employee performs safe synthetic GTM research -> synthetic CRM/CSV write is held for human approval -> ResultPackage contains deliverables, evidence, cost and risk -> human accepts or rejects -> audit timeline and ROI projection update.

Do not implement the full enterprise OS. Do not add real CRM writes, external email, customer data, payment actions, long-lived credentials, uncontrolled browser automation, IM integration, marketplace settlement, or production multi-tenancy.

Before editing:
1. Inspect git status and confirm your branch/worktree is isolated.
2. Run the repository baseline checks documented in the ticket.
3. Confirm the ticket owner, allowed paths, forbidden paths, contract version, dependencies, and acceptance commands.
4. If the ticket requires a shared contract change, stop and send a proposal to Codex. Do not edit the contract yourself.

During implementation:
- Use test-driven development: write a focused failing test, implement the smallest passing change, then refactor.
- Touch only the ticket's allowed paths. Do not modify another agent's files.
- Keep public types, event names, status transitions, and API payloads aligned with the frozen contract.
- Keep fixtures synthetic and redacted. Never place secrets, credentials, PII, customer records, or raw sensitive content in code, prompts, logs, screenshots, or tests.
- Use deterministic clocks, IDs, and mock runtime behavior where the ticket requires reproducibility.
- Commit focused, reversible changes. Do not self-merge or rebase another agent's branch.

Use these ticket states:
READY -> CLAIMED -> IMPLEMENTING -> HANDOFF
IMPLEMENTING -> BLOCKED when a dependency, contract decision, or check prevents progress.
HANDOFF -> ACCEPTED only after Codex review and milestone checks.

At handoff, return exactly:
1. Ticket, branch/worktree, and contract version.
2. Changed paths and why.
3. Behavior, API, type, event, or state changes.
4. Exact checks run with complete pass/fail results.
5. Contract impact, or the exact text: no contract impact.
6. Remaining risks and assumptions.
7. Rollback steps.
8. Suggested commit message.

Stop and report instead of guessing when:
- a shared public type/event/status must change;
- two tickets need the same file;
- a required dependency is missing;
- a check fails because of another branch;
- the ticket exceeds its Definition of Done;
- an external system or credential is requested.
```

## 3. Repository preflight

Codex must complete this preflight before creating implementation tickets:

```text
cd <repository-root>
git status --short
npm run typecheck
npm run build
npm run test:unit
npm run test:ui
npx playwright test --list
```

The current repository already contains Vitest, React Testing Library, and Playwright configuration. The current scripts are `test:unit`, `test:ui`, and `test:e2e`; `test:api`, `test:domain`, and `test:runtime` must not be used until their test suites and scripts actually exist. A baseline failure is recorded in the Wave 0 report and is fixed or explicitly accepted before Wave 1 begins.

Before each ticket, Codex records:

```text
Ticket:
Owner:
Branch/worktree:
Contract version:
Allowed paths:
Forbidden paths:
Dependencies:
Baseline result:
Acceptance commands:
```

## 4. Isolation and ownership

- One agent owns one branch and one worktree. Never run two writing agents in the same live directory.
- The branch name must match the ticket, for example `feat/domain-api` or `feat/frontend-trusted-loop`.
- A ticket may edit only its declared paths. A shared file is locked to one owner until Codex integrates it.
- Shared files include, unless a ticket explicitly grants ownership: `AGENTS.md`, `package.json`, lockfiles, `tsconfig*.json`, `vite.config.*`, `vitest*.config.*`, `playwright.config.*`, `src/lib/types.ts`, `src/store/useAppStore.ts`, `src/App.tsx`, shell/navigation files, and all files under `docs/architecture/**`.
- If a new shared file is unavoidable, the agent stops and proposes its owner, API, and integration order. Codex decides whether to approve it.
- Agents do not cherry-pick, merge, reset, or overwrite another agent's worktree.
- WorkBuddy reports the commit SHA at handoff. Codex alone decides whether to cherry-pick, merge, or issue a repair ticket.

## 5. Ticket lifecycle

| State | Meaning | Required action |
| --- | --- | --- |
| `READY` | Codex has approved the ticket and dependencies are satisfied | WorkBuddy may assign one agent |
| `CLAIMED` | Agent and worktree are recorded | Agent runs preflight and confirms scope |
| `IMPLEMENTING` | Changes are being made | Agent reports blockers promptly |
| `BLOCKED` | Progress is impossible without a decision, dependency, or repair | Agent stops changing code and reports evidence |
| `HANDOFF` | Definition of Done is met and checks are recorded | Agent submits the handoff template |
| `ACCEPTED` | Codex has reviewed the change and milestone checks pass | Codex integrates the branch |
| `REWORK` | Review found a bounded defect | Agent receives a repair list; scope remains unchanged |

A ticket is never considered complete because files were changed. It is complete only after `HANDOFF` and Codex acceptance.

## 6. Parallel launch order

1. Codex freezes Wave 0 documents and records the baseline checks.
2. The test foundation is verified. Because the current repository already has the test dependencies and configs, do not reinstall them. Add only missing scripts or fixtures through a separate approved ticket.
3. Start HUM-A and HUM-D in parallel. HUM-D uses a typed mock client and does not wait for a live API.
4. Codex reviews HUM-A's public types and API surface before starting HUM-B and HUM-C.
5. Start HUM-B and HUM-C in parallel after HUM-A is accepted or after Codex explicitly approves their interface fakes.
6. Keep HUM-E active as a reviewer and test author. HUM-E may add test fixtures and CI checks but may not rewrite feature implementation.
7. Integrate in this order: contracts/API -> domain/audit -> runtime -> UI -> full QA.
8. Run the milestone gate before starting the next wave.

## 7. Escalation rules

| Situation | WorkBuddy action | Codex decision |
| --- | --- | --- |
| Public type, event, status, or API needs change | Stop; send old/new contract diff and reason | Approve/reject and create ADR/version bump if accepted |
| Test fails due to another branch | Report exact command, first failing assertion, and dependency | Change integration order or issue a repair ticket |
| Two agents need the same file | Stop one ticket before editing | Split the file, sequence the work, or assign a single owner |
| External system or credential is needed | Do not connect | Decide whether it is explicitly post-MVP |
| Event hash, evidence, or audit behavior is ambiguous | Stop before implementation | Clarify contract and add a decision record |
| Ticket exceeds its Definition of Done | Return a thin vertical slice and list out-of-scope work | Create a new scoped ticket |
| Security, privacy, or data-loss concern appears | Stop the affected action and preserve the evidence | Set the policy decision and remediation priority |

## 8. Handoff report

```text
Ticket: HUM-X
Milestone: G[0-4]
Agent:
Branch/worktree:
Commit SHA:
Contract version:

Scope completed:
Changed paths and reasons:
Behavior/API/types/events/state transitions:

Commands and complete results:
- command: PASS/FAIL
  result:

Contract impact:
- no contract impact
or
- proposed contract diff:
- compatibility impact:
- Codex decision required:

Known failures, risks, and assumptions:
Rollback:
Suggested commit message:
Recommended next ticket:
```

## 9. Milestone report template

```text
Milestone: G[0-4]
Branches reviewed:
Tickets accepted:
Tickets rejected or rework required:
Contract version:
Scope completed:
Checks run and results:
Integration order:
Known failures or risks:
Rollback point:
Decision for next milestone:
```

## 10. Definition of Done

A ticket may enter `HANDOFF` only when all applicable conditions are true:

- Acceptance behavior is covered by a focused test before or alongside implementation.
- The implementation stays within its path boundary.
- Public behavior is compatible with the frozen contract, or a Codex-approved ADR records the change.
- No secrets, credentials, PII, customer data, or unsafe external action appears in fixtures, prompts, logs, screenshots, or UI.
- Required focused checks pass.
- `npm run typecheck` and `npm run build` pass when the ticket can affect the frontend or shared TypeScript.
- The handoff report is complete and includes a rollback step.
- The branch contains focused commits and no unrelated formatting or dependency churn.

## 11. What WorkBuddy must never do

- Do not let an agent choose product scope from the research documents.
- Do not use chat history as the implementation database.
- Do not let a UI action directly mutate domain state without an adapter/command boundary.
- Do not treat a visible approval badge as proof of an executed write.
- Do not add a framework merely because it is named in the research. Add it only when a ticket proves the need and Codex approves the dependency.
- Do not claim a real runtime, real CRM, real browser action, or production audit ledger when the implementation is deterministic mock behavior.

## 12. WorkBuddy operating prompt footer

Every ticket prompt should end with:

```text
You are not authorized to broaden scope, modify forbidden paths, change shared contracts, connect external systems, or self-merge. If any of those are required, stop and return BLOCKED with the exact evidence and a proposed decision for Codex.
```
