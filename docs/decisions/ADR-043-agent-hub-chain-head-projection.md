# ADR-043: Agent-hub anchors consume explicit verified JSON, never the HUMMER database

Date: 2026-10-07
Status: Accepted
Scope: W4 chain-head and audit-export offline verification

## Context

ADR-038 exposes a tenant head as
`{device_id,tenant_id,position,hash,at}`. Agent-hub needs to anchor that object in
its own Git/NAS history, but opening or copying HUMMER's live SQLite, WAL, or SHM
files would bypass the application transaction boundary and can observe an
inconsistent state.

Audit export manifests also need an offline consumer that does not trust a
filename, caller-selected tenant, or declared artifact digest by itself.

## Decision

1. `scripts/verify-tenant-export.mjs` accepts exactly one explicit `.json` path
   or `--input -` for stdin. It has no database dependency, discovery mode, or
   fallback path. SQLite/DB/WAL/SHM-like inputs are rejected before reading.
2. Chain heads use a closed schema with exactly five fields. Identifiers,
   positive safe-integer position, lowercase SHA-256, and canonical UTC time are
   validated. The caller must provide the expected tenant and may additionally
   pin device, position, and hash.
3. Projection output is optional and caller-selected. It must be a `.json` file
   under an existing, real, non-symlink directory. A first anchor is created;
   an existing anchor is updated only after its strict schema, device, tenant,
   position, and optional caller-supplied current hash pass compare-and-swap
   checks. Positions may advance only. Exact repeats are idempotent, while
   rollback, same-position forks, identity switches, and metadata drift fail
   closed. The tool uses a cooperative lock and a same-directory temporary file
   followed by rename.
4. Audit manifests use the closed `hummer.audit-export` v1 schema. Verification
   requires the expected manifest SHA-256 from an independent channel and an
   artifacts root. Event positions must be contiguous, the final event hash and
   position must equal the manifest chain head, file paths must be normalized
   and unique, and every actual file's size and SHA-256 must match.
5. Artifact paths cannot be absolute, traverse upward, use backslashes, or
   resolve through a link/alias. A file resolving outside the supplied root is
   rejected.
6. Successful output is machine-readable JSON. Failure returns exit code 1 and
   a generic JSON error without dumping input bytes.
7. The tool does not contain an agent-hub path and tests write only under an OS
   temporary directory. The caller remains responsible for choosing an
   authorized agent-hub report path and committing it through agent-hub policy.

## Evidence

`npm run test:tenant-export` covers:

- file and stdin chain-head verification;
- exact tenant/device/position/hash checks and strict schema rejection;
- database-path confusion, malformed time/hash/position, and unknown fields;
- first-anchor creation, forward CAS update, and exact-repeat idempotence;
- stale expected hash, rollback, fork, device/tenant switch, and malformed
  existing projection rejection;
- audit manifest digest, event range, and chain-head consistency;
- real receipt/result artifact byte verification; and
- foreign tenant, path traversal, missing/drifted artifact, and manifest
  tampering negatives.

## Limits

- The manifest contains event IDs, positions, and hashes, not canonical event
  bodies or tenant previous hashes. The verifier can prove range continuity and
  agreement with an externally supplied manifest digest/head, but cannot
  independently recompute the tenant event hashes from event bodies.
- Receipt files are byte-hash verified as declared artifacts. Their semantic
  signature/schema remains the responsibility of `scripts/verify-receipt.mjs`;
  this tool does not duplicate that verifier.
- Atomic replacement depends on all HUMMER verifier writers respecting the
  adjacent cooperative lock. A non-cooperating process with direct filesystem
  access remains outside this tool's trust boundary; the verifier re-reads the
  current projection immediately before rename to detect observed drift.
