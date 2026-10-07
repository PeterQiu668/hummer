import { emitGate, finishedCheck, repositoryRoot, runVitest } from './support/gate-runner.mjs';

const run = runVitest({
  file: 'apps/relay/test/capability-outcome-binding.test.ts',
  pattern: 'CAPABILITY-OUTCOME-BINDING',
  cwd: repositoryRoot,
  config: 'vitest.config.ts',
});

const check = finishedCheck('capability-outcome-binding', run, [
  'Desktop production persistence creates session evidence, accepted outcome, and portable outcome receipt',
  'Relay independently recomputes receipt leaf hashes, root hash, canonical event payload, and event-chain links',
  'Memory and SQLite drafts require an accepted receipt bound to tenant, work order, task, node, session, and artifact digest',
  'artifact bytes are rehashed and byte-count checked before any registry mutation',
  'receipt and artifact customer content remain absent from capability records and audit metadata',
  'failed tasks, rejected or tampered receipts, old ids-only requests, and all tested identity/provenance mismatches fail closed',
], 12);

emitGate({
  gate: 'capability-outcome-binding',
  mode: 'local-production-path-synthetic-e2e',
  status: check.status,
  checks: [check],
  assertions: run.testSummary?.passed ?? 0,
  negativeCases: 12,
  limitations: [
    'The task and accepted outcome are local synthetic fixtures routed through production Desktop persistence and Relay stores.',
    'This is not an external real-user task, expert demonstration, second-machine result, deployment, or market evidence.',
    'Outcome receipt v1 is hash-verifiable but unsigned; issuer signing and trusted timestamps remain outside this gate.',
    'Artifact bytes are capped at 256 KiB for this intake path; large-artifact streaming or object-store proofs are not covered.',
  ],
});
