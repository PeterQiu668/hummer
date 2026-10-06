import {
  emitGate, finishedCheck, repositoryRoot, runVitest,
} from './support/gate-runner.mjs';

const run = runVitest({
  file: 'packages/distillation/src/distillation.test.ts',
  pattern: 'DISTILLATION',
  cwd: repositoryRoot,
  config: 'vitest.config.ts',
});

const check = finishedCheck('distillation-w8-synthetic-kernel', run, [
  'replaceable GuiGroundingAdapter emits evidence-bound single-element actions',
  'grounding failure, ambiguity, low confidence, and unbound evidence fail closed',
  'strict synthetic DemoSession sources produce reviewable dual-track author drafts',
  'at least one needs-human judgment annotation is mandatory',
  'bounded natural-language corrections create audited append-only versions',
  'altered/cross-package patches and invalid rollback targets are rejected',
], 10);

emitGate({
  gate: 'distillation',
  mode: 'w8-local-synthetic-kernel',
  status: check.status,
  checks: [check],
  assertions: run.testSummary?.passed ?? 0,
  negativeCases: 10,
  limitations: [
    'This gate accepts only explicit synthetic structured records; it does not prove a real ten-minute expert recording.',
    'It does not evaluate LLM abstraction quality, GUI model accuracy, or expert fidelity.',
    'It emits a CapabilityPackage author draft without a trialRecord; AC-P2-DIST-05 remains unproven until a real expert demonstration is reviewed.',
  ],
});
