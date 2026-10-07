# Local internal-test stack

`hummer-local-stack` supervises the existing Relay, Node Agent, and optionally
the Electron Desktop as one local Windows process group. It adds no executor:
the only production action remains `fs.read.attest.v1`.

## One-time configuration

Create a JSON file outside the repository. It contains identity and paths but
no bearer tokens or issuer secret:

```json
{
  "schema": "hummer.local-stack-config",
  "version": 1,
  "stateRoot": "C:\\Users\\you\\AppData\\Local\\HUMMER\\local-stack",
  "workspaceRoot": "C:\\Users\\you\\HUMMER\\workspace",
  "tenantId": "tenant-from-existing-desktop",
  "actorRef": "account:account-from-existing-desktop",
  "nodeId": "node-local-1",
  "runtime": { "provider": "codex" },
  "launchDesktop": true
}
```

`tenantId` and `actorRef` must exactly match the Desktop identity already in
the selected Desktop data directory. The supervisor does not forge, migrate, or
guess a Desktop identity. A mismatch remains fail-closed at the Desktop bridge.
Set `launchDesktop` to `false` for a headless Relay/Node host.

The `stateRoot` must be empty on first use. HUMMER claims it with an ownership
marker and thereafter writes only its local Fleet database, task-grant
authority, Node journal, receipts, redaction-safe status, and immutable run
folders. `workspaceRoot` is separate and is the only tree the bounded read
attestation executor can inspect.

## Build and run

From the source checkout, the one-command build-and-run path is:

```powershell
npm run local:stack -- run --config C:\absolute\hummer-local-stack.json
```

After the Relay and Desktop outputs have been built once, the Windows shim can
be used directly:

```powershell
.\hummer-local-stack.cmd run --config C:\absolute\hummer-local-stack.json
.\hummer-local-stack.cmd status --config C:\absolute\hummer-local-stack.json
.\hummer-local-stack.cmd stop --config C:\absolute\hummer-local-stack.json
```

`run` stays in the foreground. It generates fresh control, node, and issuer
secrets in memory; config files contain environment-variable names only. Relay
consumes all three inputs, Node consumes its badge, and Desktop consumes its
control badge. The supervisor exposes status/stop through a local named pipe,
not an HTTP administration port. `stop` asks Desktop to quit through stdin,
then closes Node, Relay, and both SQLite stores before archiving the run state.

## Boundaries

- loopback HTTP only; this is not TLS or remote deployment evidence;
- one existing Desktop account/tenant binding per config;
- eight-hour ephemeral badge window, requiring a stack restart after expiry;
- generated plaintext credentials are never written to config, state, logs,
  SQLite, journal, receipts, or status;
- true second-device installation, production IdP/KMS, code signing, and
  external-user evidence remain separate acceptance gates.
