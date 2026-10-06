import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';

const root = process.cwd();
const forbiddenPackages = ['@react-three/drei', '@react-three/fiber', 'three', '@types/three'];
const liveRoots = ['src', 'apps', 'packages', 'tests', 'public'];
const sourceExtensions = new Set(['.cjs', '.css', '.html', '.js', '.jsx', '.mjs', '.ts', '.tsx']);
const failures = [];

const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
  for (const packageName of forbiddenPackages) {
    if (packageJson[section]?.[packageName]) {
      failures.push(`package.json ${section} still declares ${packageName}`);
    }
  }
}

for (const rootName of liveRoots) {
  const directory = join(root, rootName);
  if (!existsSync(directory)) continue;

  for (const file of walk(directory)) {
    const projectPath = relative(root, file).split(sep).join('/');
    if (/(^|\/)office(\/|$)/i.test(projectPath) || /Office(?:Stage)?3D/i.test(projectPath)) {
      failures.push(`${projectPath} keeps an abandoned 3D-office path`);
    }

    if (!sourceExtensions.has(extname(file))) continue;
    const sourceText = readFileSync(file, 'utf8');
    if (/['"](?:@react-three\/(?:drei|fiber)|three(?:\/[^'"]*)?)['"]/.test(sourceText)) {
      failures.push(`${projectPath} references a forbidden 3D module`);
    }
    if (/\b(?:OfficeStage3D|Office3D|CameraRig3D)\b/.test(sourceText)) {
      failures.push(`${projectPath} references an abandoned 3D-office identifier`);
    }
    if (/['"]\/office(?:[/'"?#]|$)/.test(sourceText)) {
      failures.push(`${projectPath} references an abandoned /office route`);
    }
  }
}

if (failures.length) {
  console.error('Abandoned 3D lineage audit failed:');
  failures.forEach((failure) => console.error(`  ${failure}`));
  process.exitCode = 1;
} else {
  console.log('Abandoned 3D lineage audit passed: no live paths, imports, routes, or root dependencies remain.');
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'build') return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}
