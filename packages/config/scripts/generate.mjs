import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(packageRoot, '..', '..');
const checkOnly = process.argv.includes('--check');

const engineCatalog = await readJson(resolve(packageRoot, 'src/engine-profiles.json'));
const runtimePricing = await readJson(resolve(packageRoot, 'src/runtime-pricing.json'));
const publicEngineCatalog = {
  defaultProfileId: engineCatalog.defaultProfileId,
  profiles: engineCatalog.profiles
    .filter((profile) => profile.customerVisible !== false)
    .map((profile) => ({
      id: profile.id,
      tier: profile.tier,
      label: profile.tier === 'standard' ? '\u6807\u51c6' : profile.tier === 'enhanced' ? '\u589e\u5f3a' : '\u65d7\u8230',
      available: profile.available !== false,
      dataDomain: profile.dataDomain,
      ...(profile.compatibilityNote ? { compatibilityNote: profile.compatibilityNote } : {}),
    })),
};

const outputs = [
  ['apps/desktop/src/config/engine-profiles.json', engineCatalog],
  ['src/features/engines/engine-profiles.json', publicEngineCatalog],
  ['apps/desktop/src/config/deepseek-pricing.json', runtimePricing],
  ['src/features/sessions/runtime/runtime-pricing.json', runtimePricing],
];

for (const [relativePath, value] of outputs) {
  const target = resolve(repositoryRoot, relativePath);
  const expected = `${JSON.stringify(value, null, 2)}\n`;
  if (checkOnly) {
    const actual = await readFile(target, 'utf8').catch(() => '');
    if (actual !== expected) throw new Error(`${relativePath} is stale; run npm run config:generate`);
  } else {
    await writeFile(target, expected, 'utf8');
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}
