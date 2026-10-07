import { cp, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const relayRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageRoot = resolve(relayRoot, 'dist/node_modules/@hummer/contracts');
await mkdir(packageRoot, { recursive: true });
await cp(resolve(relayRoot, 'dist/packages/contracts/src'), resolve(packageRoot, 'src'), {
  recursive: true,
  force: true,
});
await writeFile(resolve(packageRoot, 'package.json'), `${JSON.stringify({
  name: '@hummer/contracts',
  private: true,
  type: 'module',
  exports: './src/index.js',
}, null, 2)}\n`, 'utf8');
