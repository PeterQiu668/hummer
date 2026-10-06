# Tenancy P0 regression gate

`npm run test:tenancy` is currently an emergency stop gate for the two confirmed cross-tenant surfaces. It runs behavior tests, not source-string scans.

| Test ID | Surface | Required behavior |
|---|---|---|
| `TEN-P0-API-WORKORDER-BARE-ID` | API WorkOrder read/write by bare ID | A tenant-B authenticated context cannot read or mutate tenant-A state by knowing its ID. |
| `TEN-P0-DESKTOP-SESSION-BARE-ID` | Desktop session projection/event read by bare session ID | A tenant-B authenticated context cannot read tenant-A session metadata or events by knowing its session ID. |

The product regression tests must include the bracketed IDs in their test titles. The gate runs each marker independently through Vitest and requires at least one passed test, zero failed tests, and process exit code `0`. A missing, skipped-only, or failed marker makes the root gate exit `1`, because these are known P0 surfaces and cannot be represented as pending.

This gate does **not** claim the full 21-item matrix. While the P0 stop is active, chain-head, quota, export, WebSocket, recording, cache, diagnostic, temporary-directory, and workspace-path surfaces remain unproven. They must be added as behavior tests after both P0 regressions pass; no static string scan can promote them to passed.
