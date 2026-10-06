import {
  emitGate, finishedCheck, parseGateArgs, plannedCheck, repositoryRoot, runVitest, usageFailure,
} from './support/gate-runner.mjs';

const modeConfig = {
  default: {
    pattern: 'CAP-',
    evidence: [
      'deterministic eight-file Agent Skills export',
      'per-file SHA-256 and deterministic root hash',
      'strict manifest/meta/receipt linkage and tamper rejection',
      'declared-permission and cross-tenant share install gates',
      'existing target refuses overwrite',
    ],
    negativeCases: 44,
  },
  permissions: {
    pattern: 'CAP-PERMISSIONS',
    evidence: ['access/path/capability expansion denied', 'explicit denial blocks install', 'existing target refuses overwrite'],
    negativeCases: 8,
  },
  sharing: {
    pattern: 'CAP-SHARING',
    evidence: ['cross-tenant invitation is revalidated', 'share is read-only and target-bound', 'path injection is rejected'],
    negativeCases: 11,
  },
  manifest: {
    pattern: 'CAP-MANIFEST',
    evidence: ['manifest/meta/receipt bind one package digest', 'tampered file/digest/root/descriptor is rejected'],
    negativeCases: 21,
  },
  agentskills: {
    pattern: 'CAP-AGENTSKILLS',
    evidence: ['exact standard eight-file export', 'LF-normalized deterministic bytes', 'credentials/recordings/unredacted markers rejected'],
    negativeCases: 4,
  },
};

const parsed = parseGateArgs(process.argv.slice(2), ['permissions', 'sharing', 'manifest', 'agentskills']);
if (parsed.unknown.length || parsed.modes.length > 1) {
  usageFailure('capability', '[default] | --permissions | --sharing | --manifest | --agentskills', parsed.unknown);
} else {
  const mode = parsed.modes[0] ?? 'default';
  const config = modeConfig[mode];
  if (parsed.dryRun) {
    emitGate({
      gate: 'capability',
      mode,
      status: 'pending',
      checks: [plannedCheck(
        `capability-${mode}`,
        `vitest capability-runtime.test.ts -t ${JSON.stringify(config.pattern)}`,
        config.evidence,
      )],
      limitations: ['Dry run: no assertions were executed.'],
      reason: 'Capability gate execution was explicitly skipped.',
    });
  } else {
    const run = runVitest({
      file: 'packages/capability-runtime/src/capability-runtime.test.ts',
      pattern: config.pattern,
      cwd: repositoryRoot,
      config: 'vitest.config.ts',
    });
    const check = finishedCheck(`capability-${mode}`, run, config.evidence, config.negativeCases);
    emitGate({
      gate: 'capability',
      mode,
      status: check.status,
      checks: [check],
      assertions: run.testSummary?.passed ?? 0,
      negativeCases: config.negativeCases,
      limitations: [
        'Local file modes are defense-in-depth; Windows ACL enforcement is outside this gate.',
        'Per-segment lstat/realpath checks cannot eliminate a privileged local TOCTOU race without openat-style APIs.',
        'Invitation validity is supplied by the authenticated host policy boundary, not inferred from renderer data.',
      ],
    });
  }
}
