import {
  emitGate, finishedCheck, parseGateArgs, plannedCheck, repositoryRoot, runNodeTests, runVitest, usageFailure,
} from './support/gate-runner.mjs';

const parsed = parseGateArgs(process.argv.slice(2), ['grants', 'token-leak']);
if (parsed.unknown.length || parsed.modes.length !== 1) {
  usageFailure('security', '--grants | --token-leak', parsed.unknown);
} else if (parsed.modes[0] === 'grants') {
  grants(parsed.dryRun);
} else {
  tokenLeak(parsed.dryRun);
}

function grants(dryRun) {
  const evidence = [
    'missing, invalid, expired and under-scoped badges are rejected',
    'cross-tenant and node-binding mismatches fail closed',
    'system-authored and scope-expanded approvals are rejected',
  ];
  if (dryRun) {
    emitGate({ gate: 'security', mode: 'grants', status: 'planned', checks: [plannedCheck('relay-grant-boundaries', 'vitest fastify-transport.test.ts fleet-service.test.ts -t <grant boundary cases>', evidence)], limitations: ['Dry run: no assertions were executed.', 'Static development badges are not production identity proof.'] });
    return;
  }
  const transport = runVitest({
    file: 'test/fastify-transport.test.ts',
    pattern: 'rejects missing, wrong, expired and under-scoped|rejects unknown approval fields|fails closed on cross-tenant',
  });
  const service = runVitest({
    file: 'test/fleet-service.test.ts',
    pattern: 'rejects cross-binding, expanded scope, expiry|not authorized for the session tenant|tenant claim conflicts',
  });
  const lifecycle = runVitest({
    file: 'test/badge-auth.test.ts',
    pattern: 'issues a least-privilege|does not spend|enforces maxUses|expires at|revokes immediately|rotates to|rejects|refuses rotation|restores|fails closed',
  });
  const checks = [
    finishedCheck('transport-grant-boundaries', transport, evidence, 10),
    finishedCheck('service-grant-boundaries', service, evidence, 12),
    finishedCheck('capability-grant-lifecycle', lifecycle, evidence, 25),
  ];
  const status = checks.every((check) => check.status === 'passed') ? 'passed' : 'failed';
  emitGate({
    gate: 'security', mode: 'grants', status, checks,
    assertions: checks.reduce((sum, check) => sum + (check.tests?.passed ?? 0), 0),
    negativeCases: checks.reduce((sum, check) => sum + check.negativeCases, 0),
    limitations: ['Production IdP provisioning and transactional snapshot persistence remain integration seams.'],
  });
}

function tokenLeak(dryRun) {
  const evidence = [
    'opaque badge is absent from serialized client state and structured logs',
    '401/403 errors are terminal, single-attempt, and omit badge material',
    'SSE authorization failures do not reconnect with the rejected badge',
  ];
  if (dryRun) {
    emitGate({ gate: 'security', mode: 'token-leak', status: 'planned', checks: [plannedCheck('node-client-token-canary', 'node --test relay-http-client.test.mjs -t <token cases>', evidence)], limitations: ['Dry run: no canary assertions were executed.', 'This is not a scan of external observability or host-level logs.'] });
    return;
  }
  const run = runNodeTests({
    file: 'apps/node-agent/test/relay-http-client.test.mjs',
    pattern: 'without exposing it|never leak or retry the badge|authorization failures stop',
  });
  const diagnostic = runVitest({
    file: 'apps/desktop/src/diagnostic-pack.test.ts',
    pattern: 'exports only hashed identity references and redacted diagnostics',
    cwd: repositoryRoot,
    config: 'vitest.config.ts',
  });
  const checks = [
    finishedCheck('node-client-token-canary', run, evidence, 4),
    finishedCheck('diagnostic-pack-secret-canary', diagnostic, evidence, 2),
  ];
  emitGate({
    gate: 'security', mode: 'token-leak',
    status: checks.every((check) => check.status === 'passed') ? 'passed' : 'failed', checks,
    assertions: checks.reduce((sum, check) => sum + (check.tests?.passed ?? 0), 0), negativeCases: 6,
    limitations: ['The canary covers Node client state, errors, and injected logger output; external APM/host logs are not connected in this repository.'],
  });
}
