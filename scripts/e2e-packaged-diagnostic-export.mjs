import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import JSZip from 'jszip';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const roundArgument = process.argv.slice(2).find((argument) => argument.startsWith('--round='));
const round = roundArgument?.slice('--round='.length);
if (!round || !/^round-[a-z0-9][a-z0-9-]{2,79}$/.test(round) || process.argv.length !== 3) {
  throw new Error('Usage: node scripts/e2e-packaged-diagnostic-export.mjs --round=round-<unique-safe-name>');
}
const roundDirectory = resolve(root, 'evidence', round);
if (existsSync(roundDirectory)) throw new Error(`Evidence round already exists and will not be overwritten: ${roundDirectory}`);
mkdirSync(roundDirectory, { recursive: false });

const zipPath = resolve(roundDirectory, 'packaged-desktop-diagnostic.zip');
const gatePath = resolve(roundDirectory, 'gate.json');
const failurePath = resolve(roundDirectory, 'failure.json');
const temporaryDirectory = mkdtempSync(resolve(tmpdir(), 'hummer-packaged-diagnostic-gate-'));
const canaries = {
  token: 'auth-token-canary-packaged-123456789',
  tenant: 'tenant-raw-packaged-canary',
  node: 'node-raw-packaged-canary',
  customer: 'customer-content-canary-never-export',
  path: 'C:\\customer-private\\workspace\\codex.cmd',
};
let assertions = 0;

try {
  const servicePath = resolve(root, 'apps/desktop/dist/diagnostic-export-service.js');
  const verifierPath = resolve(root, 'apps/desktop/dist/diagnostic-bundle.js');
  const preloadPath = resolve(root, 'apps/desktop/dist/preload.cjs');
  const mainPath = resolve(root, 'apps/desktop/dist/main.js');
  for (const path of [servicePath, verifierPath, preloadPath, mainPath]) assert(existsSync(path), `compiled Desktop bundle is missing ${path}`);
  const preload = readFileSync(preloadPath, 'utf8');
  const main = readFileSync(mainPath, 'utf8');
  assert(preload.includes('hummerDiagnostics') && preload.includes('hummer:diagnostics:export'), 'compiled preload does not expose diagnostic export');
  assert(main.includes('registerDiagnosticExportHost'), 'compiled main does not register diagnostic export');

  const { createDesktopDiagnosticInput, exportDesktopDiagnosticBundle } = await import(`${pathToFileURL(servicePath).href}?gate=${Date.now()}`);
  const { verifyDiagnosticBundle, writeDiagnosticBundle } = await import(`${pathToFileURL(verifierPath).href}?gate=${Date.now()}`);
  const environment = syntheticEnvironment('0.153.4');
  const receipt = await exportDesktopDiagnosticBundle({
    destinationPath: zipPath,
    generatedAt: new Date().toISOString(),
    appVersion: '0.6.0-internal.1',
    tenantRef: canaries.tenant,
    nodeRef: canaries.node,
    authToken: canaries.token,
    environment,
  });
  assert(existsSync(zipPath), 'compiled Desktop exporter did not create the ZIP');
  const archive = readFileSync(zipPath);
  const independentlyVerified = await independentScan(archive);
  const coreVerified = await verifyDiagnosticBundle(archive, [canaries.token]);
  assert(coreVerified.archiveSha256 === sha256(archive), 'production verifier archive hash disagrees');
  assert(coreVerified.archiveSha256 === receipt.archiveSha256, 'export receipt archive hash disagrees');

  const archiveText = independentlyVerified.texts.join('\n');
  for (const [name, value] of Object.entries(canaries)) {
    assert(!archiveText.includes(value) && !archive.includes(Buffer.from(value)), `archive contains forbidden ${name} canary`);
  }
  assert(!/(?:Bearer\s+\S+|api[_-]?key\s*[=:]|password\s*[=:]|SQLite format 3)/i.test(archiveText), 'archive contains a secret or database signature');

  const failedPath = resolve(temporaryDirectory, 'failed-export.zip');
  let rejected = false;
  try {
    await exportDesktopDiagnosticBundle({
      destinationPath: failedPath,
      generatedAt: new Date().toISOString(),
      appVersion: '0.6.0-internal.1',
      tenantRef: canaries.tenant,
      nodeRef: canaries.node,
      authToken: canaries.token,
      environment: syntheticEnvironment(canaries.token),
    });
  } catch {
    rejected = true;
  }
  assert(rejected, 'secret-bearing generated summary was not rejected');
  assert(!existsSync(failedPath), 'failed export left a partial ZIP');

  const writerInput = createDesktopDiagnosticInput({
    generatedAt: new Date().toISOString(),
    appVersion: '0.6.0-internal.1',
    tenantRef: canaries.tenant,
    nodeRef: canaries.node,
    authToken: canaries.token,
    environment,
  });
  const partialWritePath = resolve(temporaryDirectory, 'partial-write.zip');
  let partialWriteRejected = false;
  try {
    await writeDiagnosticBundle(partialWritePath, writerInput, {
      writeStaging: (fileDescriptor, bytes) => {
        writeSync(fileDescriptor, bytes.subarray(0, Math.floor(bytes.length / 2)));
        throw new Error('injected partial staging write');
      },
    });
  } catch {
    partialWriteRejected = true;
  }
  assert(partialWriteRejected, 'injected partial staging write was not rejected');
  assert(!existsSync(partialWritePath), 'partial staging write exposed a final ZIP');
  assert(readdirSync(temporaryDirectory).every((name) => !name.endsWith('.hummer-diagnostic.tmp')), 'partial staging write left a staging file');

  const publishFailurePath = resolve(temporaryDirectory, 'publish-failure.zip');
  let publishFailureRejected = false;
  try {
    await writeDiagnosticBundle(publishFailurePath, writerInput, {
      publishStaging: () => { throw new Error('injected atomic publish failure'); },
    });
  } catch {
    publishFailureRejected = true;
  }
  assert(publishFailureRejected, 'injected atomic publish failure was not rejected');
  assert(!existsSync(publishFailurePath), 'atomic publish failure exposed a final ZIP');
  assert(readdirSync(temporaryDirectory).every((name) => !name.endsWith('.hummer-diagnostic.tmp')), 'atomic publish failure left a staging file');

  const existingPath = resolve(temporaryDirectory, 'existing.zip');
  writeFileSync(existingPath, 'immutable-sentinel', { flag: 'wx' });
  let overwriteRejected = false;
  try {
    await exportDesktopDiagnosticBundle({
      destinationPath: existingPath,
      generatedAt: new Date().toISOString(),
      appVersion: '0.6.0-internal.1',
      tenantRef: canaries.tenant,
      nodeRef: canaries.node,
      authToken: canaries.token,
      environment,
    });
  } catch {
    overwriteRejected = true;
  }
  assert(overwriteRejected, 'existing destination was not rejected');
  assert(readFileSync(existingPath, 'utf8') === 'immutable-sentinel', 'existing destination was modified');

  const gate = {
    schema: 'hummer.packaged-diagnostic-export-gate',
    version: 1,
    status: 'passed',
    capturedAt: new Date().toISOString(),
    executionBoundary: 'compiled Electron main/preload bundle; no installer or real user-data directory',
    assertions,
    negativeCases: [
      'secret-bearing-generated-summary-no-output',
      'partial-staging-write-cleanup',
      'atomic-publish-failure-cleanup',
      'existing-target-no-overwrite',
    ],
    requiredEntries: independentlyVerified.names,
    inventory: independentlyVerified.inventory,
    artifacts: [{ path: basename(zipPath), sha256: sha256(archive), bytes: archive.length }],
    productionVerifier: {
      archiveSha256: coreVerified.archiveSha256,
      archiveBytes: coreVerified.archiveBytes,
      fileCount: coreVerified.fileCount,
      totalFileBytes: coreVerified.totalFileBytes,
    },
    limitations: [
      'The gate executes the compiled Electron main/preload modules; it does not install or launch NSIS.',
      'Native save-dialog interaction is covered by the trusted IPC unit seam, not GUI automation.',
      'All archive inputs and canaries are synthetic; no real userData, workspace, customer content, or credential store is read.',
    ],
  };
  writeFileSync(gatePath, `${JSON.stringify(gate, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(`${JSON.stringify(gate)}\n`);
} catch (error) {
  const failure = {
    schema: 'hummer.packaged-diagnostic-export-gate-failure',
    version: 1,
    status: 'failed',
    capturedAt: new Date().toISOString(),
    message: error instanceof Error ? error.message : String(error),
    zipPresent: existsSync(zipPath),
  };
  writeFileSync(failurePath, `${JSON.stringify(failure, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  process.stderr.write(`${JSON.stringify(failure)}\n`);
  process.exitCode = 1;
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

function syntheticEnvironment(version) {
  return {
    ready: true,
    node: { available: true, version: '22.22.2', source: 'embedded' },
    codex: {
      available: true,
      compatible: true,
      expectedVersion: '0.153.4',
      version,
      executable: canaries.path,
      issue: canaries.customer,
    },
    container: {
      available: true,
      runtime: 'podman',
      preferredRuntime: 'podman',
      productionRecommended: true,
      issue: canaries.customer,
    },
    workspaceExec: { runtime: 'podman', diagnostic: canaries.customer, workspacePath: canaries.path },
  };
}

async function independentScan(archive) {
  const zip = await JSZip.loadAsync(archive, { checkCRC32: true, createFolders: false });
  const names = Object.keys(zip.files).filter((name) => !zip.files[name].dir).sort();
  const expected = [
    'SUMMARY.txt',
    'files/config/runtime-summary.json',
    'files/receipts/diagnostic-export.json',
    'manifest.json',
  ];
  assert(JSON.stringify(names) === JSON.stringify(expected), `archive entries differ from allowlist: ${names.join(', ')}`);
  const manifestText = await zip.file('manifest.json').async('string');
  const summaryText = await zip.file('SUMMARY.txt').async('string');
  const manifest = JSON.parse(manifestText);
  assert(manifest.schema === 'hummer.diagnostic-bundle-manifest' && manifest.version === 1, 'manifest schema/version invalid');
  assert(sha256(summaryText) === manifest.summarySha256, 'summary SHA-256 mismatch');
  const expectedPaths = ['config/runtime-summary.json', 'receipts/diagnostic-export.json'];
  assert(JSON.stringify(manifest.inventory.map((entry) => entry.path)) === JSON.stringify(expectedPaths), 'manifest inventory is not the generated-file allowlist');
  const texts = [manifestText, summaryText];
  for (const entry of manifest.inventory) {
    assert(entry.archivePath === `files/${entry.path}`, `archive path mismatch for ${entry.path}`);
    const bytes = await zip.file(entry.archivePath).async('nodebuffer');
    assert(bytes.length === entry.bytes, `byte count mismatch for ${entry.path}`);
    assert(sha256(bytes) === entry.sha256, `SHA-256 mismatch for ${entry.path}`);
    texts.push(bytes.toString('utf8'));
  }
  return { names, inventory: manifest.inventory, texts };
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function assert(condition, message) {
  assertions += 1;
  if (!condition) throw new Error(message);
}
