# HUMMER Relay daemon

`hummer-relay` is the local, persistent Relay entrypoint. It starts the same
`SQLiteFleetStore`, `FleetService`, shared contract validators, and Fastify
transport used by the Relay package tests and product integrations.

Build the standalone JavaScript output before running from a source checkout:

```powershell
npm run build:cli -w @hummer/relay
hummer-relay start --config C:\absolute\path\relay.json
```

If the package bin is not linked in the current checkout, the equivalent local
invocation is:

```powershell
node apps/relay/bin/hummer-relay.mjs start --config C:\absolute\path\relay.json
```

The configuration is strict. Unknown fields, unsupported versions, relative
database paths, and non-loopback bind addresses are rejected before opening the
database or listening. Badge and task-grant issuer secrets never appear in this
file; each named environment value is read once and deleted immediately.

```json
{
  "schema": "hummer.relay-config",
  "version": 3,
  "host": "127.0.0.1",
  "port": 4317,
  "databasePath": "C:\\HUMMER\\relay\\fleet.sqlite",
  "taskGrantDatabasePath": "C:\\HUMMER\\relay\\task-grants.sqlite",
  "taskGrantIssuerSecretEnv": "HUMMER_TASK_GRANT_ISSUER_SECRET",
  "badges": [
    {
      "tokenEnv": "HUMMER_RELAY_CONTROL_TOKEN",
      "tokenId": "local-control-v1",
      "tenantId": "tenant-local",
      "actorRef": "human:operator",
      "scopes": ["node.read", "task.read", "task.enqueue", "task.stop", "approval.read", "approval.decide"],
      "expiresAt": "2027-01-01T00:00:00.000Z"
    }
  ]
}
```

The task-grant database is separate from the fleet database and stores only
digest-bearing, redaction-safe grant records. After a bound human approval,
the target node requests a task token from Relay. Relay derives the token with
HMAC-SHA-256 from the issuer secret and immutable task binding, commits only its
SHA-256 digest, then returns the plaintext over the authenticated node
connection. Reissuing the same binding after restart derives the same token but
never rolls `usedCount`, revocation, expiry, or exhaustion backward.

Offline import remains an operator recovery/compatibility path, not the normal
Desktop dispatch path:

```powershell
hummer-relay grant-import --config C:\absolute\relay.json --snapshot C:\absolute\task-grants.json
```

Importing the same immutable grant is idempotent and never rolls durable
`usedCount`, revocation, expiry, or exhaustion backward. A conflicting digest
or binding fails closed. Relay opens this database as the production
task-grant authority, so a successful consume is committed before HTTP 200 and
survives process restart.

On readiness stdout contains exactly one redaction-safe JSON record with the
listening address, schema/version, and a one-way reference to the configured
database path. Badge values, issuer secrets, task tokens, and their
fingerprints are never printed. Startup
errors are JSON on stderr and return a non-zero exit code. `SIGINT` and
`SIGTERM` close the Fastify listener and SQLite store before normal exit on
platforms where Node delivers those signals to JavaScript.
