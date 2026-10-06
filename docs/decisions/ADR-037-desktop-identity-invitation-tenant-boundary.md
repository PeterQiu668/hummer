# ADR-037: Desktop identity creation and invitation acceptance fail closed

Date: 2026-10-07
Status: Accepted
Scope: W4 P0 identity and session tenant-boundary containment

## Context

ADR-002 made an opaque local session token authoritative for the current tenant
and allowed one account to hold memberships in multiple tenants. The original
account helper nevertheless reused an existing account whenever `createCompany`
received its email or phone. Because company creation also issued a fresh
session, knowing an existing contact was enough to obtain that account, list all
of its tenant memberships, and switch into them.

Invitation acceptance had a second identity-confusion path. It verified the
invitation's selected contact, but account lookup always preferred a supplied
email. A phone invitation could therefore be accepted with the correct invited
phone plus an unrelated existing account's email, issuing a session for the
unrelated account and adding that account to the invitation tenant.

Invitation failures also distinguished unknown/replayed, expired, and
wrong-contact tokens. Those differences were unnecessary existence signals at
the bearer-token boundary.

## Decision

1. `createCompany` creates a new account only. A normalized email or phone that
   is already assigned fails with the generic `Identity is unavailable` result.
   Existing accounts join another tenant only through an invitation addressed
   to their existing contact.
2. Invitation acceptance resolves an existing account using the invitation's
   own contact type and normalized value, never another optional contact.
3. If no account owns the invited contact, any other supplied contact that is
   already assigned causes a generic rejection. If the invited contact already
   owns an account, every supplied contact must agree with that same account.
   No account fields are overwritten during acceptance.
4. An existing membership in the invitation tenant, active or inactive, is
   rejected before inserts. The final invitation transition is conditional on
   `(id, tenant_id, status = pending)` and the surrounding transaction rolls
   back unless exactly one row changes.
5. Unknown, replayed, expired, wrong-contact, account-collision, and existing-
   membership invitation attempts all return `Invitation is invalid or
   unavailable`. They do not reveal invitation state or tenant ownership.
6. Session switching remains per opaque token. It first proves that the token's
   account has an active membership in the requested tenant, then updates only
   the authenticated session row. Switching one session does not mutate another
   session for the same account.
7. `listMembers`, `resolveActor`, `listActiveTwins`, and `createTwinForHuman`
   continue deriving the tenant from the authenticated session and retaining
   their SQL tenant predicates. Foreign and unknown human/actor references have
   identical empty or generic outcomes.
8. No role expansion or schema migration is part of this containment change.

## Evidence

The stable `[TEN-P0G-IDENTITY-BOUNDARY]` suite uses real SQLite state and proves:

- normalized email and phone reuse cannot mint a second session for an existing
  account;
- an invitation can intentionally add one account to a second tenant, while
  separate session tokens switch independently;
- a foreign or unknown tenant switch has the same failure and does not change
  the session's current tenant;
- the former phone-invitation/email-collision path cannot add or authenticate
  the unrelated account;
- wrong-contact, expired, replayed, and unknown invitations are
  indistinguishable and do not add members;
- member role cannot issue invitations; and
- member lists, actor resolution, twin reads/writes, unknown session tokens,
  and expired session tokens remain fail closed across two tenants.

## Consequences and limits

- An invitation token remains a high-entropy bearer capability delivered out of
  band to the invited contact. This local implementation still does not prove
  inbox/SMS ownership, provide MFA, remotely revoke sessions, or replace a
  production identity provider.
- An existing account's display name and contacts are not updated from
  invitation input. Account profile changes require a separate authenticated
  flow.
- Global account contact uniqueness and the existing v3 tables remain
  unchanged. Auditor/operator roles, tenant lifecycle, quotas, and per-tenant
  chains remain outside this P0 fix.
