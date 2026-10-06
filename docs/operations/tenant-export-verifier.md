# Tenant chain-head and audit-export verifier

The verifier is the only supported handoff in this repository for producing an
agent-hub-ready chain-head projection. It reads exported JSON or stdin only. Do
not point it at `hummer.sqlite3`, `hummer.sqlite3-wal`, or
`hummer.sqlite3-shm`.

## Chain head

Validate a JSON export and create or advance the device projection:

```powershell
npm run verify:tenant-export -- chain-head `
  --input C:\exports\tenant-blue-head.json `
  --tenant tenant_blue_01 `
  --device device-blue-01 `
  --expected-position 42 `
  --expected-hash <64-lowercase-hex> `
  --output C:\staging\device-blue-01.json
```

For a pipe, use `--input -`. `--tenant` is always required. Device, position,
and incoming hash pins are optional when accepting a first anchor and
recommended when reconciling an expected anchor.

For an existing projection, pin the currently trusted anchor as a CAS
condition:

```powershell
npm run verify:tenant-export -- chain-head `
  --input C:\exports\tenant-blue-head-43.json `
  --tenant tenant_blue_01 `
  --device device-blue-01 `
  --expected-current-hash <previous-64-lowercase-hex> `
  --output C:\staging\device-blue-01.json
```

The existing file must itself pass strict schema validation and have the same
device and tenant. Only a higher position can replace it. An exact repeat is
idempotent; rollback, a different hash or timestamp at the same position,
device/tenant replacement, and a stale expected-current hash fail closed. The
writer uses an adjacent cooperative lock, a same-directory temporary file, and
rename. A separately authorized agent-hub adapter may apply the same operation
to its report history. This command itself never writes `F:\agent-hub`.

## Audit manifest and artifact bytes

```powershell
npm run verify:tenant-export -- audit-manifest `
  --input C:\exports\audit-manifest.json `
  --tenant tenant_blue_01 `
  --expected-sha256 <manifest-sha256-from-independent-channel> `
  --artifacts-root C:\exports\audit-package `
  --output C:\staging\audit-export-verified.json
```

The command verifies:

- exact schema/version and tenant;
- canonical manifest SHA-256;
- contiguous event positions and final head agreement;
- normalized, unique relative file paths; and
- every receipt/result/artifact file's real size and SHA-256.

It refuses manifest-only success: `--expected-sha256` and `--artifacts-root` are
both mandatory. Run `scripts/verify-receipt.mjs` separately when a receipt also
needs semantic verification, because this command proves the receipt file bytes
but not its receipt schema/signature.

## Failure handling

Any nonzero exit is a stop condition. Do not copy the projection, adjust the
tenant argument until it passes, or replace the expected hash with a value read
from the untrusted input. Investigate the producing HUMMER tenant/session and
compare against the previously anchored Git/NAS history.
