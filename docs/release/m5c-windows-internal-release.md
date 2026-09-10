# M5-C Windows internal release

- Release class: unsigned internal test build
- Date: 2026-09-11
- Installer: `release/m5c/HUMMER-Setup-0.0.0.exe`

## Implemented

- Electron Builder produces an NSIS one-click installer.
- Startup checks embedded Node and Codex CLI availability/version before rendering the product.
- Missing or incompatible Codex shows a Chinese repair screen with a clickable official installation guide. It does not expose an English exception stack.
- Native SQLite loading and the packaged production renderer are covered by `npm run test:desktop:packaged`.
- The packaged renderer was exercised as visible UI: company creation completed and the workbench displayed the real desktop runtime state rather than the mock badge.

## Artifact

- Size: 104,353,266 bytes
- SHA-256: `5A47521EBBFD15999B6AACFA3C4C0E74093083420DE08DD3BD5E46A0BAC36A34`
- Authenticode: `NotSigned`

## Distribution decision

Codex CLI is not bundled in this internal build. OpenAI publishes Codex CLI under Apache-2.0, so redistribution is possible when license and applicable NOTICE obligations are met. Bundling is deferred because HUMMER must also own binary provenance, updates, platform variants, and package-size impact. The current build uses the guided installation path.

Verified sources on 2026-09-11:

- https://github.com/openai/codex/blob/main/docs/license.md
- https://github.com/openai/codex/blob/main/README.md
- https://github.com/openai/codex/releases/tag/rust-v0.153.4

## Release gates still open

- Install and recovery flow on a clean Windows machine with no external Node and no Codex CLI.
- Organization-owned code-signing certificate. The certificate request has not been submitted because legal entity, publisher name, vendor, and signing-key custody owner have not been supplied.
- Real encrypted DeepSeek credential restart test and default-profile planning test.

The artifact values above were recorded after the final renderer rebuild and package smoke test. Any later rebuild must replace all three values together.
