import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function option(name) {
  const prefix = `--${name}=`;
  const inline = process.argv.slice(2).find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function filesUnder(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) fail(`evidence symlinks are forbidden: ${path}`);
    if (stat.isDirectory()) files.push(...filesUnder(path));
    else if (stat.isFile() && entry.name !== 'manifest.json') files.push(path);
  }
  return files;
}

function inside(parent, child) {
  const rel = relative(parent, child);
  return rel !== '' && !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel);
}

const round = option('round');
if (!round || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(round)) fail('usage: node scripts/evidence-seal.mjs --round <safe-round-name> [--prev <manifest.json>]');

const repository = process.cwd();
const evidenceRoot = resolve(repository, 'evidence');
const roundDirectory = resolve(evidenceRoot, round);
if (!existsSync(roundDirectory) || !lstatSync(roundDirectory).isDirectory()) fail(`evidence round does not exist: evidence/${round}`);
if (!inside(evidenceRoot, roundDirectory)) fail('evidence round escapes the evidence root');

const manifestPath = resolve(roundDirectory, 'manifest.json');
if (existsSync(manifestPath)) fail(`sealed evidence is immutable; manifest already exists: evidence/${round}/manifest.json`);

let prevManifestRootHash = null;
const previousPathOption = option('prev');
if (previousPathOption) {
  const previousPath = resolve(repository, previousPathOption);
  if (!inside(evidenceRoot, previousPath) || !existsSync(previousPath)) fail('previous manifest must be an existing file under evidence/');
  let previous;
  try {
    previous = JSON.parse(readFileSync(previousPath, 'utf8'));
  } catch {
    fail('previous manifest is not valid JSON');
  }
  if (!previous || typeof previous.rootHash !== 'string' || !/^[a-f0-9]{64}$/.test(previous.rootHash)) fail('previous manifest has no valid rootHash');
  prevManifestRootHash = previous.rootHash;
}

const paths = filesUnder(roundDirectory).sort((a, b) => a.localeCompare(b));
if (paths.length === 0) fail('cannot seal an empty evidence round');
const files = paths.map((path) => {
  const bytes = readFileSync(path);
  return {
    path: relative(repository, path).replaceAll('\\', '/'),
    sha256: sha256(bytes),
    bytes: bytes.byteLength,
  };
});

let gitCommit;
try {
  gitCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim();
} catch {
  fail('cannot resolve the current Git commit');
}

const body = {
  schema: 'hummer.evidence-manifest',
  version: 1,
  round,
  generatedAt: new Date().toISOString(),
  gitCommit,
  prevManifestRootHash,
  files,
};
const manifest = { ...body, rootHash: sha256(canonicalJson(body)) };
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
process.stdout.write(`${JSON.stringify({ status: 'sealed', manifest: relative(repository, manifestPath).replaceAll('\\', '/'), files: files.length, rootHash: manifest.rootHash, prevManifestRootHash })}\n`);
