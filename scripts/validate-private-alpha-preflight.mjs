import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validatePrivateAlphaPreflight } from './private-alpha-preflight-contract.mjs';

const input = process.argv[2];
if (!input) {
  process.stderr.write('usage: node scripts/validate-private-alpha-preflight.mjs <preflight.json>\n');
  process.exit(1);
}

let value;
try {
  value = JSON.parse(readFileSync(resolve(input), 'utf8'));
} catch (error) {
  process.stderr.write(`${JSON.stringify({ status: 'invalid', error: error instanceof Error ? error.message : String(error) })}\n`);
  process.exit(1);
}

const validation = validatePrivateAlphaPreflight(value);
process.stdout.write(`${JSON.stringify({
  schema: 'hummer.private-alpha-preflight-validation',
  version: 1,
  status: validation.ok ? 'ready' : 'blocked',
  input: resolve(input),
  errors: validation.errors,
}, null, 2)}\n`);
process.exitCode = validation.ok ? 0 : 2;
