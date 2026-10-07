# P1 Relay-issued task grant report

## Outcome

The primary Desktop-to-Node read-attestation path no longer depends on an
operator pre-provisioning or copying a one-use task token. Desktop freezes a
deterministic public grant reference into the reviewed `TaskEnvelope`; after a
human approves the exact scope, Relay issues the bound token directly to the
target node and persists only its digest.

## Safety boundary

- no approval, no token;
- wrong node badge, no token;
- token scope is copied from the persisted decision, never from node input;
- expiry is the earlier of task and approved-scope expiry;
- plaintext exists only in Relay memory/HTTP response and Node execution
  memory, and is sent only to consume/checkpoint routes;
- one successful consume exhausts the durable row;
- restart re-derivation returns the same token without resetting state;
- Desktop, config JSON, logs, journal, receipt, Fleet SQLite, task-grant SQLite,
  and evidence contain neither issuer secret nor plaintext token.

## Operator change

Relay config migrates from version 2 to version 3 and requires
`taskGrantIssuerSecretEnv`. Provide a separate high-entropy secret in that
environment variable at Relay startup. Desktop users now provide only a safe
workspace-relative path and byte limit. `grant-import` remains available for
recovery and backward compatibility.

## Remaining limits

This is an internal-test loopback implementation. It does not yet prove remote
TLS, IdP-backed node identity, HSM/KMS custody, safe issuer-key rotation, or a
packaged two-device run.
