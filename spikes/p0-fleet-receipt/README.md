# Phase 0 fleet receipt fixture

This directory is a deterministic, synthetic verification fixture for the fleet receipt verifier. It is not evidence of a real two-machine run, a real runtime invocation, or external delivery.

- `fleet-receipt.json` is a valid `hummer.outcome-receipt` version 1 envelope with an optional strict `fleet` segment.
- `children/*.json` are independently valid version 1 outcome receipts.
- `artifacts/*` are synthetic files whose exact bytes are covered by child artifact references and the fleet manifest.

Regenerate only by intentionally replacing the whole fixture through a reviewed change. The test command does not rewrite this directory.

```powershell
node scripts/verify-receipt.mjs spikes/p0-fleet-receipt/fleet-receipt.json
node scripts/verify-fleet-receipt.mjs spikes/p0-fleet-receipt/fleet-receipt.json
node scripts/test-fleet-receipt.mjs
```

The first command proves backward compatibility with the existing version 1 verifier. The second proves the fleet references and artifact bytes. The third includes fail-closed negative cases.
