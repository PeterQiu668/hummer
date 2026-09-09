# ADR-004: The outcome ledger is the billing and receipt unit

Date: 2026-09-02
Status: Accepted (local desktop product chain; see Scope below)

## Context

HUMMER cannot honestly claim "verify a result, then bill it" or "verify a result, then insure it"
until one fact base ties three things together for a single unit of work: what was accepted or
rejected, who accepted or rejected it, and what it actually cost. Before this ADR that fact base
did not exist. The workbench approval card showed `预估费用 未提供`, and `docs/architecture/mvp-contract.md`
explicitly excludes billing, settlement, and ROI attribution from scope.

This ADR does not remove that exclusion. It builds the minimum durable unit those future features
would need, so the next milestone extends real tables instead of inventing them under deadline
pressure.

## Decision

SQLite migration version 5, `m5a_outcome_ledger`, adds three append-mostly tables:

- `outcome_definitions` — a named, tenant-scoped billing/acceptance unit (e.g. "外发邮件审核通过"),
  with an action pattern, acceptance criteria text, risk level, and an optional list price.
- `outcome_events` — one accepted or rejected instance of a definition, tied to a session, an
  optional work order, and an optional approval. Idempotent by `(tenant_id, idempotency_key)`.
- `cost_ledger` — one real token-usage cost entry, computed from a verified CNY price table and
  optionally linked to an outcome event. Idempotent the same way.

Migration versions 1 through 4 are unchanged, consistent with ADR-002 and ADR-003.

`OutcomeLedgerStore` (`apps/desktop/src/persistence/outcome-ledger-store.ts`) follows the same
shape as `ProjectStore` and `ApprovalPolicyStore`: every mutation requires an idempotency key,
every mutation appends a domain event to the existing hash chain, and cross-tenant reads return
`undefined` rather than another tenant's row.

`calculateOutcomeCostCny` (`apps/desktop/src/pricing/deepseek-pricing.ts`) fails closed. If a model
has no verified CNY price in the generated `apps/desktop/src/config/deepseek-pricing.json`, it throws instead of
recording a zero or invented cost. This is the same "the UI does not invent a cost" rule from
ADR-003, enforced one layer down at the ledger instead of only at render time.

`assembleOutcomeReceipt` (`apps/desktop/src/persistence/outcome-receipt.ts`) and
`DesktopPersistence.buildOutcomeReceipt` compose an outcome, its definition, every linked cost
entry, its governing approval evidence (if any), and a full hash-chain integrity check into one
JSON bundle. The bundle is passed through the existing `redactRuntimeSecrets` before being
returned, so a secret accidentally captured in a text field (an evidence ref, a note) cannot leave
this function unredacted.

### Generated single source of truth

`packages/config/src/runtime-pricing.json` and `packages/config/src/engine-profiles.json` are the
only authored catalogs. `packages/config/scripts/generate.mjs` generates the desktop and renderer
copies before typecheck, build, and unit tests. The browser catalog excludes internal profiles at
generation time. `tests/config-single-source.test.ts` regenerates into a temporary directory and
compares every committed output byte-for-byte, so editing either generated copy directly fails CI.

## Consequences

A receipt can now be produced and independently verified for one unit of work: outcome, cost,
approval, and hash-chain integrity. This is the fact base a future billing feature or a future
insurance-claim integration would read from — this ADR does not build either of those.

## Scope: what this ADR does and does not cover

Done, with test evidence:

- Migration v5 with three tables, foreign keys, and tenant-scoped indexes.
- `OutcomeLedgerStore`: define, record, list, idempotent replay, cross-tenant isolation.
- `calculateOutcomeCostCny`: verified off-peak/peak DeepSeek pricing, fails closed for unpriced models.
- `assembleOutcomeReceipt` / `buildOutcomeReceipt`: composed receipt with redaction and integrity check.
- Wired into `DesktopPersistence` and `persistence/index.ts` exports.
- Authenticated IPC for define, record, record-cost, receipt, and tenant-scoped session-cost reads.
- A runtime-neutral renderer port exposed through `preload.cts`; tenant and actor identity remain
  derived in the Electron main process from the authenticated session.
- The workbench approval card reads its displayed estimate from `cost_ledger`. Missing ledger data
  still renders `未提供`; runtime event or mock costs are never substituted.
- A real Electron product-chain E2E covering definition, policy match, approval, accepted outcome,
  priced token usage, receipt assembly, secret redaction, and a valid six-event hash chain.

Not done, and not claimed as done:

- No settlement, invoicing, or payment capture. `unit_price_cny` on `outcome_definitions` is stored
  for a future pricing feature to read; nothing computes an invoice from it yet.
- This E2E supplies deterministic local product-chain evidence. It does not call an external model
  provider and must not be presented as real external runtime evidence.

## Acceptance evidence

- `apps/desktop/src/pricing/deepseek-pricing.test.ts` — off-peak cost matches the verified price
  table exactly, peak pricing is strictly higher inside the configured Asia/Shanghai window, an
  unpriced model throws rather than returning a cost, and negative/inconsistent usage is rejected.
- `apps/desktop/src/persistence/outcome-ledger-store.test.ts` — five cases: (1) a full
  definition → approval → outcome → cost → receipt chain with a secret-shaped value planted in an
  evidence ref and confirmed redacted in the receipt while the hash chain remains valid; (2)
  idempotent replay of definition/outcome/cost keys; (3) fail-closed cost recording for an unpriced
  model; (4) cross-tenant isolation for definitions, events, and receipts; (5) a rejected outcome
  with no linked approval or cost, producing a receipt with `approval: null` and `totalCostCny: 0`.
- `src/features/outcomes/outcomeClient.test.tsx` proves the renderer port forwards the authenticated
  token and preserves unavailable-host behavior.
- `src/components/pages/WorkbenchPage.test.tsx` proves the approval card displays the tenant/session
  cost aggregate and does not use mock runtime cost as a fallback.
- `scripts/e2e-desktop-outcome-receipt.mjs` produced
  `spikes/m5a-outcome-ledger/outcome-receipt-evidence.json` on 2026-09-10 02:38:11
  (Asia/Shanghai): cost CNY 0.01883, approved outcome, redaction assertion passed, hash chain
  `valid=true, checked=6`.
- W1 acceptance: `typecheck`, 127 unit tests, 26 UI tests, renderer build, desktop build, browser E2E,
  desktop persistence E2E, and outcome receipt E2E passed.
