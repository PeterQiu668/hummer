# Tenancy confirmed-P0 regression gate

`npm run test:tenancy` executes the confirmed P0 tenant-boundary behavior tests through three real runners. It does not scan source text to infer a pass.

| Runner group | Stable test IDs |
|---|---|
| Root Vitest | `TEN-P0-API-WORKORDER-BARE-ID`, `TEN-P0-DESKTOP-SESSION-BARE-ID`, `TEN-P0B-DESKTOP-IDENTIFIERS`, `TEN-P0C-DESKTOP-SIDE-CHANNELS`, `TEN-P0-DESKTOP-RUNTIME-IPC`, `TEN-P0E-RENDERER-CACHE`, `TEN-P0G-IDENTITY-BOUNDARY` |
| Relay Vitest | `TEN-P0D-RELAY-SURFACES`, `TEN-P0-RELAY-MULTITENANT-GRANT` |
| Node test runner | `TEN-P0F-NODE-AGENT-BOUNDARY` |

Run it with the repository-supported Node 22 toolchain:

```powershell
npm run test:tenancy
```

The command writes one JSON object using schema `hummer.executable-gate-result`. Each runner group reports `passed`, `negativeCases`, its toolchain, exit code, and per-marker results. `negativeCases` is the number of selected behavior tests that passed, not the number of individual assertions inside those tests.

The gate exits `1` when Node is not major version 22, a runner fails, its machine-readable report cannot be parsed, a required marker is absent, a marker selects zero passing tests, or any selected test is failed, skipped, or todo. Vitest lists tests outside a `-t` filter as skipped; those out-of-scope tests are deliberately excluded. A skip whose full test name contains a required marker still fails the gate.

This is only the executable regression set for the ten confirmed P0 markers. A green result does **not** prove the complete 21-item W4 tenancy matrix, and it does not promote any unrepresented WebSocket, recording, quota, export, or other surface to passed.
