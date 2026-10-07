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
database or listening. Badge bearer values never appear in this file; each
`tokenEnv` is read from the process environment and deleted immediately.

```json
{
  "schema": "hummer.relay-config",
  "version": 1,
  "host": "127.0.0.1",
  "port": 4317,
  "databasePath": "C:\\HUMMER\\relay\\fleet.sqlite",
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

On readiness stdout contains exactly one redaction-safe JSON record with the
listening address, schema/version, and a one-way reference to the configured
database path. Badge values and badge fingerprints are never printed. Startup
errors are JSON on stderr and return a non-zero exit code. `SIGINT` and
`SIGTERM` close the Fastify listener and SQLite store before normal exit on
platforms where Node delivers those signals to JavaScript.
