import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  linkSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import JSZip from 'jszip';
import {
  createDiagnosticPack,
  type DiagnosticEventInput,
  type DiagnosticFileInput,
  type DiagnosticPack,
} from './diagnostic-pack.js';

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 5 * 1024 * 1024;
const FORBIDDEN_PATH = /(?:^|\/)(?:credentials?|secrets?|recordings?|captures?|raw[-_ ]?(?:capture|video|audio)|.*\.(?:db|sqlite3?|key|pem))(?:$|\/)/i;
const SENSITIVE_CONTENT = [
  /\bBearer\s+[A-Za-z0-9._~+\/-]{8,}\b/i,
  /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|client[_-]?secret)\s*[=:]\s*["']?[^\s,"';}]{4,}/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
];
const DEMO_SESSION_CONTENT = /hummer\.demo-session|"redactionApplied"\s*:\s*false|"recordKind"\s*:\s*"(?:input|keyframe|accessibility)"/i;

export interface DiagnosticBundleFileInput {
  path: string;
  category: DiagnosticFileInput['category'];
  contents: string | Buffer;
}
export interface DiagnosticBundleInput {
  generatedAt: string;
  appVersion: string;
  platform: NodeJS.Platform;
  nodeVersion: string;
  tenantRef?: string;
  nodeRef?: string;
  runtimeStatus: ReadonlyArray<{ runtime: string; status: string; version?: string; diagnostic?: string }>;
  recentEvents: ReadonlyArray<DiagnosticEventInput>;
  files: ReadonlyArray<DiagnosticBundleFileInput>;
  explicitSecrets?: ReadonlyArray<string>;
}

export interface DiagnosticBundleInventoryEntry extends DiagnosticFileInput {
  archivePath: string;
}

export interface DiagnosticBundleManifest {
  schema: 'hummer.diagnostic-bundle-manifest';
  version: 1;
  generatedAt: string;
  diagnosticPack: DiagnosticPack;
  inventory: DiagnosticBundleInventoryEntry[];
  summarySha256: string;
  exclusionPolicy: readonly [
    'credentials-and-tokens',
    'sqlite-databases',
    'demo-session-and-recording-bytes',
    'binary-or-invalid-utf8',
  ];
}

export interface VerifiedDiagnosticBundle {
  manifest: DiagnosticBundleManifest;
  archiveSha256: string;
  archiveBytes: number;
  fileCount: number;
  totalFileBytes: number;
}

export interface DiagnosticBundleWriteOptions {
  /** Test-only fault seam; production uses a complete fd write. */
  writeStaging?: (fileDescriptor: number, archive: Buffer) => void;
  /** Test-only fault seam; production uses atomic, no-overwrite hard-link publication. */
  publishStaging?: (stagingPath: string, destinationPath: string) => void;
}

function sha256(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function normalizePath(value: string): string {
  const normalized = value.replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized) || normalized.split('/').includes('..')) {
    throw new Error('diagnostic bundle file path must be relative');
  }
  for (const segment of normalized.split('/')) {
    if (!segment || segment === '.' || /[<>:"|?*\u0000-\u001f]/.test(segment) || /[ .]$/.test(segment)
      || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(segment)) {
      throw new Error(`diagnostic bundle path contains a Windows-unsafe segment: ${normalized}`);
    }
  }
  if (FORBIDDEN_PATH.test(normalized)) throw new Error(`diagnostic bundle excludes forbidden path: ${normalized}`);
  return normalized;
}

function assertSafeContents(path: string, bytes: Buffer, explicitSecrets: readonly string[]): string {
  if (bytes.length > MAX_FILE_BYTES) throw new Error(`diagnostic bundle file exceeds ${MAX_FILE_BYTES} bytes: ${path}`);
  if (bytes.subarray(0, 16).toString('binary') === 'SQLite format 3\u0000') throw new Error(`diagnostic bundle excludes SQLite bytes: ${path}`);
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`diagnostic bundle accepts UTF-8 text only: ${path}`);
  }
  if (text.includes('\u0000')) throw new Error(`diagnostic bundle excludes binary content: ${path}`);
  for (const secret of explicitSecrets) {
    if (secret.length > 0 && text.includes(secret)) throw new Error(`diagnostic bundle file contains an explicit secret: ${path}`);
  }
  if (SENSITIVE_CONTENT.some((pattern) => pattern.test(text))) throw new Error(`diagnostic bundle file contains credential material: ${path}`);
  if (DEMO_SESSION_CONTENT.test(text)) throw new Error(`diagnostic bundle excludes DemoSession or recording bytes: ${path}`);
  return text;
}

function summaryText(generatedAt: string, inventory: readonly DiagnosticBundleInventoryEntry[]): string {
  const totalBytes = inventory.reduce((sum, file) => sum + file.bytes, 0);
  return [
    'HUMMER redacted diagnostic bundle',
    `generatedAt: ${generatedAt}`,
    `includedFiles: ${inventory.length}`,
    `includedBytes: ${totalBytes}`,
    'excludedByPolicy: credentials/tokens, SQLite databases, DemoSession/recording bytes, binary/non-UTF-8 files',
    '',
    'Auditable inventory:',
    ...inventory.map((file) => `${file.path}\t${file.bytes}\t${file.sha256}\t${file.category}`),
    '',
  ].join('\n');
}

function validateManifest(value: unknown): DiagnosticBundleManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('diagnostic bundle manifest must be an object');
  const manifest = value as Partial<DiagnosticBundleManifest>;
  if (manifest.schema !== 'hummer.diagnostic-bundle-manifest' || manifest.version !== 1) throw new Error('unsupported diagnostic bundle manifest');
  if (!Array.isArray(manifest.inventory) || !manifest.diagnosticPack || typeof manifest.generatedAt !== 'string') throw new Error('diagnostic bundle manifest is incomplete');
  if (typeof manifest.summarySha256 !== 'string' || !HASH_PATTERN.test(manifest.summarySha256)) throw new Error('diagnostic bundle summary digest is invalid');
  if (!Array.isArray(manifest.exclusionPolicy) || manifest.exclusionPolicy.join('|') !== 'credentials-and-tokens|sqlite-databases|demo-session-and-recording-bytes|binary-or-invalid-utf8') {
    throw new Error('diagnostic bundle exclusion policy is invalid');
  }
  return manifest as DiagnosticBundleManifest;
}

export async function createDiagnosticBundle(input: DiagnosticBundleInput): Promise<Buffer> {
  if (input.files.length > 64) throw new Error('diagnostic bundle supports at most 64 files');
  const explicitSecrets = input.explicitSecrets ?? [];
  const seen = new Set<string>();
  let totalBytes = 0;
  const safeFiles = input.files.map((file) => {
    const path = normalizePath(file.path);
    if (seen.has(path)) throw new Error(`duplicate diagnostic bundle path: ${path}`);
    seen.add(path);
    const bytes = Buffer.isBuffer(file.contents) ? Buffer.from(file.contents) : Buffer.from(file.contents, 'utf8');
    assertSafeContents(path, bytes, explicitSecrets);
    totalBytes += bytes.length;
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error(`diagnostic bundle exceeds ${MAX_TOTAL_BYTES} bytes`);
    return { path, category: file.category, bytes, sha256: sha256(bytes), archivePath: `files/${path}` };
  }).sort((left, right) => left.path.localeCompare(right.path));

  const diagnosticPack = createDiagnosticPack({
    generatedAt: input.generatedAt,
    appVersion: input.appVersion,
    platform: input.platform,
    nodeVersion: input.nodeVersion,
    tenantRef: input.tenantRef,
    nodeRef: input.nodeRef,
    runtimeStatus: input.runtimeStatus,
    recentEvents: input.recentEvents,
    files: safeFiles.map(({ path, category, bytes, sha256: digest }) => ({ path, category, bytes: bytes.length, sha256: digest })),
    explicitSecrets,
  });
  const inventory = safeFiles.map(({ path, archivePath, category, bytes, sha256: digest }) => ({
    path, archivePath, category, bytes: bytes.length, sha256: digest,
  }));
  const summary = summaryText(input.generatedAt, inventory);
  const manifest: DiagnosticBundleManifest = {
    schema: 'hummer.diagnostic-bundle-manifest', version: 1, generatedAt: input.generatedAt,
    diagnosticPack, inventory, summarySha256: sha256(summary),
    exclusionPolicy: ['credentials-and-tokens', 'sqlite-databases', 'demo-session-and-recording-bytes', 'binary-or-invalid-utf8'],
  };
  const zip = new JSZip();
  const date = new Date(input.generatedAt);
  zip.file('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`, { date, createFolders: false });
  zip.file('SUMMARY.txt', summary, { date, createFolders: false });
  for (const file of safeFiles) zip.file(file.archivePath, file.bytes, { date, createFolders: false });
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 }, platform: 'DOS' });
}

export async function verifyDiagnosticBundle(archive: Buffer, explicitSecrets: readonly string[] = []): Promise<VerifiedDiagnosticBundle> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(archive, { checkCRC32: true, createFolders: false });
  } catch {
    throw new Error('diagnostic bundle is not a valid ZIP archive');
  }
  const names = Object.keys(zip.files).filter((name) => !zip.files[name].dir).sort();
  if (!names.includes('manifest.json') || !names.includes('SUMMARY.txt')) throw new Error('diagnostic bundle is missing its manifest or summary');
  const manifestText = await zip.files['manifest.json'].async('string');
  const summary = await zip.files['SUMMARY.txt'].async('string');
  for (const secret of explicitSecrets) {
    if (secret.length > 0 && (manifestText.includes(secret) || summary.includes(secret))) throw new Error('diagnostic bundle metadata contains an explicit secret');
  }
  const manifest = validateManifest(JSON.parse(manifestText) as unknown);
  if (sha256(summary) !== manifest.summarySha256) throw new Error('diagnostic bundle summary digest mismatch');
  const expectedNames = ['SUMMARY.txt', 'manifest.json', ...manifest.inventory.map((entry) => entry.archivePath)].sort();
  if (JSON.stringify(names) !== JSON.stringify(expectedNames)) throw new Error('diagnostic bundle contains unlisted or missing archive entries');
  const seen = new Set<string>();
  let totalFileBytes = 0;
  for (const entry of manifest.inventory) {
    const normalized = normalizePath(entry.path);
    if (entry.archivePath !== `files/${normalized}` || seen.has(normalized)) throw new Error('diagnostic bundle inventory path is invalid or duplicated');
    seen.add(normalized);
    if (!Number.isInteger(entry.bytes) || entry.bytes < 0 || !HASH_PATTERN.test(entry.sha256)) throw new Error('diagnostic bundle inventory metadata is invalid');
    const file = zip.files[entry.archivePath];
    if (!file || file.dir) throw new Error(`diagnostic bundle inventory file is missing: ${normalized}`);
    const bytes = await file.async('nodebuffer');
    assertSafeContents(normalized, bytes, explicitSecrets);
    if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) throw new Error(`diagnostic bundle file digest mismatch: ${normalized}`);
    totalFileBytes += bytes.length;
  }
  const packInventory = manifest.diagnosticPack.files.map((file) => `${file.path}:${file.bytes}:${file.sha256}:${file.category}`).sort();
  const bundleInventory = manifest.inventory.map((file) => `${file.path}:${file.bytes}:${file.sha256}:${file.category}`).sort();
  if (JSON.stringify(packInventory) !== JSON.stringify(bundleInventory)) throw new Error('diagnostic pack and bundle inventory disagree');
  return {
    manifest, archiveSha256: sha256(archive), archiveBytes: archive.length,
    fileCount: manifest.inventory.length, totalFileBytes,
  };
}

export async function writeDiagnosticBundle(
  path: string,
  input: DiagnosticBundleInput,
  options: DiagnosticBundleWriteOptions = {},
): Promise<VerifiedDiagnosticBundle & { path: string }> {
  const archive = await createDiagnosticBundle(input);
  await verifyDiagnosticBundle(archive, input.explicitSecrets);
  const absolutePath = resolve(path);
  const stagingPath = join(dirname(absolutePath), `.${randomUUID()}.hummer-diagnostic.tmp`);
  let fileDescriptor: number | undefined;
  let published = false;
  try {
    fileDescriptor = openSync(stagingPath, 'wx');
    if (options.writeStaging) options.writeStaging(fileDescriptor, archive);
    else writeAll(fileDescriptor, archive);
    fsyncSync(fileDescriptor);
    closeSync(fileDescriptor);
    fileDescriptor = undefined;

    const stagedArchive = readFileSync(stagingPath);
    const verified = await verifyDiagnosticBundle(stagedArchive, input.explicitSecrets);
    if (verified.archiveSha256 !== sha256(archive) || stagedArchive.length !== archive.length) {
      throw new Error('staged diagnostic bundle differs from the verified in-memory archive');
    }

    // A same-directory hard link is an atomic no-overwrite publish: the final
    // name appears only after the fully fsynced bytes exist, and EEXIST keeps an
    // earlier destination untouched. It is stronger than rename on POSIX,
    // where rename would replace the destination.
    (options.publishStaging ?? linkSync)(stagingPath, absolutePath);
    unlinkSync(stagingPath);
    published = true;
    return { ...verified, path: absolutePath };
  } finally {
    if (fileDescriptor !== undefined) {
      try { closeSync(fileDescriptor); } catch { /* Preserve the originating write failure. */ }
    }
    if (!published) {
      try { unlinkSync(stagingPath); } catch { /* The staging name may never have been created. */ }
    }
  }
}

function writeAll(fileDescriptor: number, archive: Buffer): void {
  let offset = 0;
  while (offset < archive.length) {
    const written = writeSync(fileDescriptor, archive, offset, archive.length - offset);
    if (written <= 0) throw new Error('diagnostic bundle staging write made no progress');
    offset += written;
  }
}
