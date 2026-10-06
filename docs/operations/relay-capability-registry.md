# Relay capability registry operations

## Trust identities and scopes

| Operation | Required badge scope | Additional identity rule |
|---|---|---|
| list/get | `capability.read` | tenant comes from badge |
| create next version | `capability.write` | human/account control badge |
| record trial | `capability.trial.record` | `system:skill-trial`, registered node-bound badge |
| share | `capability.share` | human/account control badge; cross-tenant target must be in an active grant |
| install decision | `capability.install.evaluate` | exact `system:capability-install-gate` service identity |

Do not give either system scope to a renderer or ordinary tenant badge. The
`recordedBy` JSON literal is a discriminator, not authentication.

## API sequence

1. `POST /v1/capabilities/versions` with the author input and source task,
   artifact event, and completed event IDs. Every `evidenceRef` and `receiptRef`
   must resolve inside that completed task.
2. The trusted trial service calls `POST /v1/capabilities/trials`. Package
   tenant/version/digest and trial node must match Relay state. Trial IDs cannot
   be replayed.
3. After at least five unique successful shadow trials and passing regression,
   an owner calls `POST /v1/capabilities/shares`. A cross-tenant request needs an
   active badge tenant grant; the request carries no invitation object.
4. The target calls `GET /v1/capabilities` or
   `GET /v1/capabilities/:packageId?version=N` and receives a read-only share
   snapshot.
5. A trusted verifier submits a complete `CapabilityInstallGateInput` to
   `POST /v1/capabilities/install-gate`. Submitted share ID, target, package
   digest, and share digest must match the persisted share. Relay binds current
   store time, recomputes the request digest, evaluates all passed/failed
   evidence, and appends the decision. No files are installed by this endpoint.

## Fail-closed behavior

- A version gap, stale predecessor digest, duplicate version, trial replay,
  foreign reference, expired invitation, or missing evidence is rejected.
- Unknown and foreign catalog references both return `capability_not_found`.
- Failed verifier evidence is persisted as a denied decision; Relay never
  rewrites it to passed.
- Schema 15 tables are append-only except derived package trial/status fields;
  immutable author content and version lineage cannot be updated or deleted.
