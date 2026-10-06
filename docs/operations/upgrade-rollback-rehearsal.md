# W6 local upgrade and rollback rehearsal

## Safe boundary

The automated rehearsal is deliberately local and synthetic. It refuses any
root that does not carry `.hummer-synthetic-release-root`. It does not discover
or modify a real HUMMER install, Windows registry keys, `%APPDATA%`, a user
SQLite database, or an NSIS package.

Run the executable gate:

```powershell
npm run test:upgrade-rollback
```

The final stdout line is a `hummer.executable-gate-result` JSON record. A pass
means the test package SHA-256 and payload digests were checked, its version was
compatible, the active pointer switched transactionally, and injected failures
left the old version active and its files unchanged. Failed candidates are
moved into the exact synthetic root's `.failed` directory for audit; the gate
does not bulk-delete them.

## Manual review checklist

- Confirm the result mode is `synthetic-local-install`.
- Confirm all `UPGRADE-*` tests ran without skip or pending tests.
- Confirm the negative cases cover SHA mismatch, incompatibility, an unmarked
  root, after-stage failure, and failure inside the activity-pointer
  transaction.
- Confirm rollback audit reasons contain no injected token-shaped value.
- Do not translate this gate into a real NSIS or clean-machine claim.

## Pending external work

Real cross-version NSIS upgrade and rollback remains pending. It requires clean
Windows hosts, an approved installer matrix, signed artifacts, running-process
and locked-file cases, registry inspection, and a recovery record. None of that
is performed by this gate.
