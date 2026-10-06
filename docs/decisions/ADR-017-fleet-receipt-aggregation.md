# ADR-017: Fleet receipts extend, rather than replace, the v1 outcome receipt

- Status: Accepted for Phase 0
- Date: 2026-10-07
- Milestone: D5 / AC-P0-07

## Context

ADR-008 defines the independently verifiable v1 outcome receipt for one work order. A fleet run adds child work orders, multiple nodes, and artifacts produced outside the parent process. Replacing the v1 envelope would break existing verification and migration paths; recording only child IDs would not prove which receipt bytes and artifact bytes were aggregated.

## Decision

1. The parent remains a valid `hummer.outcome-receipt` version 1 document. Fleet data is an optional, strict `fleet` extension.
2. The extension records `parentWorkOrderId`, participating nodes, child receipt references, the reported chain head, and a fleet manifest.
3. Every child reference binds the child WorkOrder ID to the SHA-256 of its receipt file, the child's verified v1 root hash, its node/runtime identity, and at least one artifact reference.
4. Every artifact reference binds a stable artifact ID, portable relative path, `mediaType`, `bytes`, and SHA-256. The byte length and digest are checked against the referenced file. The digest, byte length, and media type must also match a completed tool evidence record inside that child's independently verified v1 receipt: its `evidenceRefs` contains `evidence://sha256/<digest>` and its manifest-covered result describes the same digest, `sizeBytes` (or `bytes`), and `mediaType`. A filename or extension is never provenance. Absolute paths, traversal, backslashes, missing files, and symlink escapes fail closed.
5. Runtime labels use the frozen `RuntimeKind` vocabulary: `codex`, `claude`, `deepseek`, `cli-other`, and `gui-exec`.
6. The fleet manifest hashes the nodes, child receipt fields, artifact fields, and chain-head fields into a deterministic root. Each child is also verified independently with the v1 verifier; a matching file hash alone is insufficient.
7. The chain head is evidence supplied by the run. Phase 0 does not claim that it is signed or externally timestamped.
8. Unknown fields are rejected. Adding or relaxing fleet fields requires another ADR and negative tests.

## Consequences

- Existing single-work-order receipts keep their original schema and verification path.
- A fleet receipt can be checked offline from a self-contained directory.
- The extra child and artifact bindings are stricter than the minimal wire example because they close substitution and provenance gaps. Existing v1 receipts and the v1 verifier are unchanged; only receipts using the optional fleet extension must supply the additional evidence metadata.
- Phase 0 fixtures are synthetic evidence; they do not prove a real two-machine run.

## Verification

`node scripts/test-fleet-receipt.mjs` covers one positive scenario and fifteen fail-closed cases, including a one-byte child mutation, artifact mutation, an unrelated existing artifact with a correct recomputed hash and fleet manifest, incorrect byte length/media type, traversal, missing files, duplicate work orders, unknown fields, and an independently invalid child. `npm run verify:fleet:receipt` verifies the checked-in fixture.
