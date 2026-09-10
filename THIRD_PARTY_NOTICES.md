# Third-Party Notices

This file records direct runtime and delivery dependencies relevant to the HUMMER desktop internal release. It is an engineering inventory, not legal advice. The locked dependency tree remains the authoritative build input.

## OpenAI Codex CLI

- Version integrated and required: 0.153.4
- Source: https://github.com/openai/codex
- License: Apache License 2.0
- Distribution boundary: not bundled in the M5-C internal installer; HUMMER invokes a separately installed executable.
- Upstream license: https://github.com/openai/codex/blob/main/LICENSE

## Electron

- Version: 38.8.6
- Source: https://github.com/electron/electron
- License: MIT

## electron-builder

- Version: 26.15.3
- Source: https://github.com/electron-userland/electron-builder
- License: MIT

## better-sqlite3

- Version: 13.0.3
- Source: https://github.com/WiseLibs/better-sqlite3
- License: MIT

## Playwright

- Version locked by the root package lock
- Source: https://github.com/microsoft/playwright
- License: Apache License 2.0

Before any public or commercial distribution, generate a complete dependency license report from the lockfile, include all required license texts and upstream NOTICE files, and obtain legal review.
