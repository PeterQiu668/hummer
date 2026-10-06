# ADR-045: Capability package v1 and team read-only sharing

- Status: accepted
- Date: 2026-10-07
- Scope: `packages/contracts/src/capability/**`

## Context

W5 needs a reusable capability package without opening a marketplace or treating
unverified author claims as operational evidence. The target contract requires a
package to carry its source boundary, provenance, real trial summary, failures,
declared permissions, evidence references, and a verifiable receipt. Package
versions are append-only. During the first network step, a package may only be
shared read-only within its tenant or with an invited tenant, and installation
must pass an explicit safety gate.

The important trust distinction is that an author supplies capability content,
while the trial service records `SkillTrial` facts. A JSON schema cannot
authenticate a caller by itself, so the contract must keep those inputs separate
and host integrations must expose the system-recording input only to their
authenticated trial service.

## Decision

### TypeBox is the single structural source

`schemas.ts` defines these version-1 TypeBox contracts, each with
`additionalProperties: false` at every object boundary:

- `CapabilityPackageAuthorInput`: authorable package content. It deliberately
  has no `trialRecord` property and cannot select `shared` status.
- `SkillTrialSystemRecordInput`: a fact emitted by the trusted trial service.
  `recordedBy` is fixed to `system:skill-trial`; live trials require an approval
  reference and failed trials require a failure-step reference. Every trial is
  bound to tenant, package, version, and immutable package digest.
- `CapabilityPackageV1`: the complete persisted/exported package. It requires
  `provenance`, `sourceBoundary`, `trialRecord`, `failureNotes`,
  `declaredPermissions`, `evidenceRefs`, and `receiptRef`.
- `TeamReadOnlyShare`: embeds the complete package and fixes access to
  `read_only`, editing to false, and tenant-copying to false. Cross-tenant shares
  require accepted invitation evidence bound to the exact source, target,
  package version, and package digest.
- `CapabilityInstallGateInput` and `CapabilityInstallGateDecision`: immutable
  host-recorded evidence and decision records for static checks, exact
  permission review, provenance verification, receipt verification, and digest
  verification. Request, share, and package digests are carried through the
  decision so a bare caller-authored approval cannot substitute for evaluation.
- `AgentSkillsExportDescriptor`: the eight required Agent Skills files with a
  SHA-256 for each, `manifest.json` as the only install entry, and literal-false
  declarations for raw recordings, credentials, and unredacted customer data.

Ajv 2020 compiles the TypeBox schemas directly. Standard Schema adapters call
the same validators. Cross-field rules that JSON Schema cannot express remain
small pure semantic checks layered after Ajv. Tests compare raw Ajv and Standard
Schema on every top-level contract and on structural negative cases.

### Trials are system-derived

`createTrialRecordFromSystemTrials` accepts one or more validated
`SkillTrialSystemRecordInput` facts for exactly one tenant, package, and package
version and digest, then derives the aggregate `TrialRecord`. Empty,
cross-tenant, cross-version, cross-digest, duplicate-trial, and non-shadow input
is rejected. The aggregate retains its tenant/package/version/digest and unique
trial IDs, plus a separately hashed regression result. No author input accepts
an aggregate trial record. A package cannot become `shared` before five unique
shadow trials all pass with a passing regression result.

The literal system recorder is a contract discriminator, not authentication.
Hosts remain responsible for binding this surface to an authenticated system
principal; renderer or user-supplied JSON must never be routed to it.

### Versions append; they do not overwrite

`packageVersion` is a positive integer. Version 1 has no predecessor; every
later version identifies the immediately preceding version and digest.
`evaluateCapabilityVersionAppend` rejects an existing version number, an
identity change, a gap, malformed history, or a candidate that does not append
to the latest known version and digest. The function returns a decision and
mutates no record. A store must still load complete history and perform the
append under a unique-key/current-digest transaction; caller-supplied partial
history is never authoritative.

### Sharing is read-only and installation is fail-closed

A share embeds the source package so its required trust fields are present at
the validation boundary. The package tenant must equal `sourceTenantId`, the
package must be in `shared` status, and a different target tenant requires an
invitation record whose source, target, package version, digest, acceptance,
and expiry all match the share. Package and share digests are recomputed.

`assessCapabilityInstallGate` is a pure decision function. It approves only
when:

1. the share and target tenant are valid;
2. host-recorded static analysis passes with no findings;
3. host-recorded provenance, receipt, package digest, invitation, and regression
   evidence all pass and carry SHA-256 evidence digests; and
4. the approved permission set exactly matches each declared capability,
   access class, and path set, with no denied permission.

The install input must also contain the complete Agent Skills export descriptor.
That descriptor makes a missing `SKILL.md`, `manifest.json`, `receipt.json`, or
other required artifact a contract failure and disallows host-specific install
entries.

The function does not install, copy, mutate, or grant a capability. Hosts must
construct the evidence record behind an authenticated system boundary, persist
and authorize an approved decision, and match its request/share/package digests
before any later install action. No API accepts a decision supplied by a tenant.

All source-boundary and permission paths are normalized forward-slash relative
paths. Absolute, drive-qualified, traversal, empty-segment, backslash, and
control-character paths are rejected. Permission equality uses canonical JSON,
not delimiter concatenation.

## Explicit non-goals

- No price, order, payment, settlement, billing, or rating contract.
- No public listing, public visibility, marketplace write, or ownership transfer.
- No editing or copying another tenant's package.
- No host IPC, persistence migration, UI, or install implementation in this ADR.
- No claim that a schema literal authenticates the trial service or verifies a
  receipt; those are host/runtime responsibilities.

Public distribution and any later commercial fields require a separate ADR,
authorization model, and exit gate. They must not be added as optional fields to
these W5 contracts.

## Consequences

- Consumers get strongly typed, strict runtime validation with a common
  Standard Schema interface.
- A shared package always carries the evidence needed for review and an install
  decision; partial listings cannot pass validation.
- Existing package versions remain immutable and auditable.
- Trial summaries cannot enter through the authoring contract, reducing the
  chance that self-reported results are mistaken for system observations.
- Host integrations still need authenticated service boundaries, receipt/digest
  verification, storage, and authorization before these records can cause an
  installation.

## Rejected alternatives

- **One permissive package input with optional trust fields.** This would let a
  draft become shareable without crossing a clear evidence boundary.
- **Allow authors to submit `trialRecord`.** This turns evidence into a claim and
  enables trivial trial inflation.
- **Mutable latest-version record.** This destroys the audit link between an
  installed package and the content that was reviewed.
- **Reference-only shares.** A reference alone cannot prove that the shared
  boundary received all mandatory trust fields.
- **Add future marketplace fields now.** Optional price/public/payment fields
  would widen authority and semantics before the read-only exit gate is met.
