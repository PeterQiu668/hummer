# M5-E Windows internal release status

- Release class: unsigned internal test build
- Date: 2026-09-12 (Asia/Shanghai)
- Version: `0.5.0-internal.1`
- Installer: `release/m5e/HUMMER-Setup-0.5.0-internal.1.exe`
- Size: 125,123,558 bytes
- SHA-256: `8CC246BDA3267C3F439980FB3BCB904CC92FC3EAC7A752BF3ED3C64D325BFB70`
- Authenticode: `NotSigned`

## Current-machine verification

`npm run test:desktop:packaged` passed against `release/m5e/win-unpacked/HUMMER.exe` after the packaged-smoke script was corrected to reject the old M5-D output path. The production renderer loaded, native SQLite opened, a tenant was created, Electron reported its embedded Node 22.22.1, and Codex CLI 0.153.4 was detected as compatible.

This is current-machine package evidence. It is not a clean-machine installation result.

## Code-signing certificate

| Field | Current status |
| --- | --- |
| Application status | Not applied |
| Responsible owner | Not assigned; requires HUMMER legal/operations decision |
| Certificate vendor | Not selected |
| Expected completion | Not scheduled |
| Blocking inputs | Legal entity, publisher name, vendor, and signing-key custodian |

This repository contains no certificate request or signing key. The internal package must continue to identify itself as unsigned.

## Clean Windows acceptance

The current host has no available clean Windows test machine. The prior environment check found Windows Sandbox disabled and `WindowsSandbox.exe` absent. Therefore the required flow below has not been executed and is not claimed:

1. Install on Windows with no external Node and no Codex CLI.
2. Follow the Chinese environment guide to install the supported Codex CLI.
3. Configure the DeepSeek credential through HUMMER encrypted settings.
4. Drop an order into the inbox, confirm it, and complete a receipt.

Electron includes its own Node runtime, but Codex CLI is still not bundled. A clean-machine failure of the guided Codex installation is the decision trigger for revisiting the bundling option reserved by ADR-007.

## Dependency review

Electron was upgraded from 38.8.6 to 39.8.10 after the M5-E audit. Safe `npm audit fix` updates were applied to build dependencies. Remaining advisories are upstream in Electron's development-time `extract-zip` and ExcelJS's `uuid`; `npm audit fix --force` would require unrelated major dependency changes and was not used. Final public distribution remains gated on a full dependency and license review.

## M5-F release note - 2026-09-13

The proposed `workspace.exec` capability did not pass its mandatory real-runtime no-network probe and was retracted before registration. No M5-F installer or public-release claim exists. Code-signing ownership, vendor selection, expected completion date, and clean-Windows acceptance remain open exactly as recorded above.
