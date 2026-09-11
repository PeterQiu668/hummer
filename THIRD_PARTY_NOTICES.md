# Third-Party Notices

This file records direct runtime and delivery dependencies relevant to the HUMMER desktop internal release. It is an engineering inventory, not legal advice. The locked dependency tree remains the authoritative build input.

## OpenAI Codex CLI

- Version integrated and required: 0.153.4
- Source: https://github.com/openai/codex
- License: Apache License 2.0
- Distribution boundary: not bundled in the M5-C internal installer; HUMMER invokes a separately installed executable.
- Upstream license: https://github.com/openai/codex/blob/main/LICENSE

## Electron

- Version: 39.8.10
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

## ExcelJS

- Version: 4.4.0
- Source: https://github.com/exceljs/exceljs
- License: MIT
- Use: local XLSX extraction with worksheet and cell-coordinate preservation.

## Mammoth

- Version: 1.12.2
- Source: https://github.com/mwilliamson/mammoth.js
- License: BSD-2-Clause
- Use: local DOCX raw-text extraction.

## PDF.js

- Version: 6.3.289
- Source: https://github.com/mozilla/pdf.js
- License: Apache License 2.0
- Use: local PDF text extraction.

## JSZip

- Version: 3.10.1
- Source: https://github.com/Stuk/jszip
- License: MIT or GPL-3.0-or-later; HUMMER uses the MIT option.
- Use: document-extraction test fixtures only.

## Playwright

- Version locked by the root package lock
- Source: https://github.com/microsoft/playwright
- License: Apache License 2.0

Before any public or commercial distribution, generate a complete dependency license report from the lockfile, include all required license texts and upstream NOTICE files, and obtain legal review.
