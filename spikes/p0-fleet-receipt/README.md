# Phase 0 fleet receipt fixture

This directory is a deterministic, synthetic verification fixture for the fleet receipt verifier. It is not evidence of a real two-machine run, a real runtime invocation, or external delivery.

- `fleet-receipt.json` is a valid `hummer.outcome-receipt` version 1 envelope with an optional strict `fleet` segment.
- `children/*.json` are independently valid version 1 outcome receipts.
- `artifacts/*` are synthetic files whose exact bytes, byte lengths, and media types are covered by child artifact references, child receipt evidence records, and the fleet manifest.

Regenerate only by intentionally refreshing the known fixture files through a reviewed change. The normal test command does not rewrite this directory.

```powershell
node scripts/verify-receipt.mjs spikes/p0-fleet-receipt/fleet-receipt.json
node scripts/verify-fleet-receipt.mjs spikes/p0-fleet-receipt/fleet-receipt.json
node scripts/test-fleet-receipt.mjs
node scripts/test-fleet-receipt.mjs --refresh-fixtures
```

The first command proves backward compatibility with the existing version 1 verifier. The second proves the fleet references, child evidence binding, and artifact metadata/bytes. The third includes fail-closed negative cases.
