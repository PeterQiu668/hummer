# ADR-008: Self-contained outcome receipt verification boundary

- Status: Accepted for internal delivery
- Date: 2026-09-11
- Milestone: M5-C P1.2

## Context

The existing outcome receipt reported `chainIntegrity.valid`, but a third party could not recompute that claim without HUMMER or its SQLite database. M5-C requires a portable JSON receipt and an independent verifier that identifies the exact modified field.

The current domain event ledger is one global hash chain. Exporting every event would leak another tenant's payload, while omitting a foreign event would break the chain between two events belonging to the receipt tenant.

## Decision

1. `hummer.outcome-receipt` version 1 contains the canonical outcome receipt, a domain-event proof, and a SHA-256 manifest.
2. Events belonging to the receipt tenant are exported with their canonical event bodies. Foreign-tenant events are represented only as opaque chain anchors containing position, previous hash, and hash.
3. The manifest hashes every JSON leaf and the complete receipt/proof body. The standalone `scripts/verify-receipt.mjs` verifies leaf hashes, root hash, chain links, canonical event payloads, and domain-event hashes.
4. Verification failures report the first differing JSON Pointer. The verifier has no dependency on HUMMER, Electron, or SQLite.
5. The export endpoint is authenticated and tenant-scoped. A tenant can export only its own outcome receipt.

## Security boundary

This format proves internal content consistency and detects accidental or unsophisticated post-export modification. Version 1 is not digitally signed and has no trusted timestamp. An attacker able to rewrite the entire document can recompute its hashes, so it does not establish issuer authenticity or non-repudiation.

Production use by an insurer or external auditor therefore remains gated on an organization signing key, key rotation and revocation rules, and a trusted timestamp or external transparency log. The global-chain opaque anchors also reveal event positions and continuity metadata; a future per-tenant chain head should remove that residual metadata exposure.

## Evidence

- `apps/desktop/src/persistence/verifiable-receipt.test.ts` covers valid export, exact-field tamper detection, and foreign-tenant payload exclusion.
- `scripts/e2e-desktop-outcome-receipt.mjs` creates and exports a receipt through the real Electron persistence host, verifies it in a standalone Node process, tampers with the verdict, and checks that verification identifies `/receipt/outcome/verdict`.
- `spikes/m5a-outcome-ledger/verifiable-outcome-receipt.json` is local product-chain evidence. It is not evidence of an external model invocation or third-party delivery.
