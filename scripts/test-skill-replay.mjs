import {
  emitGate, finishedCheck, repositoryRoot, runVitest,
} from './support/gate-runner.mjs';

const run = runVitest({
  file: 'packages/skill-replay/src/skill-replay.test.ts',
  pattern: 'SKILL-REPLAY',
  cwd: repositoryRoot,
  config: 'vitest.config.ts',
});

const check = finishedCheck('skill-replay-w9', run, [
  'same plan and input produce the same replay and output digests',
  'unsafe adapters and invalid plan bindings fail closed',
  'failed execution records the exact failureStepRef',
  'live mode requires package- and plan-bound human approval',
  'regression evidence is derived from executed cases',
  'fewer than five, failed trials, or failed regression deny promotion',
], 8);

emitGate({
  gate: 'skill-replay',
  mode: 'w9-local-kernel',
  status: check.status,
  checks: [check],
  assertions: run.testSummary?.passed ?? 0,
  negativeCases: 8,
  limitations: [
    'This gate uses deterministic, side-effect-free in-process adapters only.',
    'It does not claim real GUI/CUA replay, expert-fidelity, signed receipts, persistence, or multi-machine execution.',
    'Live-mode coverage proves approval binding but performs no external write.',
  ],
});
