# Phase 2 local surfaces evidence

Source: `03eed3c9cc573e746dab04b16eec6ce6cf751f6b` on `codex/phase0-fleet`; generated 2026-10-07T00:27:39.821Z.

## Result

10/10 executable gates passed; 0 failed; 0 skipped.

## Commands

- `demo-session-ui`: exit `0`; command `E:\npm-cache\_npx\5705de4b80ce9477\node_modules\node\bin\node.exe F:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js run test:demo-session-ui`
- `public-market-e2e`: exit `0`; command `E:\npm-cache\_npx\5705de4b80ce9477\node_modules\node\bin\node.exe F:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js run test:public-market-e2e`
- `trusted-bundle-bridge`: exit `0`; command `E:\npm-cache\_npx\5705de4b80ce9477\node_modules\node\bin\node.exe F:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js run test:trusted-bundle-bridge`
- `privacy-kernel`: exit `0`; command `E:\npm-cache\_npx\5705de4b80ce9477\node_modules\node\bin\node.exe F:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js run test:privacy`
- `capability-kernel`: exit `0`; command `E:\npm-cache\_npx\5705de4b80ce9477\node_modules\node\bin\node.exe F:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js run test:capability`
- `public-market-kernel`: exit `0`; command `E:\npm-cache\_npx\5705de4b80ce9477\node_modules\node\bin\node.exe F:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js run test:public-market`
- `contract`: exit `0`; command `E:\npm-cache\_npx\5705de4b80ce9477\node_modules\node\bin\node.exe F:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js run test:contract`
- `full-test`: exit `0`; command `E:\npm-cache\_npx\5705de4b80ce9477\node_modules\node\bin\node.exe F:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js test`
- `typecheck`: exit `0`; command `E:\npm-cache\_npx\5705de4b80ce9477\node_modules\node\bin\node.exe F:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js run typecheck`
- `build`: exit `0`; command `E:\npm-cache\_npx\5705de4b80ce9477\node_modules\node\bin\node.exe F:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js run build`

## What this proves

- The local teaching surface is wired through trusted Desktop IPC with explicit privacy controls.
- The local Relay exposes an honest public read-only marketplace surface with separate report and moderation authority.
- A strict trusted bundle can cross the local Relay/Node boundary and materialize only in a marker-controlled synthetic root after human approval.
- The integrated repository passes full unit/UI regression, typecheck, and production build.

## What remains pending

- Real OS capture and expert demonstration.
- Public deployment with production persistence and an external machine install.
- Ten third-party installs, five seed users, twenty real tasks, retention, and payment signal.

No deployment, push, real capture, real installation change, payment integration, or agent-hub write was performed.
