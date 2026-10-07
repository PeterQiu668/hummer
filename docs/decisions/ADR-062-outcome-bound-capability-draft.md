# ADR-062: Bind capability drafts to a verified successful outcome

- Status: accepted
- Date: 2026-10-07
- Scope: Relay capability-version intake and local executable evidence

## Context

The capability registry currently allows a draft after finding a completed
Fleet task plus caller-selected artifact and completed event ids. Those ids prove
that Relay observed a sequence, but they do not prove that HUMMER produced an
independently verifiable successful outcome receipt or that the named artifact
bytes still match their recorded hash. A caller could therefore turn synthetic
event identifiers into a draft without presenting the underlying outcome proof.

ADR-008 already defines the portable `hummer.outcome-receipt` v1 envelope and
its independent hash-chain verification algorithm. This change must reuse that
meaning without creating a new public receipt or capability schema.

## Decision

Capability-version intake now requires two transient proof inputs in addition to
the existing internal Relay source identifiers:

1. a complete `hummer.outcome-receipt` v1 envelope; and
2. canonical base64 bytes for the selected artifact event.

The Relay independently recomputes every receipt leaf hash, the receipt root,
and every domain-event chain link. It then requires an accepted outcome, valid
tenant-scoped chain, a real work-order id, and an accepted outcome domain event
bound to the same tenant, outcome, work order, session and evidence reference.

Draft creation additionally requires all of the following to agree:

- authenticated tenant, completed Fleet task, receipt tenant and receipt work order;
- artifact and completed events from the same task and target node, with no
  failed/cancelled terminal fact;
- presented artifact bytes, event byte count, event SHA-256 and receipt
  `evidence://sha256/...` reference;
- author `receiptRef` and receipt manifest root;
- author evidence digest and artifact SHA-256; and
- author provenance node and demo-session id versus the task target node and
  outcome session.

All checks run before Memory-store mutation and inside the SQLite creation
transaction. Failure creates no package row or audit event.

The receipt and artifact bytes are verification inputs only. The registry stores
the pre-existing capability author metadata, package digest, source task/event
ids and audit hashes. It never copies receipt fields, customer content, artifact
bytes, artifact path or artifact name into capability metadata or audit detail.

`CapabilityVersionCreateInput` is an internal Relay port rather than a frozen
`@hummer/contracts` schema. Its stricter required evidence is therefore changed
without modifying any public contract version or historical database migration.

## Executable evidence

The focused gate must create a session, evidence blob, accepted outcome and
verifiable receipt through `DesktopPersistence`, then create a Relay draft from
the independently verified receipt and exact evidence bytes. Negative cases
must cover receipt tampering, rejected outcome, failed task, absent or altered
artifact bytes/hash, tenant/work-order mismatch and provenance mismatch, and
must prove that no draft was created.

## Consequences and limits

- Synthetic event ids alone can no longer create a capability draft.
- Invalid or mismatched receipt/artifact facts fail closed in both Memory and
  SQLite stores.
- Raw outcome or artifact content is not retained by the capability registry.
- The executable task and outcome are local synthetic fixtures using production
  persistence and Relay paths. They are not an external real-user task, expert
  demonstration, second-machine result, public deployment or market evidence.
- ADR-008 v1 remains unsigned. Full-document replacement with recomputed hashes
  is outside its threat model until issuer signing and trusted timestamps exist.
