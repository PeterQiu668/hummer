import {
  emitGate, finishedCheck, repositoryRoot, runVitest,
} from './support/gate-runner.mjs';

const run = runVitest({
  file: [
    'packages/public-market/src/public-market.test.ts',
    'apps/desktop/src/persistence/persistence.test.ts',
  ],
  pattern: 'PUBLIC-MARKET|upgrades an existing v10 database',
  cwd: repositoryRoot,
  config: 'vitest.config.ts',
});

const check = finishedCheck('public-market-w10-local-kernel', run, [
  'migration v15 adds verified packages, system trials, public listings, install decisions, reports, and moderation audit',
  'public browsing returns a redacted projection with provenance, trials, failures, permissions, and integrity digest',
  'the existing capability install gate approves an exact package and rejects a permission expansion',
  'reports do not auto-takedown; a tenant-member human moderator is required',
  'takedown removes the listing from browse and blocks later install authorization',
  'tenant existence, tenant membership, and actor identity are checked before marketplace writes',
], 10);

emitGate({
  gate: 'public-market',
  mode: 'w10-local-read-only-kernel',
  status: check.status,
  checks: [check],
  assertions: run.testSummary?.passed ?? 0,
  negativeCases: 10,
  limitations: [
    'This gate covers the local persistence/domain kernel only; the local Relay and browser surface is covered separately by test:public-market-e2e and is not a production deployment.',
    'Installation means an approved, persisted install-gate decision; remote bundle transport and host materialization are not claimed.',
    'The W10 external threshold of at least ten real third-party installs remains pending.',
    'No price, order, settlement, payment, rating, or ranking behavior exists in this gate.',
  ],
});
