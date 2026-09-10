# ADR-007: Desktop credentials and internal Windows package boundary

- Status: Accepted with external acceptance gates
- Date: 2026-09-11
- Milestone: M5-C P0.2-P0.3

## Context

Runtime keys previously came only from the desktop process environment. Customers could not configure them, and a launch package could fail with an English exception when Codex CLI was absent or incompatible.

## Decision

1. Migration v6 adds tenant-scoped `engine_credentials`. It stores only an Electron `safeStorage` ciphertext and the expected environment-variable name. It emits no domain event.
2. Renderer requests contain the authenticated session token, engine profile ID, and plaintext only during the save call. The main process encrypts immediately. The plaintext is never returned to renderer.
3. Runtime invocation carries only an authenticated lookup reference. The main process resolves and decrypts the credential immediately before spawn, puts it only in a copied child environment, and redacts that environment from all wire channels.
4. Customer profiles are disabled before selection when their required credential is absent. Internal profiles remain excluded.
5. The Windows artifact is an NSIS one-click installer. A desktop environment gate reports embedded Node and the exact Codex CLI version in Chinese and links to the official install guide instead of surfacing an exception stack.
6. The M5-C internal package does not bundle Codex CLI. The upstream repository and npm package identify Codex CLI as Apache-2.0, which permits redistribution subject to license and applicable NOTICE obligations. Bundling is deferred because it also creates platform packaging, update, provenance, and size obligations; the environment guide is the safer internal-release boundary.
7. The current internal installer is intentionally unsigned. Production release remains blocked on an organization-owned code-signing certificate and clean-machine verification.

## Evidence

- Unit and UI tests cover migration v6, ciphertext-only storage, tenant isolation, unavailable `safeStorage`, child-only environment injection, redaction, authenticated profile listing, disabled profile selection, and the repair UI.
- `release/m5c/HUMMER-Setup-0.0.0.exe` was generated on 2026-09-11. Size: 104,353,266 bytes. SHA-256: `5A47521EBBFD15999B6AACFA3C4C0E74093083420DE08DD3BD5E46A0BAC36A34`.
- Windows Authenticode inspection returned `NotSigned`.
- `npm run test:desktop:packaged` launched `release/m5c/win-unpacked/HUMMER.exe`, loaded the visible production renderer and native SQLite module, created a tenant through the packaged UI, displayed the real desktop runtime state, and reported embedded Node `22.22.0` plus compatible Codex CLI `0.153.4`.
- The package command now rebuilds both the Vite renderer and desktop host before electron-builder runs. Vite uses a relative asset base so packaged `file://` pages do not silently render an empty body.

## External gates

- `npm run test:desktop:credentials` requires a safely supplied `DEEPSEEK_API_KEY` and is currently blocked before Electron launch.
- Installation and recovery guidance have not yet been validated on a clean Windows profile with no external Node and no Codex installation.
- Certificate application has not been submitted by this repository. Required owner: HUMMER legal/operations; required inputs: legal entity, publisher name, certificate vendor, and signing custody process.

## Sources verified 2026-09-11

- Codex license: https://github.com/openai/codex/blob/main/docs/license.md
- Codex Windows/npm installation: https://github.com/openai/codex/blob/main/README.md
- Codex 0.153.4 release: https://github.com/openai/codex/releases/tag/rust-v0.153.4
