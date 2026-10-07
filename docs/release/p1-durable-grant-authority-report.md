# P1 durable task-grant authority report

- Branch: `codex/phase0-fleet`
- Implementation commit: `542dc2ed366fdd98a5f4b56c80d58c96893290f9`
- Evidence round: `round-p1-durable-grant-authority`
- Status: passed locally; not pushed or deployed

## Outcome

The runnable Relay no longer relies on process-local task-grant use accounting.
Relay config version 2 requires a separate SQLite database for the task-grant
authority. A successful consume commits one-use exhaustion with WAL and FULL
synchronous durability before HTTP success is returned. Exhaustion, expiry,
and revocation remain authoritative after Relay closes and restarts.

Provisioning is an offline, digest-only operation. The new
`hummer-relay grant-import` command validates a strict snapshot without reading
badge environment secrets, stores no plaintext task token, adds new immutable
grants, treats identical re-import as idempotent, and refuses binding or digest
conflicts. Re-import cannot roll `usedCount` or terminal state backward.

The production executor remains `executor_unavailable`.

## Restart and replay evidence

The focused restart integration uses a persistent SQLite Fleet store and a
separate persistent grant store behind the real Fastify routes:

1. Register node, enqueue and lease a TaskEnvelope, persist an approval request
   and approved human decision, then consume the one-use grant.
2. Close Relay, reopen both databases, and retry consume: Relay returns 401.
3. Check the same bound authorization: checkpoint returns 200 without spending
   another use.
4. Persist revocation, close Relay again, reopen both databases, and retry the
   checkpoint: Relay returns 401.
5. Scan the SQLite bytes: the plaintext task token is absent.

The store-level tests also exercise two concurrent consumes, snapshot conflict,
strict file parsing, and add-only re-import after exhaustion.

## Verification

The sealed gate ran every command with exit code 0 under Node v22.22.2:

| Command | Result |
| --- | --- |
| `npm run typecheck` | passed |
| `npm run build:cli -w @hummer/relay` | passed |
| `npm run test:task-grant-durable -w @hummer/relay` | 4 files, 21 tests passed |
| `npm run test:grants -w @hummer/relay` | 2 files, 37 tests passed |
| `npm test -w @hummer/relay` | 20 files, 202 tests passed |
| `npm run test:daemons` | 15-assertion real child-process gate passed |

Additional checks:

- `npm run build`: passed with the existing Vite chunk-size warning.
- `npm run test:unit`: 109 files, 734 tests passed on the clean sequential rerun.

One earlier unit command exited before tests because it ran `config:check` in
parallel with the build's `config:generate` and observed a transient stale
generated file. This was an orchestration race introduced by the test runner,
not a product assertion failure. The commands were then run sequentially and
passed; the failure is retained here rather than hidden.

## Evidence chain

- Gate: `evidence/round-p1-durable-grant-authority/gate.json`
- Manifest: `evidence/round-p1-durable-grant-authority/manifest.json`
- Gate SHA-256: `7b313a651a7f20d031f94c61786dd7630bb64f6cfd871255d9010a926f6e74c7`
- Manifest root: `0c1ff301e87d0b7aa90f62ec9a2bf57efc6eaea7e4aeb36b4bb2f5a85c787ae9`
- Predecessor root: `e1dd1c701ef10d6a5d77fdccc00f0815e47d304d1d64bea11818e255165d5940`

## Migration and limits

- Relay config migrates from version 1 to version 2 and now requires an
  absolute `taskGrantDatabasePath` distinct from `databasePath`.
- A digest-only snapshot must be imported before its task grant can authorize
  execution. Unknown grants fail closed.
- The Fleet and grant databases are separate; this round does not claim a
  cross-database distributed transaction.
- Snapshot import is not a public issuer, IdP, KMS, or remote control plane.
- Static node badges remain bootstrap credentials.
- The daemon gate is same-host loopback, not two-device evidence.

## Next safe slice

Implement only the narrow `fs.read` attestation executor: one explicitly
approved relative file, strict workspace-root containment, no symlink or
hardlink escape, bounded chunked reads with authorization checkpoints, no file
body in logs or receipt, and an evidence hash as output. Codex/Claude/shell and
all write/network/spend/delete/privilege adapters remain disabled.
