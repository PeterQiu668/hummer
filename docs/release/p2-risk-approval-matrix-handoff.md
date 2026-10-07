# P2 strict risk approval matrix handoff

Baseline: `cbac3f4c67e8c64d7e0e5e16fd79a78a53cf8e90`

## Closed gap

The Start Work review surface now consumes one exhaustive presentation map keyed by the existing `RiskClass` contract union. It renders an explicit seven-row approval matrix and, for every plan step, labels the execution target/runtime, risk class, and estimated cost before a human can confirm.

The production `StartWorkFlow` remains the only transition to the production `RemoteRelayClient`. The focused matrix proves:

- `egress`, `write`, `spend`, `delete`, `privilege`, and `network` enqueue nothing before the named human clicks confirm, then submit exactly one pending task;
- `unknown` displays the same context but cannot be confirmed and requires clarification;
- a new or unrecognized risk string fails plan validation before any decision callback or Relay call;
- no runtime execution surface is attached to the review flow.

Run the machine-readable gate with:

```powershell
npm run test:risk-approval-matrix
```

## Boundaries

- No shared contract schema or public IPC shape changed.
- The focused gate uses synthetic plans and the production React/Remote Relay client path with a stubbed HTTP response. The separate `test:web-e2e` gate remains the proof for the real loopback Fastify Relay.
- No Node agent is attached, so this is not two-machine, external Relay, production identity, or real-user evidence.
- No deployment, push, external service, or real user data is involved.
