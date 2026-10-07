# ADR-074: Desktop claims local-stack identity after authenticated login

## Status

Accepted on 2026-10-07. This extends ADR-073.

## Context

The first supervisor required operators to copy `tenantId` and `actorRef` into
a config before launching Desktop. That preserved identity safety but failed
the 15-minute onboarding goal and encouraged reading Desktop SQLite from an
external script. The supervisor must not guess, create, or directly inspect a
Desktop identity, and the renderer must never receive Relay credentials.

## Decision

1. Local-stack config v2 supports `identity.mode = "desktop-claim"` and omits
   tenant/account identifiers. Version 1 explicit configs remain accepted.
2. The supervisor starts in `waiting_for_identity`, creates an in-memory claim
   token, and launches Desktop with only the local pipe name and claim token.
3. Desktop main consumes and deletes both environment entries. After a company
   is created, a session resumes, or a tenant switches, the persistence host
   resolves the authoritative tenant/account from the session token.
4. Desktop main sends only that resolved identity plus the claim token through
   the named pipe. Relay and Node do not start before the authenticated claim.
5. The supervisor returns the control badge only to Desktop main. The existing
   Relay host accepts exactly one late configuration and remains immutable
   afterward; a different second identity fails closed.
6. Bad claim tokens, guessed identities, response identity drift, unknown
   fields, remote pipe names, and secret-echoing errors are rejected. Claim
   failures never invalidate the already-created Desktop identity.

## Consequences

- A fresh Desktop can create its own company and bring Relay/Node online without
  prefilled tenant/account values.
- Renderer storage contains the Desktop session only; claim and Relay tokens
  stay in main/supervisor memory and are scanned out of persisted test bytes.
- One running stack remains bound to one identity. Tenant switching to a
  different identity requires a deliberate stack restart.
- This is still local loopback bootstrap, not remote IdP, TLS, KMS, or a signed
  installer claim protocol.
