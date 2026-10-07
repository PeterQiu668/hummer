# P1 local stack supervisor report

## Outcome

HUMMER now has a source-checkout internal-test launcher that starts the real
Relay and Node in one foreground supervisor and can launch the existing
Electron Desktop with the exact same Relay identity. Live status and
coordinated stop use a local named pipe rather than a new network endpoint.

## Security result

The persistent config contains only non-secret identity and absolute paths.
Every run generates fresh control, node, and issuer credentials in memory.
Existing bootstrap consumers remove their environment entries; the supervisor
writes only redaction-safe hashes and process metadata. A second live
supervisor is rejected, stale ownership is preserved as an archived run, and
the Node still exposes only `fs.read.attest.v1`.

## Honest boundary

The config must name an existing Desktop tenant and account actor. HUMMER does
not yet have a safe first-run identity claim protocol, so this is one-command
startup after one-time non-secret configuration, not zero-configuration
onboarding. The slice is single-host loopback only and is not production
TLS/IdP, a signed installer, or two-device evidence.
