# Fleet receipt verification runbook

Status: Phase 0 verification slice. The checked-in fixture is synthetic; it does not claim a real multi-device run.

## Boundary

HUMMER continues to own outcome receipts. A fleet receipt is still a `hummer.outcome-receipt` version 1 document. Its original `receipt`, `domainEvents`, and top-level `manifest` retain the complete ADR-008 meaning and remain verifiable by `scripts/verify-receipt.mjs`.

Fleet aggregation adds one optional top-level `fleet` segment. The legacy verifier intentionally ignores that segment and continues to validate the original version 1 content. `scripts/verify-fleet-receipt.mjs` first invokes the legacy verifier, then validates the fleet segment, each child receipt, and every referenced artifact. It uses only Node.js built-in modules and does not read a database or contact a relay.

## Fleet segment

The envelope and every object owned by the fleet extension reject unknown fields. Required fleet data is:

- `parentWorkOrderId`: must equal the parent receipt outcome WorkOrder ID.
- `nodes`: unique node IDs with runtime, agent version, and declared artifact IDs.
- `childReceipts`: unique child WorkOrder IDs and paths, file SHA-256, original version 1 receipt root hash, node/agent/runtime provenance, completion time, and artifact references.
- `chainHead`: tenant, node, position, hash, and time. This records the supplied head; Phase 0 does not claim a signed or externally anchored timestamp.
- `manifest`: SHA-256 leaf hashes and a root hash over all four structures above. This makes the parent aggregation cover every child and artifact reference without changing the original version 1 manifest.

Allowed runtime labels match the frozen fleet contract: `codex`, `claude`, `deepseek`, `cli-other`, and `gui-exec`. Paths use portable `/` separators, must be relative to the parent receipt directory, and must resolve inside that directory. Absolute paths, `..`, Windows drive prefixes, backslashes, missing files, and symlink escapes fail closed.

For each child, the verifier checks:

1. The child file bytes match `receiptSha256`.
2. The existing standalone version 1 verifier exits 0.
3. The child's original manifest root equals `receiptRootHash`.
4. The child outcome WorkOrder and tenant match the parent reference.
5. Node runtime and agent version match the node declaration.
6. Every declared artifact is referenced exactly once and its current bytes match its SHA-256.

## Operator commands

Run from the HUMMER repository worktree:

```powershell
node scripts/verify-receipt.mjs spikes/p0-fleet-receipt/fleet-receipt.json
node scripts/verify-fleet-receipt.mjs spikes/p0-fleet-receipt/fleet-receipt.json
node scripts/test-fleet-receipt.mjs
```

Success prints one JSON object and exits 0. Failure prints one JSON object containing `valid: false`, the first failing JSON Pointer in `field`, and a safe reason, then exits 1. Do not treat a visible result or an agent message as execution evidence when either verifier fails.

The focused test has one positive case and twelve negative cases: one-byte child mutation, wrong child file hash, a changed child reference caught by the parent aggregate manifest, missing child, duplicate child, path traversal, unknown field, artifact mutation, missing artifact provenance, child root mismatch, independently invalid child with a refreshed file hash, and an unknown envelope field.

## Artifact collection

For a real run, place the parent receipt, child receipts, and referenced artifact files under one device-scoped delivery directory before verification:

```text
F:\AgentWorkspace\20_Outputs\hummer\<device_id>\
  receipts\
    <parent-receipt>.json
    children\
      <child-receipt>.json
  artifacts\
    <deliverable files>
```

The relative paths inside the parent receipt must match that exported directory layout. Keep databases, runtime session stores, credentials, API keys, access tokens, raw customer records, and unredacted diagnostic data out of Git and out of the receipt directory.

After the real producer exists, archive the verifier JSON output and its SHA-256 as round evidence. This slice deliberately does not manufacture `evidence/round-d5` or claim AC-P0-08 from the synthetic fixture.

## Security limit

As with ADR-008, hashes prove internal consistency and reveal post-export byte changes. They do not authenticate the issuer, provide non-repudiation, or establish a trusted time. Signing, key rotation/revocation, and an external transparency anchor remain later work.
