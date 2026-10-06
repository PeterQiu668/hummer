import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { canonicalJson } from './persistence/canonical-json.js';
import { openSqlite, type SqliteDatabase } from './persistence/sqlite.js';

const SYNTHETIC_ROOT_MARKER = '.hummer-synthetic-release-root';
const RELEASE_STATE_DATABASE = 'release-state.sqlite3';
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/;

export type UpgradeFaultPhase = 'after-stage' | 'after-pointer-update';

export interface SyntheticReleaseFile {
  path: string;
  contentsBase64: string;
  sha256: string;
}

export interface SyntheticReleasePackage {
  schema: 'hummer.synthetic-release-package';
  version: 1;
  releaseVersion: string;
  compatibleFrom: string;
  compatibleBefore: string;
  payloadSha256: string;
  files: SyntheticReleaseFile[];
}

export interface UpgradeRehearsalInput {
  installRoot: string;
  packagePath: string;
  expectedPackageSha256: string;
  now?: () => Date;
  faultInjector?: (phase: UpgradeFaultPhase) => void;
}

export interface UpgradeRehearsalResult {
  previousVersion: string;
  activeVersion: string;
  packageSha256: string;
  payloadSha256: string;
  atomicSwitch: 'sqlite-transaction';
}

export interface ReleaseSwitchAuditEntry {
  fromVersion: string;
  toVersion: string;
  packageSha256: string;
  status: 'activated' | 'rolled_back';
  reason: string | null;
  occurredAt: string;
}

interface ActiveReleaseRow {
  version: string;
}

interface ReleaseSwitchAuditRow {
  from_version: string;
  to_version: string;
  package_sha256: string;
  status: 'activated' | 'rolled_back';
  reason: string | null;
  occurred_at: string;
}

function sha256(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function assertExactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw new Error(`${label} contains unknown fields: ${unknown.join(', ')}`);
}

function requireVersion(value: unknown, field: string): string {
  if (typeof value !== 'string' || !VERSION_PATTERN.test(value)) throw new Error(`${field} must be a semantic version`);
  return value;
}

function normalizeReleasePath(value: unknown): string {
  if (typeof value !== 'string') throw new Error('release file path must be a string');
  const normalized = value.replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized) || normalized.split('/').includes('..')) {
    throw new Error('release file path must remain relative to the version directory');
  }
  for (const segment of normalized.split('/')) {
    if (!segment || segment === '.' || /[<>:"|?*\u0000-\u001f]/.test(segment) || /[ .]$/.test(segment)
      || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(segment)) {
      throw new Error(`release file path contains a Windows-unsafe segment: ${normalized}`);
    }
  }
  return normalized;
}

function versionParts(version: string): [number, number, number] {
  const match = VERSION_PATTERN.exec(version);
  if (!match) throw new Error(`invalid semantic version: ${version}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersions(left: string, right: string): number {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function parsePackage(bytes: Buffer): SyntheticReleasePackage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('release package must be UTF-8 JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('release package must be an object');
  const value = parsed as Record<string, unknown>;
  assertExactKeys(value, ['schema', 'version', 'releaseVersion', 'compatibleFrom', 'compatibleBefore', 'payloadSha256', 'files'], 'release package');
  if (value.schema !== 'hummer.synthetic-release-package' || value.version !== 1) throw new Error('unsupported release package schema');
  const releaseVersion = requireVersion(value.releaseVersion, 'releaseVersion');
  const compatibleFrom = requireVersion(value.compatibleFrom, 'compatibleFrom');
  const compatibleBefore = requireVersion(value.compatibleBefore, 'compatibleBefore');
  if (compareVersions(compatibleFrom, compatibleBefore) >= 0) throw new Error('release compatibility interval is empty');
  if (typeof value.payloadSha256 !== 'string' || !SHA256_PATTERN.test(value.payloadSha256)) throw new Error('payloadSha256 is invalid');
  if (!Array.isArray(value.files) || value.files.length === 0 || value.files.length > 256) throw new Error('release package files must contain 1-256 entries');
  const seen = new Set<string>();
  const files = value.files.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`release file ${index} must be an object`);
    const file = entry as Record<string, unknown>;
    assertExactKeys(file, ['path', 'contentsBase64', 'sha256'], `release file ${index}`);
    const path = normalizeReleasePath(file.path);
    if (seen.has(path)) throw new Error(`duplicate release file path: ${path}`);
    seen.add(path);
    if (typeof file.contentsBase64 !== 'string') throw new Error(`release file ${path} contentsBase64 is required`);
    if (typeof file.sha256 !== 'string' || !SHA256_PATTERN.test(file.sha256)) throw new Error(`release file ${path} sha256 is invalid`);
    const decoded = Buffer.from(file.contentsBase64, 'base64');
    if (decoded.toString('base64') !== file.contentsBase64 || sha256(decoded) !== file.sha256) throw new Error(`release file ${path} failed its digest check`);
    return { path, contentsBase64: file.contentsBase64, sha256: file.sha256 };
  });
  const payloadDigest = sha256(canonicalJson(files.map(({ path, sha256: digest }) => ({ path, sha256: digest }))));
  if (payloadDigest !== value.payloadSha256) throw new Error('release payload digest mismatch');
  return {
    schema: 'hummer.synthetic-release-package', version: 1, releaseVersion, compatibleFrom,
    compatibleBefore, payloadSha256: value.payloadSha256, files,
  };
}

function openReleaseState(installRoot: string): SqliteDatabase {
  const database = openSqlite(join(installRoot, RELEASE_STATE_DATABASE));
  database.exec(`
    CREATE TABLE IF NOT EXISTS active_release (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      version TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS release_switch_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_version TEXT NOT NULL,
      to_version TEXT NOT NULL,
      package_sha256 TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('activated', 'rolled_back')),
      reason TEXT,
      occurred_at TEXT NOT NULL
    );
  `);
  return database;
}

function requireSyntheticRoot(installRoot: string): void {
  if (!existsSync(join(installRoot, SYNTHETIC_ROOT_MARKER))) {
    throw new Error('upgrade rehearsal refuses any install root without the synthetic-root marker');
  }
}

function safeAuditReason(error: unknown): string {
  const raw = error instanceof Error ? error.message : 'unknown upgrade failure';
  return raw
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]{4,}\b/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|secret)\s*[=:]\s*[^\s,;]+/gi, '[REDACTED:CREDENTIAL]')
    .replace(/(?:[A-Za-z]:[\\/]|\\\\)[^\s,;"']+/g, '[REDACTED:PATH]')
    .slice(0, 512);
}

export function buildSyntheticReleasePackage(input: {
  releaseVersion: string;
  compatibleFrom: string;
  compatibleBefore: string;
  files: ReadonlyArray<{ path: string; contents: string | Buffer }>;
}): Buffer {
  requireVersion(input.releaseVersion, 'releaseVersion');
  requireVersion(input.compatibleFrom, 'compatibleFrom');
  requireVersion(input.compatibleBefore, 'compatibleBefore');
  const files = [...input.files].map((file) => {
    const path = normalizeReleasePath(file.path);
    const bytes = Buffer.isBuffer(file.contents) ? file.contents : Buffer.from(file.contents, 'utf8');
    return { path, contentsBase64: bytes.toString('base64'), sha256: sha256(bytes) };
  }).sort((left, right) => left.path.localeCompare(right.path));
  if (files.length === 0) throw new Error('synthetic release package requires at least one file');
  const payloadSha256 = sha256(canonicalJson(files.map(({ path, sha256: digest }) => ({ path, sha256: digest }))));
  return Buffer.from(`${canonicalJson({
    schema: 'hummer.synthetic-release-package', version: 1, releaseVersion: input.releaseVersion,
    compatibleFrom: input.compatibleFrom, compatibleBefore: input.compatibleBefore,
    payloadSha256, files,
  })}\n`, 'utf8');
}

export function initializeSyntheticInstall(installRoot: string, version: string, contents = 'synthetic-old-release'): void {
  requireVersion(version, 'version');
  if (existsSync(join(installRoot, SYNTHETIC_ROOT_MARKER))) throw new Error('synthetic install is already initialized');
  mkdirSync(join(installRoot, 'versions', version), { recursive: true });
  writeFileSync(join(installRoot, SYNTHETIC_ROOT_MARKER), 'test-only synthetic release root\n', { encoding: 'utf8', flag: 'wx' });
  writeFileSync(join(installRoot, 'versions', version, 'app.bin'), contents, { encoding: 'utf8', flag: 'wx' });
  writeFileSync(join(installRoot, 'versions', version, 'release.json'), `${canonicalJson({ version })}\n`, { encoding: 'utf8', flag: 'wx' });
  const database = openReleaseState(installRoot);
  try {
    database.prepare('INSERT INTO active_release (singleton, version, updated_at) VALUES (1, ?, ?)')
      .run(version, new Date(0).toISOString());
  } finally {
    database.close();
  }
}

export function getActiveReleaseVersion(installRoot: string): string {
  requireSyntheticRoot(installRoot);
  const database = openReleaseState(installRoot);
  try {
    const row = database.prepare('SELECT version FROM active_release WHERE singleton = 1').get<ActiveReleaseRow>();
    if (!row) throw new Error('synthetic install has no active release');
    return row.version;
  } finally {
    database.close();
  }
}

export function listReleaseSwitchAudit(installRoot: string): ReleaseSwitchAuditEntry[] {
  requireSyntheticRoot(installRoot);
  const database = openReleaseState(installRoot);
  try {
    return database.prepare(`
      SELECT from_version, to_version, package_sha256, status, reason, occurred_at
      FROM release_switch_audit ORDER BY id
    `).all<ReleaseSwitchAuditRow>().map((row) => ({
      fromVersion: row.from_version,
      toVersion: row.to_version,
      packageSha256: row.package_sha256,
      status: row.status,
      reason: row.reason,
      occurredAt: row.occurred_at,
    }));
  } finally {
    database.close();
  }
}

export function rehearseUpgrade(input: UpgradeRehearsalInput): UpgradeRehearsalResult {
  requireSyntheticRoot(input.installRoot);
  if (!SHA256_PATTERN.test(input.expectedPackageSha256)) throw new Error('expected package SHA-256 is invalid');
  const packageBytes = readFileSync(input.packagePath);
  const packageSha256 = sha256(packageBytes);
  if (packageSha256 !== input.expectedPackageSha256) throw new Error('release package SHA-256 mismatch');
  const release = parsePackage(packageBytes);
  const previousVersion = getActiveReleaseVersion(input.installRoot);
  if (compareVersions(previousVersion, release.compatibleFrom) < 0 || compareVersions(previousVersion, release.compatibleBefore) >= 0) {
    throw new Error(`release ${release.releaseVersion} is incompatible with active version ${previousVersion}`);
  }
  if (compareVersions(release.releaseVersion, previousVersion) <= 0) throw new Error('upgrade rehearsal requires a newer release version');

  const stageRoot = join(input.installRoot, '.staging');
  const stageDirectory = join(stageRoot, `${release.releaseVersion}-${packageSha256.slice(0, 12)}`);
  const versionDirectory = join(input.installRoot, 'versions', release.releaseVersion);
  if (existsSync(stageDirectory) || existsSync(versionDirectory)) throw new Error('release version was already staged or published');
  mkdirSync(stageDirectory, { recursive: true });
  for (const file of release.files) {
    const destination = join(stageDirectory, ...file.path.split('/'));
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, Buffer.from(file.contentsBase64, 'base64'), { flag: 'wx' });
    if (sha256(readFileSync(destination)) !== file.sha256) throw new Error(`staged file ${file.path} failed verification`);
  }
  writeFileSync(join(stageDirectory, 'release.json'), `${canonicalJson({
    version: release.releaseVersion, packageSha256, payloadSha256: release.payloadSha256,
  })}\n`, { encoding: 'utf8', flag: 'wx' });
  const occurredAt = (input.now ?? (() => new Date()))().toISOString();
  try {
    input.faultInjector?.('after-stage');
    mkdirSync(join(input.installRoot, 'versions'), { recursive: true });
    renameSync(stageDirectory, versionDirectory);
    const database = openReleaseState(input.installRoot);
    const activate = database.transaction(() => {
      database.prepare('UPDATE active_release SET version = ?, updated_at = ? WHERE singleton = 1')
        .run(release.releaseVersion, occurredAt);
      input.faultInjector?.('after-pointer-update');
      database.prepare(`
        INSERT INTO release_switch_audit (from_version, to_version, package_sha256, status, reason, occurred_at)
        VALUES (?, ?, ?, 'activated', NULL, ?)
      `).run(previousVersion, release.releaseVersion, packageSha256, occurredAt);
    });
    try {
      activate();
    } finally {
      database.close();
    }
  } catch (error) {
    const failedRoot = join(input.installRoot, '.failed');
    const failedDirectory = join(failedRoot, `${release.releaseVersion}-${packageSha256.slice(0, 12)}`);
    mkdirSync(failedRoot, { recursive: true });
    if (existsSync(stageDirectory)) renameSync(stageDirectory, failedDirectory);
    else if (existsSync(versionDirectory)) renameSync(versionDirectory, failedDirectory);
    const database = openReleaseState(input.installRoot);
    try {
      database.transaction(() => {
        database.prepare('UPDATE active_release SET version = ?, updated_at = ? WHERE singleton = 1')
          .run(previousVersion, occurredAt);
        database.prepare(`
          INSERT INTO release_switch_audit (from_version, to_version, package_sha256, status, reason, occurred_at)
          VALUES (?, ?, ?, 'rolled_back', ?, ?)
        `).run(previousVersion, release.releaseVersion, packageSha256, safeAuditReason(error), occurredAt);
      })();
    } finally {
      database.close();
    }
    throw error;
  }
  const activeVersion = getActiveReleaseVersion(input.installRoot);
  if (activeVersion !== release.releaseVersion) throw new Error('atomic release activation did not commit');
  return {
    previousVersion, activeVersion, packageSha256, payloadSha256: release.payloadSha256,
    atomicSwitch: 'sqlite-transaction',
  };
}
