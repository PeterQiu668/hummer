# `@hummer/skill-replay`

This package is the W9 single-machine replay kernel.

It compiles package-bound deterministic plans, runs side-effect-free shadow
replays, attributes failures to exact steps, executes digest-bound regression
cases, and derives promotion decisions from replay evidence plus the existing
trusted `SkillTrialSystemRecordInput` contract.

The package deliberately accepts only adapters declaring
`deterministic: true` and `sideEffects: "none"`. Live mode proves that a complete
approval record is human-decided and bound to the tenant, package, and plan; it
still runs the same side-effect-free local adapters.

It does **not** connect to a real GUI/CUA runtime, capture an expert, consume a
persisted `CapabilityGrant`, perform an external write, or prove fidelity to a
person. Those require later host integration and separate evidence.

Run the local executable gate with:

```powershell
npm run test:skill-replay
```
