# Redacted diagnostic pack

HUMMER diagnostic export is an allowlist, not an archive of the application data directory. It contains runtime status, bounded recent error events, and metadata for explicitly allowed log/config-summary/receipt/evidence files. Tenant and node references are SHA-256 hashes.

The exporter rejects absolute paths, traversal, databases, credential/secret paths, and raw recordings or captures. It writes a new UTF-8 JSON file with create-only semantics and will not overwrite an earlier diagnostic pack. Runtime bearer tokens, API keys, and caller-supplied secret values are redacted before serialization.

The initial W2 implementation is the safe export core. UI wiring and a packaged-app export button remain D6 work. A future archive wrapper may include only the files named by the sanitized manifest, and must repeat the same path and token-leak checks before copying bytes.
