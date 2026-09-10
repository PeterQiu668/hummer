# ADR-006: DeepSeek structured planning capability gate

- Status: Blocked pending credential-backed verification
- Date: 2026-09-11
- Milestone: M5-C P0.1

## Context

M5-B proved schema-constrained planning with the internal `openai-codex-validation` profile. That result does not establish that the customer-default `deepseek-standard` profile accepts or obeys Codex app-server `turn/start.outputSchema`. A protocol rejection, an ignored schema, or an invalid structured result must not be hidden behind retries or an unmarked template fallback.

## Decision

1. `deepseek-standard` is considered planning-capable only after `npm run test:desktop:planner:deepseek` produces five distinct plans with no fallback reason and five priced planning receipts.
2. Diagnosis begins with the complete wire log. Timeout and retry counts are not compatibility fixes.
3. If DeepSeek rejects or ignores `outputSchema`, implementation must choose and separately disclose either a verified Responses-compatible structured-output field or a two-turn generate-and-extract process.
4. Until that verification succeeds, no M5-C document may claim that the default product profile has delivered real structured planning.
5. The customer catalog must expose any confirmed compatibility limitation before selection, at the same honesty level as the unavailable Zhipu profile.

## Current evidence

On 2026-09-11 (Asia/Shanghai), `npm run test:desktop:planner:deepseek`, `npm run test:desktop:credentials`, and `npm run test:desktop:wedge` all stopped at preflight because `DEEPSEEK_API_KEY` was absent from the process environment. No provider request was made and no mock evidence was substituted. Therefore DeepSeek's `outputSchema` behavior is **not yet verified in this milestone**.

Earlier evidence in `spikes/deepseek-standard/` proves real DeepSeek execution, approval, file writes, and fork behavior. It does not contain the M5-B schema-constrained planning scenario and cannot satisfy this ADR's gate.

## Required closure evidence

- `spikes/m5b-planner/deepseek-standard-evidence.json`
- `spikes/m5b-planner/deepseek-standard-wire.jsonl`
- Five task screenshots under `dist/`
- Five `pricing_source=planning` cost entries using the verified DeepSeek CNY catalog
- A secret scan covering the evidence, wire log, SQLite file, and exported receipt

## Consequences

P0.2 secure credential configuration and P0.3 packaging may proceed without a provider key. P1 code can be implemented against local product-chain tests, but no real DeepSeek wedge run or launch-readiness claim is allowed until this gate closes.
