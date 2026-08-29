# HUMMER 人-分身项目协作与技能成长说明

Status: product decision for M4 refinement
Date: 2026-08-29
Scope: product model, interactive prototype, and M4 implementation contract. This document does not claim that project or training facts are persisted yet.

## 1. Product decision

HUMMER is not an organization made of independent agents. Its primary operating unit is:

> one accountable human + that human's active digital twin

The human owns goals, judgment, commitments, and final acceptance. The twin represents the human within an explicit delegation boundary: it receives internal work, keeps context, coordinates progress, and raises decisions back to its owner.

Other digital employees are bounded workers. In a project they are assistants or temporary specialists. They may produce deliverables and request protected actions, but they cannot become the final accountable owner merely because they executed most steps.

| Role | Product language | Responsibility |
| --- | --- | --- |
| HumanUser | 真人负责人 / 真人协作者 | owns commitments and accepts outcomes |
| DigitalTwin | 个人分身 | represents one human, coordinates and coaches within delegated authority |
| DigitalEmployee | 数字助手 / 数字员工 | executes bounded work under a project assignment |

## 2. Non-negotiable invariants

1. Each human has at most one active personal twin. Historical twins may remain for audit, but only one can represent the human at a time.
2. Every project has exactly one accountable human.
3. The accountable human's active twin joins the project as coordinator by default.
4. Inviting a human collaborator offers that human and their twin as one visible responsibility pair. The human may join without delegation, but a twin never joins without its owner being visible.
5. A digital employee cannot hold accountable or approver project roles. It can be assistant or temporary specialist.
6. Project permissions expire when the assignment ends. Permanent organizational permissions are never inferred from project membership.
7. A twin's personal preference learning is private by default. It must not silently train another human's twin or an organizational skill.
8. A digital employee skill revision is promoted only after a replay/evaluation and a human decision.

## 3. Project team model

The M4 target adds these implementation-neutral objects:

| Object | Minimum fields | Purpose |
| --- | --- | --- |
| Project | id, tenantId, title, goal, accountableHumanId, coordinatorTwinId, status | durable collaboration context above individual WorkOrders |
| ProjectMembership | projectId, actorRef, role, scope, joinedAt, expiresAt | explains why a human or twin can see and act in a project |
| WorkerAssignment | projectId, workOrderId, employeeId, sponsorHumanId, permissionScope, expiresAt | makes digital labor temporary and traceable |
| BadCase | projectId, workOrderId, trajectoryRef, reportedBy, failedCriteria | training evidence from a real rejected or corrected result |
| SopRevision | targetActorRef, baseVersion, candidateVersion, diff, sourceBadCaseId | versioned method change |
| Evaluation | sourceRunId, candidateRunId, criteria, verdict, metrics | compares the original and forked runs |
| MemoryCandidate | ownerActorRef, sourceEventRefs, proposedMemory, status | keeps personal memory gated by its owner |

ProjectMembership.role uses:

- accountable_human
- coordinator_twin
- collaborating_human
- collaborator_twin
- digital_assistant
- temporary_specialist
- external_expert

The UI groups humans and their twins as visible responsibility pairs. Audit records retain the individual actorRefs.

## 4. Collaboration workflow

### 4.1 Start a project

1. The initiator describes the goal and acceptance criteria.
2. HUMMER fixes the initiator as accountable human unless ownership is explicitly transferred to another human.
3. The initiator's active twin joins as project coordinator.
4. The initiator invites relevant human colleagues. The UI shows each colleague together with their active twin and its delegation boundary.
5. HUMMER recommends digital employees based on missing capabilities. They join as temporary assistants with project-scoped permissions.
6. Before starting, the plan shows responsibility, deliverables, approvals, data scope, and expiry.

### 4.2 Work inside the project

- Humans and twins share one trajectory, but every event keeps its real actorRef.
- A twin can coordinate, summarize, remind, and delegate within its owner's authority.
- Human collaborators own named pieces of the result; their twins keep those pieces moving.
- Digital employees receive bounded WorkOrders. They do not negotiate business commitments or accept final outcomes.
- Protected actions route to the named human approver, never to a generic project bot.

### 4.3 Finish the project

- The accountable human accepts or rejects the combined ResultPackage.
- Temporary worker permissions expire.
- Results become project knowledge only after acceptance.
- Rejected criteria create BadCases for the relevant twin, employee, or team method; they do not indiscriminately train every participant.

## 5. Three separate growth loops

### 5.1 Personal twin coaching

Learns the owner's decision preferences, coordination cadence, recurring risk reminders, and delegation patterns. Sources are owner approvals, rejections, takeovers, and explicit "remember this" actions. Every proposed memory remains a MemoryCandidate until the owner accepts it. It is private to the human-twin pair by default.

### 5.2 Digital employee skill training

Learns role SOPs, tool choice, quality checks, and when to request approval.

BadCase -> one scoped SOP change -> forkFromCheckpoint -> Evaluation -> human promotion

A chat transcript, higher token count, or a successful-looking answer is not training evidence. Promotion requires the same-task comparison and acceptance criteria.

### 5.3 Team method promotion

A validated private revision can be promoted to the current project, a department role, or the organization skill catalog. Promotion is a separate human decision with scope and rollback. Personal preferences and raw project data are excluded from the promoted package.

## 6. Product surface changes

### Team collaboration

- "My team" starts with "me and my twin" as a fixed responsibility pair.
- "Project teams" shows accountable pair, collaborator pairs, temporary assistants, and required approvals.
- "Build project team" automatically pairs invited humans with their twins and labels digital employees as non-accountable temporary assistants.
- Organization and relationship views remain available for structural and audit views.

### Workbench

The single "assign to" control should evolve into a compact project-team picker: accountable owner, human-twin collaborators, digital assistants, and per-member scope/expiry. For a one-person task, defaults remain skippable: the current human + personal twin + an automatically recommended assistant.

### Growth and review

The page separates "My twin" coaching, "Digital employee" BadCases and SOP replay, and "Team method" promotion scope and rollback.

## 7. Permissions and privacy

- Twin authority is derived from its owner and can only be narrower.
- Project membership grants visibility to project-scoped references, not the source system globally.
- A digital employee's permission is the intersection of job profile, project assignment, runtime sandbox, and approval policy.
- Project completion revokes temporary grants.
- Personal coaching data, raw prompts, secrets, and customer PII cannot enter reusable team skills.
- Audit views show the real human, twin, employee, engine, model, data domain, and approval chain.

## 8. Implementation sequence

### M4-A: contract and local facts

- Add an ADR before changing the frozen OpenAPI contract.
- Add SQLite migration v3 only; do not modify v1 or v2.
- Persist projects, project_memberships, worker_assignments, bad_cases, sop_revisions, evaluations, and memory_candidates.
- Emit append-only events for membership, assignment, training, evaluation, and promotion.

### M4-B: project collaboration

- Connect the prototype project-team builder to the local fact source.
- Let the Workbench start a session from a Project and preserve all actor IDs.
- Route approvals to the named human.
- Revoke worker assignments at project close.

### M4-C: evolution

- Rejection creates a BadCase with trajectory and evidence references.
- SOP revision uses the real RuntimeAdapter fork.
- Evaluation compares source and candidate ResultPackages.
- Promotion creates a versioned, rollback-capable scope decision.
- "Remember this" creates a private MemoryCandidate.

## 9. Acceptance scenarios

### Project collaboration

Create a project as Kunlun, invite Wu Fan, include both active twins, add one sales digital assistant, run a protected write, approve as the named human, and accept the ResultPackage. Audit must show one accountable human, two visible human-twin pairs, one temporary assistant, consistent project/actor IDs, and permission revocation at project close.

### Skill growth

Reject one criterion, create a BadCase, change one SOP line, fork from the original checkpoint, produce a different result, compare both branches, approve the candidate revision, and promote it only to the current project. The growth page must link the promoted version to the BadCase and both runs.

## 10. Current prototype truth

The project-team builder and layered growth controls are currently interactive synthetic UI. They do not yet create durable Project, membership, or training facts. Existing organization hires, runtime sessions, approvals, evidence, and result packages retain their current persistence guarantees. Production claims wait for M4-A through M4-C acceptance.
