# ADR-056: synthetic upgrade rollback and verifiable diagnostic bundle

Status: accepted; Desktop export path implemented with compiled-bundle evidence

## Context

W6 requires an upgrade/rollback rehearsal and a diagnostic pack that cannot
carry credentials, databases, or expert-recording data. The current internal
release is an unsigned NSIS artifact and there is no clean second Windows host
available in this branch. Exercising a real installed copy, the registry, or a
user data directory would exceed a safe local test boundary.

The existing diagnostic core emits a redacted JSON manifest but does not copy
or independently verify the listed diagnostic files.

## Decision

1. The local rehearsal operates only inside a directory created by
   `initializeSyntheticInstall`. Every operation fails closed unless the root
   carries `.hummer-synthetic-release-root`.
2. A release package is UTF-8 JSON with strict fields, relative paths, per-file
   SHA-256 digests, a payload digest, an externally supplied package SHA-256,
   and an inclusive/exclusive version compatibility interval.
3. Version directories are immutable. A staged version is published by a
   directory rename, while the active-version pointer changes inside one
   SQLite transaction. An injected failure rolls that transaction back, keeps
   the old version active and intact, moves only the generated candidate to a
   `.failed` quarantine, and appends a `rolled_back` audit row.
4. Rollback reasons are bounded and redact token, credential, and absolute
   path shapes before persistence.
5. The diagnostic bundle is a ZIP containing `manifest.json`, `SUMMARY.txt`,
   and only files named by the manifest inventory. Generation and verification
   both enforce relative paths, bounded UTF-8 text, SHA-256 and exact-entry
   agreement.
6. Token/credential content, SQLite magic bytes and database paths, all
   DemoSession/recording bytes, binary files, traversal, and unlisted ZIP
   entries are rejected. These inputs are never silently copied into a bundle.
7. The production Desktop renderer receives one authenticated `exportBundle`
   method. The trusted main process owns the native save dialog and builds the
   archive only from generated runtime and export summaries; it does not expose
   filesystem selection or raw diagnostic inputs to the renderer.
8. ZIP publication stages in the destination directory, fsyncs, closes, and
   verifies the staged bytes before an atomic no-overwrite hard-link publish.
   Write/publish failures remove staging; an existing destination is preserved.

## Consequences

- `npm run test:upgrade-rollback` and `npm run test:diagnostics` provide local,
  machine-readable W6 gates with explicit negative cases.
- The rehearsal proves package validation, compatibility checks, transactional
  activation, failure rollback, quarantine, and audit behavior for the local
  synthetic model. It does not prove electron-builder or NSIS behavior.
- A signed NSIS cross-version install/upgrade/rollback on clean Windows
  machines, installer process interruption, registry effects, locked running
  binaries, and native save-dialog automation remain pending and must not be
  reported as complete. The diagnostic gate covers the compiled Electron
  main/preload bundle and real ZIP bytes, not an installed application.
- No shared API contract, migration, real installation, registry key, or user
  data directory changes in this decision.
