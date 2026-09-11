# M5-D Windows internal release

- Release class: unsigned internal test build
- Built: 2026-09-11 (Asia/Shanghai)
- Version: `0.5.0-internal.1`
- Installer: `release/m5d/HUMMER-Setup-0.5.0-internal.1.exe`
- Size: 104,368,997 bytes
- SHA-256: `CFA877D47D56F425420B217EB71D902D86F595AA825F7E84DF4BE8915CD61A68`
- Authenticode: `NotSigned`

## Current-machine verification

`npm run test:desktop:packaged` passed against `release/m5d/win-unpacked/HUMMER.exe`. The production renderer loaded, native SQLite opened, tenant creation succeeded, embedded Node reported 22.22.0, and Codex CLI 0.153.4 was detected as compatible.

This is current-machine package evidence. It is not a clean-machine installation result.

## Clean-machine gate

The current host has Windows Sandbox disabled (`Containers-DisposableClientVM: Disabled`) and no `WindowsSandbox.exe`. No separate clean Windows machine was available during this run. Installation and guided recovery on Windows without external Node or Codex therefore remain blocked and unclaimed.

## Code-signing application

| Field | Current status |
| --- | --- |
| Responsible owner | HUMMER legal/operations; named individual not assigned |
| Certificate vendor | Not selected |
| Expected completion | Not scheduled until legal entity, publisher name, vendor, and signing-key custodian are supplied |
| Repository evidence | Installer is `NotSigned`; no certificate request artifact exists |

The repository cannot truthfully invent a named owner, vendor, or date. These business inputs must be supplied before the certificate workflow can start.

## Distribution boundary

Codex CLI is not bundled. The installer contains Electron's embedded Node runtime, so customers do not need a separate Node installation. When Codex is absent or incompatible, the startup doctor presents a Chinese guided-install state rather than an exception stack. Clean-machine validation of that path remains the open gate above.
