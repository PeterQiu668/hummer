# P1 Node badge-only bootstrap report

## Outcome

The Node daemon no longer requires a preconfigured per-task token. Config
version 4 has one credential input: the node badge environment variable. A
grant-bound task cannot execute unless Relay exposes the approved issuance
route and returns a token whose reference and expiry match the execution.

## What changed

- removed `grantTokenEnv` from strict Node config and credential loading;
- generated the existing local scope guard in process memory rather than from
  operator input;
- removed the Node Agent's static task-token fallback;
- added a fail-closed negative test for a transport without issuance;
- updated real daemon and read-attestation integrations to badge-only startup.

## Security result

Missing or outdated issuer wiring now blocks execution instead of silently
using an environment token. The process-local guard is never emitted as an
HTTP task-grant header. Only the Relay-issued task bearer reaches consume and
checkpoint routes, and existing digest-only persistence and one-use exhaustion
remain unchanged.

## Sealed evidence

- feature commit: `df23c4a53da914c390a2159827e7abd74a4d6e37`;
- evidence round: `evidence/round-p1-node-badge-only-bootstrap/`;
- root hash: `7e1fab5a56d7a7b47948b07c9c6e9cb01ece0f868532c371f9176461886da47a`;
- predecessor root: `6255952e82df5338f353cd825fe87ec1482c5816223c84e8a5c0bcb7ce6b82e0`;
- seven captured commands exited `0`; seal verification passed all nine
  assertions and both negative tamper cases.

## Remaining limits

The local safety envelope still uses configured `grantExpiresAt` and
`grantScopes`. Relay/node badges and Relay issuer-secret custody are still
bootstrap mechanisms rather than production IdP/KMS integration. Remote TLS
and two-device packaged evidence remain pending.
