import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const kinds = ['website', 'deck', 'report', 'image', 'sales', 'content'];

for (const kind of kinds) {
  const root = resolve(`spikes/m5g-workflows/${kind}`);
  const evidencePath = resolve(root, `${kind}-evidence.json`);
  const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
  const artifactDirectory = resolve(root, 'artifacts');
  mkdirSync(artifactDirectory, { recursive: true });

  for (const name of evidence.artifactEvidence.files) {
    copyFileSync(resolve(evidence.orderDirectory, name), resolve(artifactDirectory, name));
  }

  evidence.artifactArchive = {
    directory: 'artifacts',
    files: evidence.artifactEvidence.files,
  };
  evidence.uiScreenshot = existsSync(resolve(root, `${kind}-ui.png`))
    ? `${kind}-ui.png`
    : null;
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(`${kind}: archived ${evidence.artifactEvidence.files.join(', ')}`);
}
