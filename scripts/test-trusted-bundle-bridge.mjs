import { emitGate, finishedCheck, repositoryRoot, runVitest } from './support/gate-runner.mjs';

const run = runVitest({
  file: 'apps/relay/test/trusted-bundle-bridge.test.ts',
  pattern: 'TRUSTED-BUNDLE-(?:PROTOCOL|SQLITE)',
  cwd: repositoryRoot,
  config: 'vitest.config.ts',
});

const check = finishedCheck('trusted-bundle-relay-node-local-e2e', run, [
  'strict eight-file descriptor and canonical base64 bytes reject unknown fields, duplicate paths, and tampering',
  'Relay authenticates publisher and target node, isolates tenants, and accepts only an exact approved gate input/decision/descriptor',
  'Node reuses the existing Agent Skills verifier for manifest, receipt, package, share, and decision binding',
  'human approval is bound to tenant, node, gate, bundle, and root hash',
  'marker-controlled synthetic install root uses no-overwrite atomic directory rename',
  'network interruption and rename failure leave no target or staging directory',
  'SQLite adapter survives restart and retains exact immutable envelope bytes plus trusted gate evidence',
  'migration ledger remains additive and database triggers reject update/delete mutation',
  'identical bundle replay is idempotent while bundle-id byte conflicts are rejected',
  'persisted reads remain tenant- and target-node-isolated',
  'SQLite lock and injected write failure return failure without a readable partial row',
], 20);

emitGate({
  gate: 'trusted-bundle-bridge',
  mode: 'local-relay-node-durable-e2e',
  status: check.status,
  checks: [check],
  assertions: run.testSummary?.passed ?? 0,
  negativeCases: 20,
  limitations: [
    'This gate uses a loopback Relay and marker-controlled temporary synthetic install root only.',
    'The durable adapter is a local SQLite reference; production backup, HA, encryption-at-rest, and Postgres/RLS are not proven.',
    'No real user skill directory, remote machine, deployment, marketplace settlement, credential, or raw recording is touched.',
    'A passing local gate is not evidence that an external machine installed the bundle.',
  ],
});
