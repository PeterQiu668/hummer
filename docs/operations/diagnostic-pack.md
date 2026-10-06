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

Packaged-app UI export remains pending. The local gate proves the library and
ZIP verifier only; it does not claim that an installed Electron application can
yet export the bundle from a button.
