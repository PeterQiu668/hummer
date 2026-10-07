# Phase 3 dry-run commerce compliance decision pack

Status: prepared for owner and legal decision; not approved for real commerce.

## Decision requested

HUMMER now has a local-only technical simulation for author claims, fixed-price offers, orders, and balanced settlement ledger entries. The implementation never moves money and contains no payment-provider integration. Before any real commerce work starts, the owner and qualified legal, tax, and compliance reviewers must decide the items below.

## Implemented technical boundary

- An author declares a claim against an exact public listing and evidence digest.
- A separate tenant-member human moderator verifies or rejects the claim; the author cannot self-verify.
- Only a verified claim can publish one active positive-integer CNY offer.
- An order can be placed only after an approved install attempt for the same buyer, listing, version, and integrity digest.
- Settlement is always `dry_run` and records one debit plus one equal credit. Reconciliation must be exact and net to zero.
- Claims, offers, orders, settlements, and ledger entries are append-only or tightly transition-guarded in local SQLite.
- Relay access uses separate human badge scopes. Node badges and system actors cannot use the commerce routes.
- Unknown request fields are rejected. Payment credentials and provider fields are not accepted or stored.

## Explicitly not implemented

- Card, bank, wallet, escrow, custody, payout, withdrawal, or provider APIs.
- KYC, KYB, AML, sanctions screening, or beneficial-owner verification.
- Tax calculation, VAT, invoice or fapiao issuance, revenue recognition, or withholding.
- Refund, chargeback, dispute, fraud, reserve, or negative-balance handling.
- Real author identity verification, IP ownership adjudication, or marketplace terms acceptance.
- Production retention schedules, legal hold, privacy deletion workflow, or regulator reporting.
- External deployment, TLS, production identity provider, KMS, observability, or incident response.

## Data inventory for review

| Record | Data stored | Intended purpose | Current location |
| --- | --- | --- | --- |
| Author claim | tenant, actor, listing, version, integrity digest, evidence digest, lifecycle timestamps | bind a simulated seller to an exact artifact | local SQLite |
| Offer | claim, author, exact artifact, integer CNY price, `dry_run` mode, lifecycle timestamps | publish a simulated fixed price | local SQLite |
| Order | buyer, offer, approved install attempt, exact artifact and terms digest, lifecycle timestamps | record simulated purchase intent | local SQLite |
| Settlement | order, gross/debit/credit cents, `dry_run` mode, timestamp | demonstrate balanced accounting logic | local SQLite |
| Ledger entry | settlement, tenant, debit or credit, amount, currency, timestamp | support deterministic reconciliation | local SQLite |

No payment credential, bank account, wallet address, provider token, tax identifier, or identity-document image belongs in these records.

## L3 decisions required before real commerce

1. Operating jurisdiction, contracting entity, customer and author eligibility, and cross-border policy.
2. Marketplace legal classification and whether HUMMER is merchant of record, agent, platform, or software provider.
3. Licensed payment provider and integration model; HUMMER must not hold funds by default.
4. KYC/KYB/AML, sanctions, fraud, age, and beneficial-owner controls.
5. Tax, VAT, invoice/fapiao, withholding, accounting, and revenue-recognition treatment.
6. Marketplace terms, author warranties, IP takedown, prohibited goods, moderation, and appeal process.
7. Refund, cancellation, chargeback, dispute, reserve, insolvency, and negative-balance policy.
8. Privacy basis, retention, deletion, legal hold, data residency, breach response, and audit access.
9. Real author-verification evidence, reviewer independence, re-verification cadence, and revocation consequences.
10. Production security architecture, provider secrets, TLS, IdP, KMS, segregation of duties, monitoring, and incident response.

## Release gate

Real payment work remains prohibited until every decision above has a named owner, written approval, acceptance criteria, and a new implementation plan. Passing the local Phase 3 gate is evidence of software mechanics only; it is not legal, tax, compliance, security, or launch approval.
