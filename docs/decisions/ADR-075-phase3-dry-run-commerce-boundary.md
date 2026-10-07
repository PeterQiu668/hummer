# ADR-075: Phase 3 commerce remains claim-verified and dry-run only

## Status

Accepted on 2026-10-07 for local technical preparation. Real payment remains
unapproved L3 work.

## Context

The public capability marketplace stops deliberately at read-only listings,
install authorization, reporting, and human takedown. The target specification
also requires an author claim lifecycle, price and order objects, and a
reconciling settlement ledger. It explicitly forbids real collection,
custody, splitting, invoicing, or payment-provider integration before a
separate owner and legal decision.

An unverified author string cannot become an operational ownership fact, and a
price field must not imply that money moved. Reusing install authorization as
a purchase decision would also blur two distinct approvals.

## Decision

1. Migration v17 adds append-oriented author claims, dry-run offers, orders,
   settlements, and double-entry ledger rows. Migrations v1-v16 remain
   byte-identical.
2. A source-tenant human declares a claim against an exact verified public
   listing. A separate marketplace moderator verifies it from a SHA-256
   evidence digest. The claimant may revoke it; revoked claims never reactivate.
3. Only a currently verified claim may create one active CNY offer. Prices are
   positive integer cents. Withdrawing an offer is terminal.
4. An order can be placed only by a tenant-member human, against an approved
   install attempt for the same listing and target tenant. Its mode is always
   `dry_run`; amount and currency must exactly match the active offer.
5. Settlement is a local simulation initiated by the verified claimant. One
   immutable debit and one immutable credit must match the order amount and
   sum to zero. Reconciliation reads persisted rows rather than trusting the
   caller.
6. No API accepts card, bank, wallet, invoice, payout, provider, webhook, or
   payment credential fields. Unknown fields fail closed at the HTTP boundary.
7. No payment SDK or network integration is added. The UI and reports must use
   “dry-run” or “simulation” language and must never state that a payment was
   collected or an author was paid.

## Consequences

- AC-P3-01 through AC-P3-03 can receive local executable evidence without
  crossing the payment red line.
- Claims, offers, orders, settlements, and ledger entries are audit history;
  deletion requires a separately approved workflow.
- AC-P3-04 remains a decision gate: the compliance material can be prepared
  and delivered, but real payment or public launch still requires explicit L3
  approval and legal review.
