# P1 Desktop read-attestation dispatch report

- Date: 2026-10-07
- Implementation commit: `78e85d510c45a5ea7177ae4830f6d47d86a10e9e`
- Evidence commit: `c38df93ea657d885e9e71bf3cff26ad0acdd7751`
- Evidence root: `179dec0d2baba65d38535e53d5374628579546230cb4e0a866f706a498bb8008`
- Previous evidence root: `2363ed3842765365f43ba88bb13a00cee7c9c743c2f656c06777777257bd8151`

## Outcome

Desktop Start Work can now author the only enabled production execution plan,
`fs.read.attest.v1`, without treating natural-language work as a file selector.
The operator must explicitly provide one safe workspace-relative path, a byte
ceiling, and an opaque one-use grant reference. Only an online Node that
advertises `fs.read` can be selected.

Before confirmation, the review surface shows the exact path, maximum bytes,
grant reference, and no-content-return promise. Confirmation freezes the plan
and grant reference into one `TaskEnvelope`. The existing SQLite Fleet outbox
deep-validates that shape, commits it before network I/O, and replays identical
canonical bytes after response loss or process restart.

## Verification

- Shared Fleet contract: 65 assertions and 46 negative cases.
- Focused React form and review: 2 files, 20 tests.
- Focused Desktop outbox validation/integration: 2 files, 6 tests.
- Complete Desktop outbox gate: 5 files, 37 tests, plus one abrupt-process-kill recovery test.
- Root unit suite: 110 files, 735 tests.
- Root UI suite: 23 files, 96 tests.
- Typecheck and production build passed. The build retains the pre-existing
  large-chunk warning only.

The first attempted full build exposed a browser boundary regression caused by
a production import from the contracts package aggregate entry point, which
also exports Node-only crypto validators. The import was removed; browser code
keeps its local form validation, Desktop outbox independently deep-validates the
payload, Relay remains the shared contract authority, and the full build then
passed.

## Evidence

- Directory: `evidence/round-p1-desktop-read-dispatch/`
- `gate.json` SHA-256: `842bf8b97bd491d5a6debff8f3542b7f0fe1ea5b5da890f64b261a481e6a1c25`
- `gate.json` bytes: 7910
- Manifest root: `179dec0d2baba65d38535e53d5374628579546230cb4e0a866f706a498bb8008`

## Boundaries

- The one-use grant must still be provisioned offline. Desktop accepts only its
  opaque reference and never asks for or stores the plaintext token.
- This is local React and Desktop SQLite evidence, not a packaged second-device
  or external-network acceptance test.
- The actual read still requires the previously verified Relay/Node path,
  human approval, and matching durable task grant.
- General model, CLI, shell, network, write, spend, delete, and privilege
  execution remain disabled.
- No push, deployment, production database, certificate, firewall, payment, or
  `F:\agent-hub` change was performed.

## Next slice

Replace the offline-only task-grant bootstrap with a narrowly scoped issuance
and one-time delivery protocol that never exposes the token to the renderer or
stores plaintext at rest. It must preserve human approval, durable exhaustion,
node/task/path binding, crash safety, and explicit operator recovery. Until
that protocol is sealed, the UI must continue to label grant references as
pre-provisioned and fail closed when authority is missing.
