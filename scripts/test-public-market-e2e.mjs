import {
  emitGate, finishedCheck, repositoryRoot, runVitest,
} from './support/gate-runner.mjs';

const relayRun = runVitest({
  file: [
    'apps/relay/test/public-market-http.test.ts',
    'src/features/execution-nodes/remoteRelayClient.test.ts',
  ],
  pattern: 'PUBLIC-MARKET-HTTP-E2E|public projection|marketplace report|public projections',
  cwd: repositoryRoot,
  config: 'vitest.config.ts',
});
const uiRun = runVitest({
  file: 'src/features/capabilities/PublicMarketPanel.test.tsx',
  pattern: 'PUBLIC-MARKET-UI',
  cwd: repositoryRoot,
  config: 'vitest.ui.config.ts',
});

const checks = [
  finishedCheck('public-market-relay-http', relayRun, [
    'anonymous browse/detail returns only a real redacted PublicMarketStore projection',
    'real store output passes the browser boundary validator while missing, unknown, or sensitive fields fail closed',
    'reporting does not auto-takedown and the public response omits reporter tenant and actor identity',
    'moderation routes require a dedicated human badge and cannot be invoked through the public surface',
    'human takedown makes browse/detail unavailable and later install authorization returns 404',
    '401/403 report failures are attempted once and never retried by the web client',
  ], 9),
  finishedCheck('public-market-mobile-ui', uiRun, [
    '390px view uses one-column cards and full-width controls without a mock fallback',
    'source, trials, failures, permissions, receipt, and integrity digest are visible',
    'unconfigured Relay and installer states are explicit and read-only',
    'refresh removes a taken-down item and its install request control',
  ], 4),
];
const passed = checks.every((check) => check.status === 'passed');

emitGate({
  gate: 'public-market-e2e',
  mode: 'w10-local-relay-and-web-surface',
  status: passed ? 'passed' : 'failed',
  checks,
  assertions: checks.reduce((sum, check) => sum + (check.tests?.passed ?? 0), 0),
  negativeCases: 13,
  limitations: [
    'This is a loopback/local Relay and browser surface; no public deployment is performed or claimed.',
    'Install authorization reuses the existing trusted gate, but remote bundle transport and host materialization are not claimed.',
    'The W10 threshold of at least ten real third-party installs remains pending.',
    'No price, order, settlement, payment, rating, or ranking behavior exists.',
  ],
});
