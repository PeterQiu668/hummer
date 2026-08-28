# Engine Benchmark Status

The fixed matrix is 3 tasks x 5 repetitions x 4 engine profiles = 60 real runs. As of 2026-08-28, zero scored runs are complete.

This directory deliberately records preflight and authentication blockers instead of converting them into completion-rate estimates. DeepSeek, Zhipu, OpenAI API and Claude Code cannot be compared until the corresponding product profiles can run the same fixtures. The successful `openai-codex-validation` approval E2E is evidence for the Codex shell and HUMMER approval bridge only; it is not counted as an `openai-flagship` benchmark run because it uses a different authentication endpoint.

Raw preflight attempts are in `attempts.jsonl`. The immutable workload definition is in `benchmark-plan.json`.
