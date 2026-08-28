# ADR-001: Build the trusted work loop before the full organization OS

Date: 2026-08-23

## Decision

HUMMER Wave 1 will implement and demonstrate only the following closed loop:

1. a boss or digital twin creates a WorkOrder;
2. it is assigned to one digital employee;
3. a pluggable runtime performs a safe, bounded GTM research workflow;
4. a synthetic write-back is held behind human approval;
5. the runtime produces a ResultPackage with evidence, cost, risk, and rollback information;
6. a human accepts or rejects the result; and
7. the event timeline and ROI projection reflect the outcome.

The existing React prototype remains the presentation layer. A backend and runtime are introduced behind contracts, first using deterministic mock adapters.

## Context

The prototype already communicates the product vision: responsibility chain, digital employees, task flow, audit, evidence, approval, and ROI. Its data is local mock state, however, so it cannot yet prove that the visible collaboration is trustworthy or replayable. The product's wedge is not a broad chat experience; it is credible delegation with governance and acceptance.

## Consequences

- We defer generic agent marketplace, expert settlement, IM integrations, multi-tenant production operations, browser automation, and a real external CRM until the loop is proven.
- A real runtime may be introduced only after the mock runtime passes tests and the policy boundary is demonstrated.
- `WorkOrder`, `DomainEvent`, `Approval`, `Evidence`, and `ResultPackage` are shared language. UI-only names may continue as migration adapters but are not the new source of truth.
- This ADR deliberately separates the engineering demo domain (synthetic GTM) from the later commercial beachhead decision (which may be recruitment or another vertical).

## Alternatives considered

### Expand the existing Zustand mock first

Rejected. It is useful for demo speed but preserves no auditable, replayable business facts and prevents a backend/runtime team from working independently.

### Adopt a complete external agent framework as the core

Rejected. OpenAI Agents SDK, LangGraph, DeepSeek Harness, Codex, OpenClaw and HiClaw-inspired components are accelerators, not HUMMER's enterprise fact model or governance layer. The `RuntimeAdapter` boundary permits later evaluation without framework lock-in.

### Build the complete L1/L2/L3 architecture before a vertical loop

Rejected. It makes ROI and reliability untestable for too long and creates wide parallel work with high contract drift.
