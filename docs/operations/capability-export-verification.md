# Independent capability export verification

Run the dependency-free verifier with the pinned repository Node runtime:

```powershell
node scripts/verify-capability-export.mjs <capability-export.json>
```

Exit `0` returns one JSON line with `valid: true`, the package identity, package digest, eight-file bundle root, total bytes, and receipt root. Exit `1` writes one JSON failure object to stderr.

The verifier imports no HUMMER workspace package. It independently checks:

- the exact eight Agent Skills files and the exact outer descriptor;
- per-file SHA-256 values, size limits, deterministic bundle root, and prohibited credential/raw-recording markers;
- `meta.json` and `manifest.json` binding to the immutable capability package digest;
- the outcome-receipt leaf hashes, receipt root, domain-event hash chain, package/trial/regression binding, and provenance digest;
- the five-successful-shadow-run and regression requirement for a shared package.

This proves byte and evidence integrity. It does not grant install authority, approve permissions, prove expert fidelity, or replace the human approval and install-gate decision.
