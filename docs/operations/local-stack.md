# Local internal-test stack

`hummer-local-stack` supervises the existing Relay, Node Agent, and optionally
the Electron Desktop as one local Windows process group. It adds no executor:
the only production action remains `fs.read.attest.v1`.

## One-time configuration

Create a JSON file outside the repository. The default Desktop mode contains
paths and runtime selection but no identity, bearer token, or issuer secret:

```json
{
  "schema": "hummer.local-stack-config",
  "version": 2,
  "stateRoot": "C:\\Users\\you\\AppData\\Local\\HUMMER\\local-stack",
  "workspaceRoot": "C:\\Users\\you\\HUMMER\\workspace",
  "identity": { "mode": "desktop-claim" },
  "nodeId": "node-local-1",
  "runtime": { "provider": "codex" },
  "launchDesktop": true
}
```

On first run the supervisor opens Desktop in `waiting_for_identity`. After the
operator creates or resumes a Desktop session, Desktop main resolves the
authoritative tenant/account from its own persistence store and claims the
stack through an authenticated local named pipe. Relay and Node start only
after that claim. The renderer never receives the claim token or Relay badge.

For a headless Relay/Node host, use explicit identity mode:

```json
"identity": {
  "mode": "explicit",
  "tenantId": "tenant-provisioned-by-the-operator",
  "actorRef": "account:account-provisioned-by-the-operator"
}
```

Version 1 explicit configs remain accepted for compatibility. Automated or
externally launched Desktop tests may name `identity.claimTokenEnv`; the value
is consumed from the supervisor environment and never written to config.

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

`run` stays in the foreground. It generates a fresh identity-claim token and
fresh control, node, and issuer secrets in memory. Desktop consumes the claim
token, Relay consumes its three inputs, Node consumes its badge, and Desktop
main receives the control badge only through the authenticated pipe. The
supervisor exposes status/stop through that local pipe, not an HTTP
administration port. `stop` asks Desktop to quit through stdin, then closes
Node, Relay, and both SQLite stores before archiving the run state.

## Boundaries

- loopback HTTP only; this is not TLS or remote deployment evidence;
- one Desktop account/tenant binding per running stack; switching to another
  identity requires a stack restart;
- eight-hour ephemeral badge window, requiring a stack restart after expiry;
- generated plaintext credentials are never written to config, state, logs,
  SQLite, journal, receipts, or status;
- true second-device installation, production IdP/KMS, code signing, and
  external-user evidence remain separate acceptance gates.
