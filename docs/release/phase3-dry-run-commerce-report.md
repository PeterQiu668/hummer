# Phase 3 dry-run commerce implementation report

Status: local technical preparation complete; real commerce remains prohibited.

## Outcome

HUMMER now supports a narrow, auditable simulation of the marketplace lifecycle without accepting or moving money:

- AC-P3-01: authors can declare and revoke an exact listing claim; a separate human moderator must verify it.
- AC-P3-02: a verified author can create a positive integer CNY offer; a buyer can place an order only after an approved exact install attempt.
- AC-P3-03: dry-run settlement creates one debit and one equal credit, and reconciliation proves a zero balance.
- AC-P3-04: the companion compliance decision pack identifies the owner/legal decisions that remain mandatory before any real commerce work.

## Safety and trust properties

- Schema migration v17 is append-only relative to v1-v16 and uses guarded lifecycle transitions.
- Author self-verification, unverified offers, orders without approved installation, duplicate settlement, wrong-role settlement, unknown fields, and payment credential fields are rejected.
- Commerce routes require tenant-member human badges with purpose-specific scopes.
- A static gate rejects known payment-provider dependencies and payment credential or provider API tokens in production commerce files.
- No payment SDK, external settlement network, custody, payout, invoice, refund, tax, or KYC behavior was added.

## Verification

The targeted domain, persistence, and Relay HTTP suite covers the full simulated lifecycle and negative cases. The final formal evidence round is `evidence/round-p3-dry-run-commerce-rerun-2/` at commit `cf7ec4a0b13b6bc3c6d02c84451b47a9c8280803`, with root hash `0d035b1fae390ec6b424ef181d2ce407f8249a92f227e47b3d65b9446ad98897`.

All eight commands passed:

- typecheck and production build;
- 65 contract assertions with 46 negative cases;
- Phase 3 suite: 3 files and 19 tests, plus 4 static assertions and 21 forbidden-token cases;
- Relay: 22 files and 210 tests;
- root unit: 113 files and 749 tests;
- UI: 23 files and 96 tests;
- dead-control audit.

Two preceding failed rounds are intentionally retained in the same hash chain. The first exposed a stale v16 migration expectation; the second exposed a Windows CLI prebuild hook whose 20-second timeout was below its observed successful duration. Both were fixed before the passing round. The seal verifier passed 9 assertions and 2 tamper cases.

## Remaining boundary

This work does not demonstrate market demand, real author verification, external users, second-machine behavior, production deployment, legal approval, or money movement. Those remain separate L3/external decisions and tests.
