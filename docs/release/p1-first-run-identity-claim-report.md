# P1 first-run Desktop identity claim report

## Outcome

A fresh HUMMER Desktop no longer needs copied tenant/account identifiers before
starting the local internal-test stack. Local-stack config v2 enters
`waiting_for_identity`; after the user creates or resumes a Desktop identity,
Desktop main claims the stack and the real Relay and Node start under that exact
tenant/account binding.

## Trust boundary

- renderer sends only its existing Desktop session token to trusted main IPC;
- Desktop persistence resolves tenant/account and never exports the session to
  the supervisor;
- an in-memory claim token authenticates the local named-pipe claim and is
  deleted from the Desktop environment immediately;
- the Relay control badge returns only to Desktop main and late configuration
  is immutable;
- bad tokens, conflicting identities, drifted responses, unknown fields, and
  secret-echoing errors fail closed.

## Verification before sealing

- Desktop claim/Relay bridge/lifetime tests: 18/18;
- real supervisor start/status/claim/stop/restart: 64 assertions;
- fresh real Electron UI creates a company without prefilled identifiers,
  automatically starts Relay/Node, lists the online node, and passes 62
  assertions including recursive secret scanning;
- the Electron onboarding gate used a version-only Codex 0.153.4 test probe;
  this proves identity onboarding, not a real Codex task execution.

## Sealed evidence

- feature commit: `d490eb2a8a94c381999c53fdf5c05b87a9de2a43`;
- evidence round: `evidence/round-p1-first-run-identity-claim/`;
- root hash: `1230b210d00fcd5026830f6c5d6753fc1eafd12cdbae1731d8fa4a48264b4b11`;
- predecessor root: `f12897dd70173ea9c2f56f168f792e12696165815ce716aed4f63d9ee692465b`;
- eight captured commands exited `0`: 18 focused Desktop tests, 64 local-stack
  assertions, 62 fresh-Electron assertions, 209 Relay tests, 746 root unit
  tests, and 96 UI tests, plus typecheck and production build;
- the gate contains no generated plaintext claim/control/node/issuer bearer
  pattern; seal verification passed 9 assertions and 2 tamper cases.

## Remaining limits

The stack is still single-host loopback. A different tenant/account requires a
restart, and production TLS, IdP/KMS, code signing, clean-machine install, a
second device, and external-user task evidence remain separate gates.
