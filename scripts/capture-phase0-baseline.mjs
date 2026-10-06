import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const repositoryRoot = resolve(import.meta.dirname, '..')
const trustedWorktree = resolve(
  process.env.HUMMER_TRUSTED_WORKTREE ??
    'F:/Users/claude code/.claude/worktrees/m3-verify',
)
const abandonedRootWorktree = resolve(
  process.env.HUMMER_ABANDONED_ROOT ?? 'F:/Users/claude code',
)
const outputPath = resolve(
  repositoryRoot,
  process.argv[2] ?? 'evidence/round-00/baseline.json',
)
const bloodlinePath = resolve(
  repositoryRoot,
  process.argv[3] ?? 'evidence/round-d0/bloodline.json',
)
const pinnedNodeBinary = process.env.HUMMER_NODE_BIN ?? 'node'
const pinnedCodexBinary = process.env.HUMMER_CODEX_BIN ?? 'codex.cmd'
const childPath =
  pinnedNodeBinary === 'node'
    ? process.env.PATH
    : `${dirname(resolve(pinnedNodeBinary))}${delimiter}${process.env.PATH ?? ''}`

const inheritedDirtyFiles = [
  'apps/desktop/src/config/deepseek-pricing.json',
  'apps/desktop/src/config/engine-profiles.json',
  'apps/desktop/src/config/tool-definitions.json',
  'src/features/engines/engine-profiles.json',
  'src/features/sessions/runtime/runtime-pricing.json',
  'src/features/tools/tool-definitions.json',
  'spikes/m2-persistence/restart-evidence.json',
  'spikes/m4-identity/two-profile-evidence.json',
]

function run(command, args, cwd = trustedWorktree) {
  const startedAt = new Date().toISOString()
  const selectedCommand =
    command === 'node'
      ? pinnedNodeBinary
      : command === 'codex.cmd'
        ? pinnedCodexBinary
        : command
  const isCommandShim = process.platform === 'win32' && selectedCommand.endsWith('.cmd')
  const executable = isCommandShim ? (process.env.ComSpec ?? 'cmd.exe') : selectedCommand
  const executableArgs = isCommandShim
    ? ['/d', '/s', '/c', [selectedCommand, ...args].map(quoteCmdArg).join(' ')]
    : args
  const result = spawnSync(executable, executableArgs, {
    cwd,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    env: { ...process.env, PATH: childPath },
  })
  const finishedAt = new Date().toISOString()
  const stdout = result.stdout ?? ''
  const stderr = result.stderr ?? ''
  const combined = `${stdout}${stderr}`.trim()
  const lines = combined.split(/\r?\n/).filter(Boolean)

  return {
    command: [selectedCommand, ...args].join(' '),
    cwd,
    startedAt,
    finishedAt,
    exitCode: result.status,
    signal: result.signal,
    outputTail: lines.slice(-60),
    spawnError: result.error?.message ?? null,
  }
}

function quoteCmdArg(value) {
  if (!/[\s"&|<>^]/.test(value)) return value
  return `"${value.replaceAll('"', '\\"')}"`
}

function text(command, args, cwd = trustedWorktree) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  })
  if (result.status !== 0) {
    throw new Error(
      `Command failed (${result.status}): ${command} ${args.join(' ')}\n${result.stderr}`,
    )
  }
  return result.stdout.trim()
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

const capturedAt = new Date().toISOString()
const trustedHead = text('git', ['rev-parse', 'HEAD'])
const trustedBranch = text('git', ['branch', '--show-current'])
const inheritedStatus = text('git', ['status', '--short'])
const rootHead = text('git', ['rev-parse', 'HEAD'], abandonedRootWorktree)
const rootBranch = text('git', ['branch', '--show-current'], abandonedRootWorktree)
const rootStatus = text('git', ['status', '--short'], abandonedRootWorktree)

const dirtyFileEvidence = inheritedDirtyFiles.map((file) => ({
  path: file,
  sha256: sha256(resolve(trustedWorktree, file)),
}))

const desktopPackage = JSON.parse(
  readFileSync(resolve(trustedWorktree, 'apps/desktop/package.json'), 'utf8'),
)
const electronPackage = JSON.parse(
  readFileSync(resolve(trustedWorktree, 'node_modules/electron/package.json'), 'utf8'),
)

const commands = [
  run('node', ['--version']),
  run('npm.cmd', ['--version']),
  run('codex.cmd', ['--version']),
  run('npm.cmd', ['run', 'config:check']),
  run('npm.cmd', ['run', 'typecheck']),
  run('npm.cmd', ['run', 'build']),
  run('npm.cmd', ['test']),
  run('node', [
    'scripts/verify-receipt.mjs',
    'spikes/m5a-outcome-ledger/verifiable-outcome-receipt.json',
  ]),
  run('node', [
    'scripts/verify-receipt.mjs',
    'spikes/m5a-outcome-ledger/tampered-outcome-receipt.json',
  ]),
]

const baseline = {
  schema: 'hummer.phase0.baseline',
  version: 1,
  capturedAt,
  lineage: {
    trustedWorktree,
    trustedBranch,
    trustedHead,
    expectedProductHead: '24b726f745139d57f64f3413946740afc0754cf1',
    abandonedRootWorktree,
    abandonedRootBranch: rootBranch,
    abandonedRootHead: rootHead,
    abandonedRootStatus: rootStatus.split(/\r?\n/).filter(Boolean),
  },
  inheritedWorkingTree: {
    status: inheritedStatus.split(/\r?\n/).filter(Boolean),
    fileEvidence: dirtyFileEvidence,
    policy: 'Recorded only. Never include these inherited changes in Phase 0 commits.',
  },
  versions: {
    desktopApplication: desktopPackage.version,
    electronRuntime: electronPackage.version,
  },
  gates: commands,
  assertions: {
    trustedHeadMatchesExpected:
      trustedHead === '24b726f745139d57f64f3413946740afc0754cf1',
    inheritedDirtyFileCount: inheritedStatus.split(/\r?\n/).filter(Boolean).length,
    configCheckPassed: commands[3].exitCode === 0,
    typecheckPassed: commands[4].exitCode === 0,
    buildPassed: commands[5].exitCode === 0,
    fullTestPassed: commands[6].exitCode === 0,
    validReceiptAccepted: commands[7].exitCode === 0,
    tamperedReceiptRejected: commands[8].exitCode !== 0,
    codexVersionPinned: commands[2].outputTail.some((line) =>
      line.includes('0.153.4'),
    ),
    nodeVersionPinned: commands[0].outputTail.some((line) =>
      line.includes('v22.22.2'),
    ),
  },
  blockers: [
    {
      id: 'BLK-P0-CODEX-PIN',
      severity: 'important',
      status: commands[2].outputTail.some((line) => line.includes('0.153.4')) ? 'closed' : 'open',
      expected: 'codex-cli 0.153.4',
      observed: commands[2].outputTail.at(-1) ?? null,
      policy: 'Do not bypass. Runtime dispatch verification remains blocked until aligned.',
    },
    {
      id: 'BLK-P0-NODE-PIN',
      severity: 'important',
      status: commands[0].outputTail.some((line) => line.includes('v22.22.2')) ? 'closed' : 'open',
      expected: 'v22.22.2',
      observed: commands[0].outputTail.at(-1) ?? null,
      policy: 'Use the isolated pinned binary; do not mutate the global Node.js installation.',
    },
  ],
  source: relative(repositoryRoot, import.meta.filename),
}

const bloodline = {
  schema: 'hummer.phase0.bloodline',
  version: 1,
  capturedAt: new Date().toISOString(),
  expected: {
    productBase: '24b726f745139d57f64f3413946740afc0754cf1',
    abandonedRootHead: '9118de51cf7c21ff625de7b193e3c027b1aa3a69',
    integrationBranch: 'codex/phase0-fleet',
  },
  observed: {
    integrationWorktree: repositoryRoot,
    integrationHead: text('git', ['rev-parse', 'HEAD'], repositoryRoot),
    integrationBranch: text('git', ['branch', '--show-current'], repositoryRoot),
    integrationReflog: text(
      'git',
      ['reflog', '-10', '--date=iso'],
      repositoryRoot,
    )
      .split(/\r?\n/)
      .filter(Boolean),
    abandonedRootWorktree,
    abandonedRootHead: rootHead,
    abandonedRootBranch: rootBranch,
    abandonedRootStatus: rootStatus.split(/\r?\n/).filter(Boolean),
    abandonedRootReflog: text(
      'git',
      ['reflog', '-10', '--date=iso'],
      abandonedRootWorktree,
    )
      .split(/\r?\n/)
      .filter(Boolean),
    allWorktrees: text('git', ['worktree', 'list', '--porcelain'], repositoryRoot)
      .split(/\r?\n/)
      .filter(Boolean),
  },
  assertions: {
    integrationStartedFromTrustedProduct:
      text('git', ['merge-base', 'HEAD', '24b726f745139d57f64f3413946740afc0754cf1'], repositoryRoot) ===
      '24b726f745139d57f64f3413946740afc0754cf1',
    abandonedRootHeadPreserved:
      rootHead === '9118de51cf7c21ff625de7b193e3c027b1aa3a69',
    abandonedRootBranchPreserved: rootBranch === 'main',
  },
  policy:
    'The abandoned root worktree is evidence-only. Phase 0 writes and commits occur only in isolated worktrees based on the trusted product commit.',
}

mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8')
mkdirSync(dirname(bloodlinePath), { recursive: true })
writeFileSync(bloodlinePath, `${JSON.stringify(bloodline, null, 2)}\n`, 'utf8')

console.log(`baseline written: ${outputPath}`)
console.log(`bloodline written: ${bloodlinePath}`)
console.log(`trusted head: ${trustedHead}`)
console.log(`inherited dirty files: ${baseline.assertions.inheritedDirtyFileCount}`)
console.log(`config:check exit: ${commands[3].exitCode}`)
console.log(`typecheck exit: ${commands[4].exitCode}`)
console.log(`build exit: ${commands[5].exitCode}`)
console.log(`test exit: ${commands[6].exitCode}`)
console.log(`valid receipt exit: ${commands[7].exitCode}`)
console.log(`tampered receipt exit: ${commands[8].exitCode}`)
console.log(`codex pin satisfied: ${baseline.assertions.codexVersionPinned}`)
console.log(`node pin satisfied: ${baseline.assertions.nodeVersionPinned}`)

if (
  !baseline.assertions.trustedHeadMatchesExpected ||
  !baseline.assertions.configCheckPassed ||
  !baseline.assertions.typecheckPassed ||
  !baseline.assertions.buildPassed ||
  !baseline.assertions.fullTestPassed ||
  !baseline.assertions.validReceiptAccepted ||
  !baseline.assertions.tamperedReceiptRejected
  || !baseline.assertions.codexVersionPinned
  || !baseline.assertions.nodeVersionPinned
) {
  process.exitCode = 1
}
