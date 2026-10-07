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

## Sealed evidence

- feature commit: `cf66aefa0ddcb41aec36b5795e30914c84d3c190`;
- evidence round: `evidence/round-p1-local-stack-supervisor/`;
- root hash: `f12897dd70173ea9c2f56f168f792e12696165815ce716aed4f63d9ee692465b`;
- predecessor root: `7e1fab5a56d7a7b47948b07c9c6e9cb01ece0f868532c371f9176461886da47a`;
- six captured commands exited `0`; seal verification passed all nine
  assertions and both negative tamper cases.

## Honest boundary

ADR-074 adds a safe first-run identity claim: the v2 config omits tenant/account,
Desktop creates or resumes its own identity, and Relay/Node start only after
Desktop main authenticates that identity through the local pipe. The slice is
still single-host loopback only and is not production TLS/IdP, a signed
installer, or two-device evidence.
