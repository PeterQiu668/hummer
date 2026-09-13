import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const kinds = ['website', 'deck', 'report', 'image', 'sales', 'content'];
const secretPattern = /sk-[A-Za-z0-9_-]{20,}/;

for (const kind of kinds) {
  const root = resolve(`spikes/m5g-workflows/${kind}`);
  const evidence = JSON.parse(readFileSync(resolve(root, `${kind}-evidence.json`), 'utf8'));
  for (const name of evidence.artifactArchive.files) {
    const bytes = readFileSync(resolve(root, evidence.artifactArchive.directory, name));
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (!evidence.tool.evidenceRefs.includes(`evidence://sha256/${digest}`)) {
      throw new Error(`${kind}/${name}: artifact hash is absent from the tool evidence`);
    }
  }

  const receiptDirectory = resolve(root, 'receipts');
  for (const name of readdirSync(receiptDirectory)) {
    if (extname(name) !== '.json') continue;
    const receiptPath = resolve(receiptDirectory, name);
    const verification = spawnSync(process.execPath, ['scripts/verify-receipt.mjs', receiptPath], {
      cwd: process.cwd(),
      encoding: 'utf8',
      windowsHide: true,
    });
    if (verification.status !== 0) {
      throw new Error(`${kind}/${name}: receipt verification failed\n${verification.stdout}${verification.stderr}`);
    }
  }
  console.log(`${kind}: artifacts and receipts verified`);
}

const scanRoots = [
  'apps', 'packages', 'src', 'scripts', 'docs',
  'spikes/m5g-sandbox', 'spikes/m5g-workspace-exec', 'spikes/m5g-workflows',
];
for (const root of scanRoots) scanSecrets(resolve(root));
console.log('M5-G evidence verification passed; no API-key-shaped value was found.');

function scanSecrets(directory) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ['dist', 'node_modules', 'profile', 'facts', 'order-workspaces', 'release'].includes(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) scanSecrets(path);
    else if (!entry.name.includes('.test.') && isTextFile(entry.name) && secretPattern.test(readFileSync(path, 'utf8'))) {
      throw new Error(`API-key-shaped value found in ${path}`);
    }
  }
}

function isTextFile(name) {
  return ['.cjs', '.css', '.html', '.js', '.json', '.jsonl', '.md', '.mjs', '.ts', '.tsx'].includes(extname(name));
}
