# HUMMER Engineering Agreements

This repository is moving from a React prototype to a trusted AI-native organization MVP.

## Delivery boundary

- Preserve the existing Vite + React + TypeScript frontend. Do not rewrite the app or its visual system during the MVP.
- Product facts are `WorkOrder`, append-only `DomainEvent`, `Evidence`, `Approval`, and `ResultPackage`. Chat and UI state are projections, never the source of truth.
- A state-changing business action must emit an event. High-risk actions are denied by default until an approval is recorded.
- Runtime implementations live behind `RuntimeAdapter`. No product domain type may depend on a single LLM, orchestration framework, MCP provider, or browser tool.
- Every business object is tenant-scoped. Never log secrets, credentials, personal data, or raw customer records in prompts, source code, fixtures, screenshots, or documentation.

## Parallel work rules

- Read `docs/architecture/mvp-contract.md`, `docs/architecture/domain-model.md`, and `docs/architecture/api-contract.yaml` before modifying shared behavior.
- One implementation agent owns one branch or worktree and only its declared directories. It must not merge other branches.
- Do not edit `docs/architecture/api-contract.yaml`, `src/lib/types.ts`, or the future shared contract package without an approved ADR and an explicit task assignment.
- Keep commits focused and reversible. Report changed paths, checks run, contract impact, and unresolved risks at handoff.

## Test-driven workflow

1. State the acceptance behavior and test it first.
2. Implement the smallest change that makes the test pass.
3. Refactor only after the relevant test, `npm run typecheck`, and `npm run build` pass.
4. Add a regression test for each defect before fixing it.

## Required checks

- Frontend-only change: `npm run typecheck` and `npm run build`.
- API/domain change: its focused unit tests, API contract validation, and the required frontend checks.
- Integration change: the relevant end-to-end smoke test plus all applicable checks above.

## UI constraints

- Keep the current restrained enterprise visual language described in `HANDOFF.md`.
- Use existing components and `lucide-react` icons where possible. Do not introduce a new design system or make unrelated visual rewrites.
