# Redacted diagnostic pack

HUMMER diagnostic export is an allowlist, not an archive of the application data directory. It contains runtime status, bounded recent error events, and metadata for explicitly allowed log/config-summary/receipt/evidence files. Tenant and node references are SHA-256 hashes.

The exporter rejects absolute paths, traversal, databases, credential/secret paths, and raw recordings or captures. It writes a new UTF-8 JSON file with create-only semantics and will not overwrite an earlier diagnostic pack. Runtime bearer tokens, API keys, and caller-supplied secret values are redacted before serialization.

The W6 archive wrapper emits a ZIP with `manifest.json`, `SUMMARY.txt`, and only
the bounded UTF-8 files named by the manifest inventory. Generation and
independent verification both check every file digest and reject traversal,
unlisted ZIP entries, token/credential content, SQLite databases, binary data,
and every DemoSession/recording byte. Rejected data is not silently redacted
and copied into the archive.

Run the executable gate with:

```powershell
npm run test:diagnostics
```

The summary provides human-readable counts and a path/size/SHA-256/category
inventory. The manifest carries the same inventory plus the existing hashed
identity references and redacted runtime/event diagnostics. A verifier requires
exact agreement between the ZIP, manifest, summary digest, and diagnostic-pack
inventory.

The Desktop settings UI exposes a trusted preload bridge that asks the main
process to choose the destination and export a create-only ZIP. The renderer
cannot provide an arbitrary path. The production export source is deliberately
limited to two generated files (`config/runtime-summary.json` and
`receipts/diagnostic-export.json`); it never walks `userData`, a workspace, or
customer directories.

The writer first creates a unique sibling staging file, writes every byte,
fsyncs and closes it, reads it back through the production verifier, then uses
an atomic no-overwrite hard-link publication. A partial write, failed publish,
or pre-existing destination removes staging and never exposes a partial final
ZIP. Hard-link publication is used instead of rename because POSIX rename can
silently replace an existing destination.

After `npm run desktop:build`, run the compiled-bundle gate with a fresh,
previously unused evidence round:

```powershell
npm run test:desktop:diagnostic-export -- --round=round-<unique-name>
```

The gate refuses an existing round, leaves a failure receipt on error, and
records the actual ZIP SHA-256 plus every allowlisted entry digest. It executes
the compiled Electron main/preload modules and scans the real ZIP, but does not
install NSIS or automate the native save dialog. Those limitations must remain
visible in claims based on this evidence.
